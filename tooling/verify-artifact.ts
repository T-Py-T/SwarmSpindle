import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { openSwarmStore, type TraceEvent } from '@simpleswarm/swarm';
import { readConfig } from '../apps/shared/config.ts';
import { createWebServers } from '../apps/web/server.ts';

const [swarmId, kind, output, ...extra] = process.argv.slice(2);
if (!swarmId || (kind !== 'svg' && kind !== 'canvas') || !output || extra.length) throw new Error('Usage: bun run tooling/verify-artifact.ts SWARM_ID svg|canvas NEW_OUTPUT_DIR');
const config = readConfig();
const store = openSwarmStore(config.databasePath);
const directory = resolve(output);
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const saveJson = (name: string, value: unknown) => writeFile(`${directory}/${name}`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
interface Issue { phase: string; kind: string; message: string; url?: string }
interface Metrics { width: number; height: number; meanLuminance: number; luminanceStdDev: number; nonBlackFraction: number; nonWhiteFraction: number; meanFrameDifference: number | null; changedPixelFraction: number | null }
interface Capture { file: string; elapsedMs: number; screenshotMs: number; scope: 'viewport' | 'visible-canvas'; pixels: Metrics; sha256: string }
class IssueLog {
  entries: Issue[] = [];
  dropped = 0;
  push(issue: Issue) { if (this.entries.length < 2000) this.entries.push(issue); else this.dropped++; }
  some(predicate: (issue: Issue) => boolean) { return this.entries.some(predicate); }
}

async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((ready, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', ready); });
  const address = listener.address();
  await new Promise<void>((closed, reject) => listener.close(error => error ? reject(error) : closed()));
  if (!address || typeof address === 'string') throw new Error('Private port allocation failed.');
  return address.port;
}
async function privateServers() {
  let cause: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePort(); const previewPort = await freePort();
    if (port === previewPort || [config.port, config.previewPort].includes(port) || [config.port, config.previewPort].includes(previewPort)) continue;
    try { return createWebServers({ store, port, previewPort, html: '<!doctype html><title>Private artifact verifier</title>', script: '', styles: '' }); }
    catch (error) { cause = error; }
  }
  throw new Error('Could not allocate isolated preview servers.', { cause });
}
function providerEvents(id: string): TraceEvent[] {
  const result: TraceEvent[] = []; let cursor = 0;
  for (;;) {
    const page = store.events(id, cursor, 1000);
    result.push(...page.filter(event => event.kind === 'model_response' || event.kind === 'session_verified'));
    if (page.length < 1000) return result;
    cursor = page.at(-1)?.seq ?? cursor;
  }
}
async function contain(context: BrowserContext, prefix: string, issues: IssueLog, phase: string) {
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.method() === 'GET' && request.url().startsWith(prefix)) { await route.continue(); return; }
    issues.push({ phase, kind: 'blocked_request', message: `${request.method()} ${request.resourceType()}`, url: request.url().slice(0, 2000) });
    await route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => { issues.push({ phase, kind: 'blocked_websocket', message: 'WebSocket denied.', url: socket.url().slice(0, 2000) }); socket.close(); });
  context.on('page', page => {
    page.on('pageerror', error => issues.push({ phase, kind: 'page_error', message: error.message.slice(0, 4000) }));
    page.on('console', entry => { if (['error','warning'].includes(entry.type())) issues.push({ phase, kind: `console_${entry.type()}`, message: entry.text().slice(0, 4000) }); });
    page.on('requestfailed', request => issues.push({ phase, kind: 'request_failed', message: request.failure()?.errorText ?? 'Request failed.', url: request.url().slice(0, 2000) }));
    page.on('crash', () => issues.push({ phase, kind: 'page_crash', message: 'Artifact renderer crashed.' }));
    page.on('dialog', dialog => { issues.push({ phase, kind: 'dialog', message: dialog.message().slice(0, 4000) }); void dialog.dismiss(); });
    page.on('download', download => { issues.push({ phase, kind: 'blocked_download', message: download.suggestedFilename() }); void download.cancel(); });
    page.on('popup', popup => { issues.push({ phase, kind: 'blocked_popup', message: 'Popup denied.', url: popup.url().slice(0, 2000) }); void popup.close(); });
  });
}

/** Decode compositor PNGs on a trusted blank page, never through the artifact's WebGL context. */
async function pixels(analysis: Page, current: Buffer, previous?: Buffer): Promise<Metrics> {
  return analysis.evaluate(async ({ png, prior }) => {
    const decode = async (encoded: string) => {
      const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('PNG decoder unavailable.');
      context.drawImage(image, 0, 0, 160, 90); const rgba = context.getImageData(0, 0, 160, 90).data; const luminance: number[] = [];
      for (let index = 0; index < rgba.length; index += 4) luminance.push((rgba[index] ?? 0) * .2126 + (rgba[index + 1] ?? 0) * .7152 + (rgba[index + 2] ?? 0) * .0722);
      return { luminance, width: image.naturalWidth, height: image.naturalHeight };
    };
    const image = await decode(png); const previousImage = prior ? await decode(prior) : null;
    const values = image.luminance; const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const differences = previousImage ? values.map((value, index) => Math.abs(value - (previousImage.luminance[index] ?? 0))) : null;
    return { width: image.width, height: image.height, meanLuminance: mean,
      luminanceStdDev: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length),
      nonBlackFraction: values.filter(value => value > 8).length / values.length, nonWhiteFraction: values.filter(value => value < 247).length / values.length,
      meanFrameDifference: differences ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null,
      changedPixelFraction: differences ? differences.filter(value => value > 2).length / differences.length : null };
  }, { png: current.toString('base64'), prior: previous?.toString('base64') ?? null });
}
async function svgAudit(analysis: Page, source: string) {
  return analysis.evaluate(svg => {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml'); const external: string[] = []; const handlers: string[] = [];
    const inspectCss = (css: string) => {
      for (const match of css.matchAll(/url\(\s*['"]?([^)'"\s]+)[^)]*\)/gi)) if (!match[1]?.startsWith('#')) external.push(match[1] ?? 'unknown CSS URL');
      if (/@import\b/i.test(css)) external.push('CSS @import');
    };
    for (const element of parsed.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        if (/^on/i.test(attribute.name)) handlers.push(`${element.tagName}.${attribute.name}`);
        if (['href','xlink:href','src','xml:base'].includes(attribute.name) && attribute.value && !attribute.value.startsWith('#')) external.push(attribute.value.slice(0, 2000));
        // SVG presentation attributes (fill, filter, mask, etc.) can also contain resource URLs.
        inspectCss(attribute.value);
      }
      if (element.localName === 'style') inspectCss(element.textContent ?? '');
    }
    const root = parsed.documentElement;
    return { rootIsSvg: root.localName === 'svg' && root.namespaceURI === 'http://www.w3.org/2000/svg', parseErrors: [...parsed.querySelectorAll('parsererror')].map(node => node.textContent?.slice(0, 1000)),
      rasterOrEmbeddedImages: parsed.querySelectorAll('image, feImage').length, scripts: parsed.querySelectorAll('script').length, foreignObjects: parsed.querySelectorAll('foreignObject').length,
      eventHandlers: handlers, externalReferences: external, externalDoctype: Boolean(parsed.doctype?.systemId || parsed.doctype?.publicId), viewBox: root.getAttribute('viewBox'), width: root.getAttribute('width'), height: root.getAttribute('height') };
  }, source);
}
async function canvasAudit(page: Page) {
  return page.evaluate(() => ({ devicePixelRatio, viewport: { width: innerWidth, height: innerHeight }, canvases: [...document.querySelectorAll('canvas')].map(canvas => {
    const bounds = canvas.getBoundingClientRect(); const style = getComputedStyle(canvas);
    return { width: canvas.width, height: canvas.height, cssWidth: bounds.width, cssHeight: bounds.height,
      visible: bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
      backingStoreMatchesDpr: Math.abs(canvas.width - bounds.width * devicePixelRatio) <= 2 && Math.abs(canvas.height - bounds.height * devicePixelRatio) <= 2 };
  }) }));
}
async function waitUntil(timestamp: number) {
  for (let remaining = timestamp - Date.now(); remaining > 0; remaining = timestamp - Date.now()) await new Promise(done => setTimeout(done, Math.min(1000, remaining)));
}

async function main() {
  const run = store.getSwarm(swarmId!);
  if (!new Set(['completed','bailed','failed','cancelled','budget_exhausted','interrupted']).has(run.status)) throw new Error('Verification requires a terminal swarm.');
  const file = store.readFile(run.id, run.spec.finalOutput);
  if ((kind === 'svg' && !/\.svg$/i.test(file.path)) || (kind === 'canvas' && !/\.html?$/i.test(file.path))) throw new Error('Final output extension does not match verification kind.');
  const canonical = Buffer.from(file.contentBase64, 'base64'); const beforeLedger = JSON.stringify(store.reservations(run.id)); const beforeEvidence = providerEvents(run.id);
  await mkdir(directory, { mode: 0o700 });
  const outputFilename = `canonical.${kind === 'svg' ? 'svg' : 'html'}`;
  await writeFile(`${directory}/${outputFilename}`, canonical, { flag: 'wx', mode: 0o600 });
  const sessions = new Set(run.agents.filter(agent => agent.sessionId).map(agent => agent.sessionId));
  const responses = new Set(beforeEvidence.filter(event => event.kind === 'model_response' && event.agentId).map(event => event.agentId));
  const receipt = { capturedAt: new Date().toISOString(), kind, canonical: { path: file.path, savedAs: outputFilename, revision: file.revision, bytes: canonical.length, sha256: sha256(canonical) },
    run, reservations: store.reservations(run.id), providerEvidence: beforeEvidence, agentEvidence: { requested: run.spec.agentCount, distinctSessions: sessions.size, agentsWithVerifiedModelResponses: responses.size },
    threads: store.threads(run.id).map(thread => ({ ...thread, messages: store.messages(run.id, thread.id) })),
    limits: ['Mechanical checks do not establish visual fidelity, pelican anatomy, reference motion, or independent sign-off quality.', 'Metrics use compositor PNGs downsampled to 160×90 on a separate trusted blank page. Canvas captures cover the first visible canvas, clipped to the viewport.', 'No Pi runtime is imported; browser requests are restricted to this run’s isolated local artifact preview.'] };
  await saveJson('receipt.json', receipt);
  const issues = new IssueLog(); const captures: Capture[] = []; const measurements: Record<string, unknown> = {};
  const checks: Record<string, boolean> = { runtimeCompleted: run.status === 'completed', allAgentsHaveDistinctSessions: sessions.size === run.spec.agentCount, allAgentsHaveVerifiedModelResponses: responses.size === run.spec.agentCount,
    liabilityWithinCap: run.budget.settledMicros + run.budget.reservedMicros + run.budget.uncertainMicros <= run.budget.capMicros };
  let servers: Awaited<ReturnType<typeof privateServers>> | undefined; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let failure: string | null = null; const started = Date.now();
  try {
    servers = await privateServers();
    browser = await chromium.launch({ executablePath: process.env.SWARM_VERIFY_BROWSER ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
    measurements.browser = { version: browser.version(), executable: process.env.SWARM_VERIFY_BROWSER ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' };
    const prefix = `${servers.previewOrigin}/artifact/${encodeURIComponent(run.id)}/`; const url = prefix + file.path.split('/').map(encodeURIComponent).join('/');
    const analysisContext = await browser.newContext({ serviceWorkers: 'block' }); await analysisContext.route('**/*', route => route.abort('blockedbyclient'));
    const analysis = await analysisContext.newPage(); await analysis.setContent('<!doctype html><title>Trusted PNG analysis</title>');
    const viewport = { width: 1600, height: 900 };
    // The preview's opaque CSP sandbox already forbids service workers. Playwright's
    // blocking init script reads navigator.serviceWorker and throws in this origin.
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: false });
    await contain(context, prefix, issues, 'primary-dpr1'); const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'load', timeout: 20000 }); if (!response?.ok()) throw new Error(`Artifact navigation returned HTTP ${response?.status()}.`);
    const liveStarted = Date.now();
    const capture = async (target: Page, name: string, previous?: Buffer) => {
      let clip: { x: number; y: number; width: number; height: number } | undefined;
      if (kind === 'canvas') {
        const bounds = await target.locator('canvas:visible').first().boundingBox(); const viewport = target.viewportSize();
        if (!bounds || !viewport) throw new Error('Cannot capture visible canvas.');
        const x = Math.max(0, bounds.x); const y = Math.max(0, bounds.y);
        clip = { x, y, width: Math.min(viewport.width, bounds.x + bounds.width) - x, height: Math.min(viewport.height, bounds.y + bounds.height) - y };
        if (clip.width <= 0 || clip.height <= 0) throw new Error('Canvas is outside the viewport.');
      }
      const screenshotStarted = Date.now(); const png = await target.screenshot({ type: 'png', timeout: 10000, scale: 'device', clip });
      const screenshotMs = Date.now() - screenshotStarted; await writeFile(`${directory}/${name}`, png, { flag: 'wx', mode: 0o600 });
      captures.push({ file: name, elapsedMs: screenshotStarted - liveStarted, screenshotMs, scope: clip ? 'visible-canvas' : 'viewport', pixels: await pixels(analysis, png, previous), sha256: sha256(png) }); return png;
    };
    if (kind === 'svg') {
      const audit = await svgAudit(analysis, canonical.toString('utf8')); measurements.svg = audit;
      checks.validSvg = audit.rootIsSvg && audit.parseErrors.length === 0; checks.noRasterOrForeignObject = audit.rasterOrEmbeddedImages === 0 && audit.foreignObjects === 0;
      checks.noScripts = audit.scripts === 0 && audit.eventHandlers.length === 0; checks.noExternalReferences = audit.externalReferences.length === 0 && !audit.externalDoctype;
      await capture(page, 'pelican.png'); checks.nonBlank = (captures.at(-1)?.pixels.luminanceStdDev ?? 0) > .5;
    } else {
      await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 10000 }); const initial = await canvasAudit(page); measurements.initialCanvas = initial;
      checks.actualVisibleCanvas = initial.canvases.some(canvas => canvas.visible); checks.dpr1BackingStore = initial.canvases.filter(canvas => canvas.visible).every(canvas => canvas.backingStoreMatchesDpr);
      let previous = await capture(page, 'baseline.png'); const samplingStarted = Date.now();
      for (let second = 1; second <= 22; second++) { await waitUntil(samplingStarted + second * 1000); previous = await capture(page, `frame-${String(second).padStart(2, '0')}.png`, previous); }
      const frames = captures.filter(capture => /^frame-/.test(capture.file)); checks.nonBlank = frames.every(frame => frame.pixels.luminanceStdDev > .5);
      checks.temporalChangeObserved = frames.some(frame => (frame.pixels.meanFrameDifference ?? 0) > .02);
      const samplingOffset = samplingStarted - liveStarted;
      const deadlineLatenessMs = frames.map((frame, index) => frame.elapsedMs - samplingOffset - (index + 1) * 1000);
      checks.samplingCadence = frames.length === 22 && deadlineLatenessMs.every(lateness => lateness >= 0 && lateness <= 500);
      measurements.sampling = { requestedSeconds: 22, requestedHz: 1, samples: frames.length, startedOffsetMs: samplingOffset,
        actualOffsetsMs: frames.map(frame => frame.elapsedMs), deadlineLatenessMs, maximumDeadlineLatenessMs: 500, includesSeparateBaseline: true };
      const resizing = [];
      for (const size of [{ width: 1024, height: 768 }, { width: 1920, height: 1080 }]) { await page.setViewportSize(size); await page.waitForTimeout(250); resizing.push(await canvasAudit(page)); await capture(page, `resize-${size.width}x${size.height}.png`); }
      measurements.resizing = resizing; checks.canvasSurvivesResize = resizing.every(result => result.canvases.some(canvas => canvas.visible));
      checks.resizeBackingStore = resizing.every(result => result.canvases.some(canvas => canvas.visible) && result.canvases.filter(canvas => canvas.visible).every(canvas => canvas.backingStoreMatchesDpr));
      await page.setViewportSize(viewport);
      const retina = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: false }); await contain(retina, prefix, issues, 'dpr2'); const retinaPage = await retina.newPage();
      await retinaPage.goto(url, { waitUntil: 'load', timeout: 20000 }); await retinaPage.waitForTimeout(1000); const retinaAudit = await canvasAudit(retinaPage); measurements.dpr2 = retinaAudit;
      checks.dpr2CanvasPresent = retinaAudit.devicePixelRatio === 2 && retinaAudit.canvases.some(canvas => canvas.visible); checks.dpr2BackingStore = retinaAudit.canvases.filter(canvas => canvas.visible).every(canvas => canvas.backingStoreMatchesDpr);
      await capture(retinaPage, 'dpr2.png'); await retina.close();
      await waitUntil(liveStarted + 59000); const late = await capture(page, 'sustained-59s.png'); await waitUntil(Math.max(liveStarted + 60000, Date.now() + 1000)); await capture(page, 'sustained-60s.png', late);
      measurements.sustainedDurationMs = Date.now() - liveStarted; checks.sustainedFor60Seconds = Date.now() - liveStarted >= 60000;
      checks.lateTemporalChangeObserved = (captures.at(-1)?.pixels.meanFrameDifference ?? 0) > .02; checks.lateFrameNonBlank = (captures.at(-1)?.pixels.luminanceStdDev ?? 0) > .5;
    }
  } catch (cause) { failure = cause instanceof Error ? cause.message : 'Artifact verification failed.'; }
  finally {
    if (browser) await browser.close().catch(error => { issues.push({ phase: 'cleanup', kind: 'browser_close_error', message: String(error) }); });
    servers?.stop();
    checks.noBrowserErrors = !issues.some(issue => ['page_error','page_crash','console_error','request_failed','browser_close_error'].includes(issue.kind));
    checks.noBlockedResourceAttempts = !issues.some(issue => issue.kind.startsWith('blocked_') || /content security policy|\bcsp\b/i.test(issue.message));
    checks.issueLogComplete = issues.dropped === 0;
    checks.canonicalUnchanged = sha256(Buffer.from(store.readFile(run.id, file.path).contentBase64, 'base64')) === receipt.canonical.sha256;
    checks.providerLedgerUnchanged = beforeLedger === JSON.stringify(store.reservations(run.id)); checks.modelEvidenceUnchanged = JSON.stringify(beforeEvidence) === JSON.stringify(providerEvents(run.id));
    const executionChecks = new Set(['runtimeCompleted', 'allAgentsHaveDistinctSessions', 'allAgentsHaveVerifiedModelResponses', 'liabilityWithinCap', 'canonicalUnchanged', 'providerLedgerUnchanged', 'modelEvidenceUnchanged']);
    const artifactMechanicalChecksPassed = failure === null && Object.entries(checks).filter(([name]) => !executionChecks.has(name)).every(([, passed]) => passed);
    await saveJson('verification.json', { kind, swarmId: run.id, startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, providerCallsInitiated: 0,
      artifactMechanicalChecksPassed,
      checks, mechanicalChecksPassed: failure === null && Object.values(checks).every(Boolean), failure, captures, measurements, browserIssues: issues.entries, droppedBrowserIssues: issues.dropped,
      thresholds: { nonBlankLuminanceStdDev: .5, temporalMeanLuminanceDifference: .02, changedPixelDifference: 2, metricSampleWidth: 160, metricSampleHeight: 90, maximumSamplingDeadlineLatenessMs: 500 },
      manualReviewRequired: kind === 'svg' ? ['Pelican anatomy, riding contact points, bicycle geometry and composition.', 'Two independent measured signoffs on this canonical SHA256.'] : ['Compare visual structure and motion against independently captured reference.', 'Assess resizing composition, particle quality and sustained motion manually.'] });
    if (failure || !Object.values(checks).every(Boolean)) process.exitCode = 1;
    console.log(JSON.stringify({ directory, swarmId: run.id, sha256: receipt.canonical.sha256, artifactMechanicalChecksPassed, mechanicalChecksPassed: failure === null && Object.values(checks).every(Boolean), manualReviewRequired: true, providerCallsInitiated: 0 }));
  }
}
try { await main(); } finally { store.close(); }
