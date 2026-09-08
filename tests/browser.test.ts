import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { chromium, expect as browserExpect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openSwarmStore } from '@simpleswarm/swarm';
import { createWebServers } from '../apps/web/server.ts';
import { openWebFixture, webSpec, type WebFixture } from './helpers/web-fixture.ts';

const browserTests = process.env.SIMPLESWARM_BROWSER_INTEGRATION === '1' ? describe : describe.skip;
const edgeExecutable = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

async function startBrowserServers(fixture: Pick<WebFixture, 'store'>) {
  const [html, script, styles] = await Promise.all(['index.html', 'app.js', 'styles.css'].map(name => Bun.file(new URL(`../dist/web/${name}`, import.meta.url)).text()));
  if (html === undefined || script === undefined || styles === undefined) throw new Error('Build the actual dashboard with bun run build before running browser acceptance.');
  const controlPort = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('port allocation') });
  const previewPort = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('port allocation') });
  const port = controlPort.port;
  const preview = previewPort.port;
  await Promise.all([controlPort.stop(true), previewPort.stop(true)]);
  if (typeof port !== 'number' || typeof preview !== 'number') throw new Error('Expected two loopback TCP ports.');
  return createWebServers({ store: fixture.store, port, previewPort: preview, html, script, styles });
}

function artifact(title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><canvas id="art" width="160" height="100"></canvas><script>
const context=document.getElementById('art').getContext('2d');context.fillStyle='rgb(255,0,0)';context.fillRect(0,0,160,100);
try{parent.document.body.dataset.previewEscaped='yes';document.body.dataset.parentBlocked='false'}catch{document.body.dataset.parentBlocked='true'}
try{document.cookie='previewAttack=yes';document.body.dataset.cookieBlocked='false'}catch{document.body.dataset.cookieBlocked='true'}
document.body.dataset.ready='true';
</script></body></html>`;
}

browserTests('actual dashboard in installed Microsoft Edge', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let fixture: WebFixture;
  let servers: Awaited<ReturnType<typeof startBrowserServers>>;
  let pageErrors: string[];
  let unexpectedDialogs: string[];
  let failedServerResponses: string[];
  let confirmation: 'accept' | 'dismiss' | null;

  beforeAll(async () => {
    if (!await Bun.file(edgeExecutable).exists()) throw new Error(`Microsoft Edge is required at ${edgeExecutable}.`);
    browser = await chromium.launch({ executablePath: edgeExecutable, headless: true });
  }, 30000);
  afterAll(async () => { await browser?.close(); }, 15000);

  beforeEach(async () => {
    fixture = await openWebFixture();
    servers = await startBrowserServers(fixture);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    pageErrors = [];
    unexpectedDialogs = [];
    failedServerResponses = [];
    confirmation = null;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(servers.origin) && response.status() >= 500) failedServerResponses.push(`${response.status()} ${response.url()}`);
    });
    page.on('dialog', async dialog => {
      const choice = confirmation;
      confirmation = null;
      if (dialog.type() === 'confirm' && choice) {
        if (choice === 'accept') await dialog.accept();
        else await dialog.dismiss();
      } else { unexpectedDialogs.push(`${dialog.type()}: ${dialog.message()}`); await dialog.dismiss(); }
    });
  }, 15000);

  afterEach(async () => {
    try {
      expect(pageErrors).toEqual([]);
      expect(unexpectedDialogs).toEqual([]);
      expect(failedServerResponses).toEqual([]);
    } finally {
      await context?.close();
      servers?.stop();
      await fixture?.close();
    }
  }, 15000);

  async function seedRunningSwarm(title = 'Canvas acceptance') {
    const run = await fixture.launch({ title });
    fixture.store.seedFiles(run.id, [{ path: 'index.html', baseRevision: 0, contentBase64: Buffer.from(artifact('Initial artifact')).toString('base64') }]);
    fixture.store.registerWorker('browser-worker', process.pid);
    expect(fixture.store.claimNextSwarm('browser-worker')?.id).toBe(run.id);
    const first = run.agents[0];
    const second = run.agents[1];
    if (!first || !second) throw new Error('Browser fixture needs two actual agent records.');
    const actor = { swarmId: run.id, agentId: first.id };
    fixture.store.startAgent(actor, 'browser-review-session');
    fixture.store.startAgent({ swarmId: run.id, agentId: second.id }, 'browser-render-session');
    fixture.store.renameAgent(actor, 'Reviewer alpha');
    fixture.store.renameAgent({ swarmId: run.id, agentId: second.id }, 'Renderer beta');
    const thread = fixture.store.createThread(actor, 'Rendering review');
    fixture.store.post(actor, thread.id, 'Review the composition and inspect the exported pixels.');
    fixture.store.claimFiles(actor, ['index.html'], 'Reviewing the canonical canvas');
    const currentArtifact = artifact('Reviewed artifact');
    fixture.store.publishFiles(actor, [{ path: 'index.html', baseRevision: 1, contentBase64: Buffer.from(currentArtifact).toString('base64') }], 'Canvas pixels and isolation reviewed');
    const reservation = fixture.store.reserve(actor, 200_000, 'Deterministic browser fixture, no provider request');
    fixture.store.settle(reservation.id, 125_000, { input: 100, output: 50, cacheRead: 25, cacheWrite: 0 });
    fixture.store.appendEvent(run.id, first.id, 'tool_start', { tool: 'read_file', path: 'index.html' });
    fixture.store.appendEvent(run.id, first.id, 'tool_start', { tool: 'browser_review' });
    return { run, actor, thread, currentArtifact };
  }

  async function selectSwarm(id: string): Promise<void> {
    await page.goto(servers.origin, { waitUntil: 'domcontentloaded' });
    await page.locator(`[data-run="${id}"]`).click();
    await browserExpect(page.locator('#connection')).toHaveText('● connected', { timeout: 10000 });
    await browserExpect(page.locator('[data-view="threads"]')).toHaveClass('selected');
  }

  async function screenshot(name: string): Promise<void> {
    const directory = process.env.SIMPLESWARM_SCREENSHOTS_DIR;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, name), fullPage: true });
  }

  async function searchMessages(query: string, scope = 'selected', author = ''): Promise<void> {
    const search = page.locator('#message-search');
    await search.getByLabel('Search message text', { exact: true }).fill(query);
    await search.getByLabel('Scope', { exact: true }).selectOption(scope);
    await search.getByLabel('Author ID (optional)', { exact: true }).fill(author);
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/messages/search');
    await search.getByRole('button', { name: 'SEARCH MESSAGES', exact: true }).click();
    await (await response).finished();
    await browserExpect(search.locator('[data-search-status]')).toHaveText(/matching messages loaded|No matching messages/);
  }

  async function downloadSearchResults(): Promise<Array<Record<string, unknown>>> {
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'EXPORT LOADED RESULTS · JSONL', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('swarm-message-search.jsonl');
    expect(await download.failure()).toBeNull();
    const path = await download.path();
    if (!path) throw new Error('Expected the browser to save the JSONL download.');
    return (await Bun.file(path).text()).trimEnd().split('\n').map(line => {
      const row: unknown = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Expected each exported line to be a message object.');
      return Object.fromEntries(Object.entries(row));
    });
  }

  test('searches full earlier bodies with literal safe highlights, swarm scope and exact operator author', async () => {
    const first = await seedRunningSwarm('Selected message search swarm');
    const second = await seedRunningSwarm('Other message search swarm');
    const phrase = 'iridescent beak geometry';
    const literal = '<img src=x onerror=alert(71)><script>alert(72)</script>';
    fixture.store.post(first.actor, first.thread.id, `${'Earlier prose '.repeat(100)}IRIDESCENT BEAK GEOMETRY ${literal}${' trailing prose'.repeat(100)}`);
    fixture.store.post(first.actor, first.thread.id, 'The latest preview deliberately has no earlier search phrase.');
    fixture.store.postOperator(first.run.id, first.thread.id, `Operator requested ${phrase} inspection.`);
    fixture.store.post(second.actor, second.thread.id, `Other swarm discussed ${phrase}.`);
    await selectSwarm(first.run.id);
    await browserExpect(page.getByRole('button', { name: 'MESSAGE BOARD', exact: true })).toHaveClass('selected');
    await searchMessages(phrase);
    const results = page.locator('#message-search .search-hit');
    await browserExpect(results).toHaveCount(2);
    const earlier = results.filter({ hasText: literal });
    await browserExpect(earlier).toHaveCount(1);
    await browserExpect(earlier.locator('mark')).toHaveText('IRIDESCENT BEAK GEOMETRY');
    await browserExpect(earlier.locator('.prose')).toContainText(literal);
    await browserExpect(page.locator('#message-search img, #message-search script')).toHaveCount(0);
    await searchMessages(phrase, 'all');
    await browserExpect(results).toHaveCount(3);
    await browserExpect(results.filter({ hasText: 'Other message search swarm' })).toHaveCount(1);
    await searchMessages(phrase, 'selected', 'operator');
    await browserExpect(results).toHaveCount(1);
    await browserExpect(results).toContainText('Operator requested');
    await browserExpect(results).toContainText('Selected message search swarm');
    await page.getByLabel('Search message text', { exact: true }).fill('   ');
    await page.getByRole('button', { name: 'SEARCH MESSAGES', exact: true }).click();
    await browserExpect(page.locator('[data-search-status]')).toHaveText('Enter a phrase to search.');
    await browserExpect(results).toHaveCount(0);
    await browserExpect(page.locator('[data-export]')).not.toBeVisible();
    await browserExpect(page.locator('[data-more]')).not.toBeVisible();
  }, 30000);

  test('opens bounded nearby context, follows a cross-swarm conversation and reloads its permanent message link', async () => {
    const first = await seedRunningSwarm('Search starting swarm');
    const second = await seedRunningSwarm('Context destination swarm');
    const thread = fixture.store.createThread(second.actor, 'Cross-swarm discussion');
    const messages = Array.from({ length: 9 }, (_, index) => fixture.store.post(second.actor, thread.id,
      index === 4 ? `Unique context needle ${'full target body '.repeat(80)}exact ending` : `Nearby context item ${index}`));
    const target = messages[4]!;
    fixture.store.post(second.actor, second.thread.id, 'Unrelated thread must not enter nearby context.');
    await selectSwarm(first.run.id);
    await searchMessages('Unique context needle', 'all');
    await browserExpect(page.locator('.search-hit')).toHaveCount(1);
    await page.getByRole('button', { name: 'VIEW CONTEXT', exact: true }).click();
    const nearby = page.locator('[data-context]');
    await browserExpect(nearby.locator('[data-context-message]')).toHaveCount(7);
    expect(await nearby.locator('[data-context-message]').evaluateAll(items => items.map(item => Number(item.getAttribute('data-context-message')))))
      .toEqual(messages.slice(1, 8).map(message => message.id));
    await browserExpect(nearby.locator('.target-message .prose')).toHaveText(target.body);
    await browserExpect(nearby.locator('.target-message mark')).toHaveText('Unique context needle');
    await browserExpect(nearby).not.toContainText('Unrelated thread');
    await browserExpect(page.locator('#summary h1')).toHaveText('Search starting swarm');
    const permalink = await nearby.getByRole('link', { name: 'PERMANENT LINK', exact: true }).getAttribute('href');
    if (!permalink) throw new Error('Expected a permanent context link.');
    expect(new URL(permalink).searchParams.get('swarm')).toBe(second.run.id);
    expect(new URL(permalink).searchParams.get('message')).toBe(String(target.id));
    await nearby.getByRole('button', { name: 'OPEN FULL CONVERSATION', exact: true }).click();
    await browserExpect(page.locator('#summary h1')).toHaveText('Context destination swarm');
    await browserExpect(page.locator('#board-title')).toHaveText('Cross-swarm discussion');
    await browserExpect(page.locator('#conversation-messages .message')).toHaveCount(9);
    await browserExpect(page.locator('#detail')).not.toBeVisible();
    await browserExpect(page.locator('#board-body .goal-block')).not.toHaveAttribute('open');
    expect(new URL(page.url()).searchParams.get('thread')).toBe(thread.id);
    await page.goto(permalink, { waitUntil: 'domcontentloaded' });
    await browserExpect(nearby.locator('.target-message .prose')).toHaveText(target.body);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await browserExpect(page.locator('#summary h1')).toHaveText('Context destination swarm');
    await browserExpect(nearby.locator('.target-message')).toHaveAttribute('data-context-message', String(target.id));
    await browserExpect(nearby.locator('[data-context-message]')).toHaveCount(7);
  }, 30000);

  test('downloads exact loaded message bodies and provenance while pagination keeps its original snapshot', async () => {
    const { run, actor, thread } = await seedRunningSwarm('Message export provenance');
    const query = 'export snapshot needle';
    const messages = Array.from({ length: 28 }, (_, index) => fixture.store.post(actor, thread.id,
      `${query} item ${index}\n${'Full body outside the excerpt. '.repeat(50)}<literal>& exact tail ${index}`));
    await selectSwarm(run.id);
    await searchMessages(query);
    await browserExpect(page.locator('.search-hit')).toHaveCount(25);
    await browserExpect(page.locator('[data-more]')).toBeVisible();
    const late = fixture.store.post(actor, thread.id, `${query} arrived after the search snapshot`);
    const firstDownload = await downloadSearchResults();
    expect(firstDownload).toHaveLength(25);
    const through = firstDownload[0]?.through;
    expect(typeof through).toBe('number');
    firstDownload.forEach((row, index) => {
      const message = messages[index]!;
      expect(row).toMatchObject({ ...message, swarmTitle: run.spec.title, threadTitle: thread.title, authorName: 'Reviewer alpha', query, through });
      expect(typeof row.searchId).toBe('number');
      const url = new URL(String(row.contextUrl));
      expect(url.origin).toBe(servers.origin);
      expect(url.searchParams.get('swarm')).toBe(run.id);
      expect(url.searchParams.get('message')).toBe(String(message.id));
    });
    await page.getByRole('button', { name: 'LOAD MORE RESULTS', exact: true }).click();
    await browserExpect(page.locator('.search-hit')).toHaveCount(28);
    await browserExpect(page.locator('[data-more]')).not.toBeVisible();
    const finalDownload = await downloadSearchResults();
    expect(finalDownload.map(row => row.id)).toEqual(messages.map(message => message.id));
    expect(finalDownload.map(row => row.body)).toEqual(messages.map(message => message.body));
    expect(finalDownload.every(row => row.through === through && row.id !== late.id)).toBe(true);
  }, 30000);

  test('ignores an obsolete failed search after a newer successful search completes', async () => {
    const { run, actor, thread } = await seedRunningSwarm();
    fixture.store.post(actor, thread.id, 'Current successful message search evidence');
    await selectSwarm(run.id);
    let release: () => void = () => {};
    let captured: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const capture = new Promise<void>(resolve => { captured = resolve; });
    await page.route(`${servers.origin}/api/messages/search?*`, async route => {
      if (new URL(route.request().url()).searchParams.get('query') !== 'obsolete request') { await route.continue(); return; }
      captured();
      await gate;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Obsolete search error must stay hidden' }) });
    });
    try {
      await page.getByLabel('Search message text', { exact: true }).fill('obsolete request');
      await page.getByRole('button', { name: 'SEARCH MESSAGES', exact: true }).click();
      await capture;
      await searchMessages('Current successful');
      const obsoleteResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('query') === 'obsolete request');
      release();
      await (await obsoleteResponse).finished();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await browserExpect(page.locator('[data-search-status]')).toContainText('1 matching messages loaded');
      await browserExpect(page.locator('.search-hit')).toHaveCount(1);
      await browserExpect(page.locator('.search-hit')).toContainText('Current successful message search evidence');
      await browserExpect(page.locator('[data-export]')).toBeVisible();
    } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  }, 30000);

  test('selects a swarm, shows actual stats and traces, searches threads, and posts an operator message', async () => {
    const { run, thread } = await seedRunningSwarm();
    await selectSwarm(run.id);
    await browserExpect(page.locator('#summary h1')).toHaveText('Canvas acceptance');
    await browserExpect(page.locator('#worker-state')).toHaveText('1 worker online');
    await browserExpect(page.locator('#summary')).toContainText('2 agents');
    await browserExpect(page.locator('#summary .price')).toHaveText('$0.13');
    await browserExpect(page.locator('#summary .stats')).toContainText('175 tokens | 2 calls');
    await browserExpect(page.locator('.budget-labels')).toContainText('$1.00 cap');
    await browserExpect(page.locator('#timeline')).toContainText('loaded events');
    await screenshot('fixture-populated-threads.png');

    await page.keyboard.press('/');
    await browserExpect(page.getByRole('textbox', { name: 'Search swarms, threads or agents' })).toBeFocused();
    await page.locator('#search').fill('missing-thread');
    await browserExpect(page.locator('#content')).toContainText('No signals match your search');
    await page.locator('#search').fill('Rendering review');
    await browserExpect(page.locator('.thread-row')).toHaveCount(1);
    await page.locator('#sort').selectOption('volume');
    await page.locator('#filter').selectOption('active');
    await page.locator(`[data-thread="${thread.id}"]`).click();
    await browserExpect(page.locator('#board-conversation')).toBeVisible();
    await browserExpect(page.locator('#detail')).not.toBeVisible();
    await browserExpect(page.locator('#board-title')).toHaveText('Rendering review');
    await browserExpect(page.locator('#board-body .goal-block')).not.toHaveAttribute('open');
    await page.locator('#board-body .goal-block summary').click();
    await browserExpect(page.locator('#board-body .goal-block .prose').first()).toBeVisible();
    await browserExpect(page.locator('#board-body')).toContainText(run.spec.task);
    await browserExpect(page.locator('#board-body')).toContainText(run.spec.definitionOfDone);
    await page.getByLabel('Message to this thread').fill('Please verify the pelican silhouette too.');
    await page.getByRole('button', { name: 'POST MESSAGE', exact: true }).click();
    await browserExpect(page.locator('#conversation-messages .message')).toHaveCount(2);
    await browserExpect(page.locator('#conversation-messages .message').last()).toContainText('Please verify the pelican silhouette too.');
    expect(fixture.store.messages(run.id, thread.id).at(-1)).toMatchObject({ authorId: 'operator', body: 'Please verify the pelican silhouette too.' });
    await page.getByRole('button', { name: 'Close conversation' }).click();
    await page.locator('#search').fill('');
    await page.getByRole('button', { name: 'AGENTS', exact: true }).click();
    await browserExpect(page.locator('.agent-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Reviewer alpha', exact: true }).click();
    await browserExpect(page.locator('#detail-title')).toContainText('Reviewer alpha / agent trace');
    await browserExpect(page.locator('#detail-body')).toContainText('browser-review-session');
    await page.getByRole('button', { name: 'SHOW ALL DETAILS', exact: true }).click();
    await browserExpect(page.locator('#detail-body')).toContainText('read_file');
    await screenshot('fixture-agent-trace.png');
  }, 30000);

  test('orders distinguishable threads by all four sort modes and filters active, dormant and all conversations', async () => {
    const browserNow = Date.now();
    let clock = browserNow - 300_000;
    const clockedStore = openSwarmStore(':memory:', { clock: () => clock });
    try {
      const run = clockedStore.createSwarm({ ...webSpec, title: 'Thread ordering acceptance fixture', agentCount: 4 });
      clockedStore.registerWorker('sort-fixture-worker', process.pid);
      expect(clockedStore.claimNextSwarm('sort-fixture-worker')?.id).toBe(run.id);
      const peers = run.agents.map(agent => ({ swarmId: run.id, agentId: agent.id }));
      const lead = peers[0];
      if (!lead) throw new Error('Thread ordering fixture requires an agent.');
      for (const peer of peers) clockedStore.startAgent(peer, `sort-session-${peer.agentId}`);

      const configurations = [
        { title: 'Sort fixture Alpha', createdAgo: 240_000, members: 2, messages: 4, activeAgo: 5000 },
        { title: 'Sort fixture Bravo', createdAgo: 230_000, members: 4, messages: 1, activeAgo: 90_000 },
        { title: 'Sort fixture Charlie', createdAgo: 220_000, members: 1, messages: 3, activeAgo: 10_000 },
        { title: 'Sort fixture Delta', createdAgo: 210_000, members: 3, messages: 2, activeAgo: 120_000 },
      ];
      const threads = configurations.map(configuration => {
        clock = browserNow - configuration.createdAgo;
        const thread = clockedStore.createThread(lead, configuration.title);
        for (const peer of peers.slice(1, configuration.members)) clockedStore.joinThread(peer, thread.id);
        return { ...configuration, id: thread.id };
      });
      for (const thread of [...threads].sort((left, right) => right.activeAgo - left.activeAgo)) {
        clock = browserNow - thread.activeAgo;
        for (let index = 0; index < thread.messages; index += 1) clockedStore.post(lead, thread.id, `${thread.title}: independently counted review ${index + 1}.`);
      }

      servers.stop();
      servers = await startBrowserServers({ store: clockedStore });
      // Fix Date only; polling and EventSource timers continue to run normally.
      await page.clock.setFixedTime(browserNow);
      await selectSwarm(run.id);
      await browserExpect(page.locator('.thread-row')).toHaveCount(5);
      await page.locator('#search').fill('Sort fixture');
      await browserExpect(page.locator('.thread-row')).toHaveCount(4);
      const titles = page.locator('.thread-row .row-title');
      const ordering = [
        { mode: 'activity', titles: ['Sort fixture Alpha', 'Sort fixture Charlie', 'Sort fixture Bravo', 'Sort fixture Delta'] },
        { mode: 'created', titles: ['Sort fixture Delta', 'Sort fixture Charlie', 'Sort fixture Bravo', 'Sort fixture Alpha'] },
        { mode: 'volume', titles: ['Sort fixture Alpha', 'Sort fixture Charlie', 'Sort fixture Delta', 'Sort fixture Bravo'] },
        { mode: 'members', titles: ['Sort fixture Bravo', 'Sort fixture Delta', 'Sort fixture Alpha', 'Sort fixture Charlie'] },
      ];
      for (const order of ordering) {
        await page.locator('#sort').selectOption(order.mode);
        await browserExpect(titles).toHaveText(order.titles);
      }
      await screenshot('fixture-thread-sort-members.png');

      await page.locator('#sort').selectOption('activity');
      await page.locator('#filter').selectOption('dormant');
      await browserExpect(titles).toHaveText(['Sort fixture Bravo', 'Sort fixture Delta']);
      await browserExpect(page.locator('.thread-row.dormant')).toHaveCount(2);
      await page.locator('#filter').selectOption('active');
      await browserExpect(titles).toHaveText(['Sort fixture Alpha', 'Sort fixture Charlie']);
      await browserExpect(page.locator('.thread-row.dormant')).toHaveCount(0);
      await page.locator('#filter').selectOption('all');
      await browserExpect(titles).toHaveText(['Sort fixture Alpha', 'Sort fixture Charlie', 'Sort fixture Bravo', 'Sort fixture Delta']);

      const previouslyDormant = threads.find(thread => thread.title === 'Sort fixture Bravo');
      if (!previouslyDormant) throw new Error('Expected the distinguishable dormant thread.');
      await page.locator('#filter').selectOption('dormant');
      clock = browserNow;
      clockedStore.post(lead, previouslyDormant.id, 'Fresh peer activity moves this conversation out of the dormant filter.');
      await browserExpect(titles).toHaveText(['Sort fixture Delta'], { timeout: 10000 });
      await page.locator('#filter').selectOption('active');
      await browserExpect(titles).toHaveText(['Sort fixture Bravo', 'Sort fixture Alpha', 'Sort fixture Charlie']);
      await page.locator('#filter').selectOption('all');
      await page.locator('#search').fill('');
      await browserExpect(page.locator('.thread-row')).toHaveCount(5);
    } finally {
      await page.close();
      servers.stop();
      clockedStore.close();
    }
  }, 30000);

  test('appends live scoped traces while retaining expanded details, focus and scroll across dialog and run changes', async () => {
    const { run, actor } = await seedRunningSwarm('Live trace acceptance fixture');
    const peer = run.agents[1];
    if (!peer) throw new Error('Expected a second agent for trace scope checks.');
    const expandedEvent = fixture.store.appendEvent(run.id, actor.agentId, 'expanded_review_to_preserve', { lines: Array.from({ length: 50 }, (_, index) => `Retained review line ${index}`) });
    for (let index = 0; index < 18; index += 1) fixture.store.appendEvent(run.id, actor.agentId, 'existing_trace_context', { index });
    await selectSwarm(run.id);
    await page.getByRole('button', { name: 'AGENTS', exact: true }).click();
    await page.getByRole('button', { name: 'Reviewer alpha', exact: true }).click();
    const expanded = page.locator(`[data-trace-seq="${expandedEvent.seq}"]`);
    await expanded.locator('summary').click();
    await browserExpect(expanded.locator('pre')).toContainText('Retained review line 49');
    const retainedNode = await expanded.elementHandle();
    if (!retainedNode) throw new Error('Expected an existing expanded trace node.');
    await expanded.locator('summary').focus();
    const scrollTop = await page.locator('#detail').evaluate(dialog => { dialog.scrollTop = 160; return dialog.scrollTop; });
    expect(scrollTop).toBeGreaterThan(0);
    const excluded = fixture.store.appendEvent(run.id, peer.id, 'other_agent_live_trace', { scope: 'must remain excluded from the selected agent' });
    const own = fixture.store.appendEvent(run.id, actor.agentId, 'selected_agent_live_trace', { evidence: '<img src=x onerror=alert(8)> newly received trace payload' });
    await browserExpect(page.locator(`[data-trace-seq="${own.seq}"]`)).toHaveCount(1, { timeout: 10000 });
    await browserExpect(page.locator(`[data-trace-seq="${excluded.seq}"]`)).toHaveCount(0);
    await browserExpect(expanded).toHaveAttribute('open', '');
    await browserExpect(expanded.locator('summary')).toBeFocused();
    expect(await retainedNode.evaluate(node => node.isConnected)).toBe(true);
    expect(Math.abs(await page.locator('#detail').evaluate(dialog => dialog.scrollTop) - scrollTop)).toBeLessThanOrEqual(1);
    const scopedCount = fixture.store.events(run.id).filter(event => event.agentId === actor.agentId).length;
    await browserExpect(page.locator('#trace-count')).toContainText(`${scopedCount} loaded events`);
    await page.locator(`[data-trace-seq="${own.seq}"] summary`).click();
    await browserExpect(page.locator(`[data-trace-seq="${own.seq}"] pre`)).toContainText('<img src=x onerror=alert(8)>');
    await browserExpect(page.locator('#trace-events img, #trace-events script')).toHaveCount(0);
    await screenshot('fixture-live-agent-trace.png');
    await retainedNode.dispose();

    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('button', { name: 'RAW TRACE', exact: true }).click();
    await browserExpect(page.locator(`[data-trace-seq="${excluded.seq}"]`)).toHaveCount(1);
    const systemEvent = fixture.store.appendEvent(run.id, null, 'system_trace_while_raw_open', { status: 'live' });
    await browserExpect(page.locator(`[data-trace-seq="${systemEvent.seq}"]`)).toHaveCount(1, { timeout: 10000 });
    await browserExpect(page.locator('#trace-count')).toContainText(`${fixture.store.events(run.id).length} loaded events`);
    await screenshot('fixture-live-raw-trace.png');

    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByRole('button', { name: 'STARTING GOAL', exact: true }).click();
    fixture.store.appendEvent(run.id, actor.agentId, 'trace_after_dialog_switch', { safe: true });
    await browserExpect(page.locator('#timeline')).toContainText(`${fixture.store.events(run.id).length} loaded events`, { timeout: 10000 });
    await browserExpect(page.locator('#detail-title')).toHaveText('Starting goal');
    await browserExpect(page.locator('#trace-events')).toHaveCount(0);

    const second = await fixture.launch({ title: 'Isolated second trace fixture' });
    await page.getByRole('button', { name: 'Close details' }).click();
    await selectSwarm(second.id);
    await page.getByRole('button', { name: 'RAW TRACE', exact: true }).click();
    fixture.store.appendEvent(run.id, actor.agentId, 'old_run_must_stay_absent', { scope: 'old run' });
    const secondEvent = fixture.store.appendEvent(second.id, null, 'second_run_live_trace', { scope: 'selected run' });
    await browserExpect(page.locator(`[data-trace-seq="${secondEvent.seq}"]`)).toContainText('second_run_live_trace', { timeout: 10000 });
    await browserExpect(page.locator('#trace-events')).not.toContainText('old_run_must_stay_absent');
    await browserExpect(page.locator('#trace-events')).not.toContainText('selected_agent_live_trace');
  }, 45000);

  test('shows file claims and history, downloads canonical bytes, and executes preview scripts inside the isolated frame', async () => {
    const { run, currentArtifact } = await seedRunningSwarm();
    await selectSwarm(run.id);
    await page.getByRole('button', { name: 'FILES & CLAIMS', exact: true }).click();
    await browserExpect(page.locator('#detail-title')).toHaveText('Workspace files & claims');
    await browserExpect(page.locator('#detail-body')).toContainText('Reviewing the canonical canvas');
    await browserExpect(page.locator('.file-row')).toContainText('r2');
    await page.getByRole('button', { name: 'HISTORY', exact: true }).click();
    await browserExpect(page.locator('#file-preview')).toContainText('index.html · HISTORY');
    await browserExpect(page.locator('#file-preview .message')).toHaveCount(2);
    await browserExpect(page.locator('#file-preview')).toContainText('Canvas pixels and isolation reviewed');

    const downloadReady = page.waitForEvent('download');
    await page.getByRole('link', { name: 'DOWNLOAD', exact: true }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toBe('index.html');
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('Expected a completed local artifact download.');
    expect(await Bun.file(downloadedPath).text()).toBe(currentArtifact);
    expect(await download.failure()).toBeNull();

    const controlUrl = page.url();
    await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
    const frame = page.frameLocator('iframe.artifact-preview');
    await browserExpect(page.locator('iframe.artifact-preview')).toHaveAttribute('sandbox', 'allow-scripts');
    await browserExpect(page.locator('iframe.artifact-preview')).toHaveAttribute('src', `${servers.previewOrigin}/artifact/${run.id}/index.html`);
    await browserExpect(frame.locator('h1')).toHaveText('Reviewed artifact');
    await browserExpect(frame.locator('body')).toHaveAttribute('data-ready', 'true');
    await browserExpect(frame.locator('body')).toHaveAttribute('data-parent-blocked', 'true');
    await browserExpect(frame.locator('body')).toHaveAttribute('data-cookie-blocked', 'true');
    expect(await frame.locator('canvas').evaluate(canvas => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Expected the rendered canvas.');
      return Array.from(canvas.getContext('2d')!.getImageData(20, 20, 1, 1).data);
    })).toEqual([255, 0, 0, 255]);
    expect(await page.locator('body').getAttribute('data-preview-escaped')).toBeNull();
    expect(page.url()).toBe(controlUrl);
    expect(fixture.store.getSwarm(run.id).status).toBe('running');
    await screenshot('fixture-file-preview.png');
  }, 30000);

  test('validates launch fields in the browser and server before queuing exact requested settings', async () => {
    await page.goto(servers.origin, { waitUntil: 'domcontentloaded' });
    await browserExpect(page.locator('#content')).toContainText('Nothing here yet');
    await page.getByRole('button', { name: '+ NEW SWARM', exact: true }).click();
    const launch = page.locator('#launch');
    await launch.getByLabel('Title', { exact: true }).fill('Launched through the dashboard');
    await launch.getByLabel('Model', { exact: true }).selectOption('gpt55');
    await launch.getByLabel('Agents', { exact: true }).fill('30');
    await launch.getByLabel('Shared USD-equivalent cap', { exact: true }).fill('50');
    await launch.getByLabel('Task', { exact: true }).fill('Create a reviewed canvas animation.');
    await launch.getByLabel('Final output file', { exact: true }).fill('hero.html');
    await launch.getByRole('button', { name: 'QUEUE SWARM', exact: true }).click();
    await browserExpect(launch).toBeVisible();
    expect(fixture.store.listSwarms()).toEqual([]);
    expect(await launch.getByLabel('Definition of done', { exact: true }).evaluate(input => input instanceof HTMLTextAreaElement && !input.validity.valid)).toBe(true);

    await launch.getByLabel('Definition of done', { exact: true }).fill('Animation runs locally and its composition passes review.');
    await launch.getByLabel('Final output file', { exact: true }).fill('../escape.html');
    await launch.getByRole('button', { name: 'QUEUE SWARM', exact: true }).click();
    await browserExpect(page.locator('#launch-error')).toContainText('canonical relative file path');
    expect(fixture.store.listSwarms()).toEqual([]);
    await launch.getByLabel('Final output file', { exact: true }).fill('hero.html');
    await launch.getByRole('button', { name: 'QUEUE SWARM', exact: true }).click();
    await browserExpect(launch).not.toBeVisible();
    await browserExpect(page.locator('#summary h1')).toHaveText('Launched through the dashboard');
    await browserExpect(page.locator('#notice')).toContainText('Swarm queued.');
    const runs = fixture.store.listSwarms();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'queued', spec: { agentCount: 30, budgetMicros: 50_000_000, model: { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' }, finalOutput: 'hero.html' } });
  }, 30000);

  test('renders hostile agent text literally and requires a confirmed stop with durable effect', async () => {
    const title = '<img src=x onerror=alert(1)>';
    const { run, actor, thread } = await seedRunningSwarm(title);
    const maliciousName = '<svg onload=alert(2)>';
    const maliciousMessage = '<script>alert(3)</script><img src=x onerror="alert(4)">';
    fixture.store.renameAgent(actor, maliciousName);
    fixture.store.post(actor, thread.id, maliciousMessage);
    await selectSwarm(run.id);
    await browserExpect(page.locator('#summary h1')).toHaveText(title);
    await browserExpect(page.locator('#summary img, #summary svg, #summary script')).toHaveCount(0);
    await page.locator(`[data-thread="${thread.id}"]`).click();
    await browserExpect(page.locator('#conversation-messages .message').last()).toContainText(maliciousMessage);
    await browserExpect(page.locator('#conversation-messages .badge').first()).toHaveText(maliciousName);
    await browserExpect(page.locator('#board-body img, #board-body svg, #board-body script')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close conversation' }).click();

    confirmation = 'dismiss';
    await page.getByRole('button', { name: 'STOP SWARM', exact: true }).click();
    expect(fixture.store.getSwarm(run.id).status).toBe('running');
    confirmation = 'accept';
    await page.getByRole('button', { name: 'STOP SWARM', exact: true }).click();
    await browserExpect(page.locator('#summary .status')).toHaveText('stopping');
    expect(fixture.store.getSwarm(run.id)).toMatchObject({ status: 'stopping', reason: 'Stopped from the dashboard.' });
    expect(fixture.store.events(run.id).some(event => event.kind === 'swarm_stopping')).toBe(true);
  }, 30000);

  test('keeps navigation and file controls usable without horizontal overflow at phone width', async () => {
    const { run } = await seedRunningSwarm('A deliberately long mission title that must wrap on a small screen');
    await page.setViewportSize({ width: 390, height: 844 });
    await selectSwarm(run.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'FILES & CLAIMS', exact: true }).click();
    await browserExpect(page.getByRole('link', { name: 'DOWNLOAD', exact: true })).toBeVisible();
    expect(await page.locator('#detail').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true);
    await screenshot('fixture-phone-files.png');
    await page.keyboard.press('Escape');
    await browserExpect(page.locator('#detail')).not.toBeVisible();
    await page.getByRole('button', { name: 'AGENTS', exact: true }).click();
    await browserExpect(page.locator('.agent-row')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await screenshot('fixture-phone-agents.png');
  }, 30000);

  test('searches earlier message content and receives live peer messages without disturbing a draft, selection or scroll', async () => {
    const { run, actor, thread } = await seedRunningSwarm('Live conversation acceptance fixture');
    fixture.store.post(actor, thread.id, 'The iridescent beak geometry needs an independent review.');
    fixture.store.post(actor, thread.id, Array.from({ length: 35 }, (_, index) => `Review detail ${index}: inspect the silhouette and cycle geometry carefully.`).join('\n'));
    fixture.store.post(actor, thread.id, 'Latest pixel review: the canonical canvas is ready for comparison.');
    await selectSwarm(run.id);
    await page.locator('#search').fill('IRIDESCENT BEAK GEOMETRY');
    await browserExpect(page.locator('.thread-row')).toHaveCount(1);
    await browserExpect(page.locator('.thread-row .preview-text')).toContainText('Latest pixel review');
    await page.locator(`[data-thread="${thread.id}"]`).click();
    await browserExpect(page.locator('#conversation-messages .message')).toHaveCount(4);
    const input = page.getByLabel('Message to this thread');
    const composerWidth = await input.evaluate(element => element.getBoundingClientRect().width);
    const formWidth = await page.locator('#message-form').evaluate(element => element.getBoundingClientRect().width);
    expect(composerWidth).toBeGreaterThan(400);
    expect(Math.abs(composerWidth - formWidth)).toBeLessThanOrEqual(1);
    const draft = 'Keep this unfinished correction while the peers continue working.';
    await input.fill(draft);
    await input.evaluate(element => { if (element instanceof HTMLTextAreaElement) element.setSelectionRange(5, 16); });
    const scrollTop = await page.locator('#board-scroll').evaluate(board => { board.scrollTop = 160; return board.scrollTop; });
    expect(scrollTop).toBeGreaterThan(0);
    const incoming = '<img src=x onerror=alert(9)> Fresh peer review arrived while the operator was composing.';
    fixture.store.post(actor, thread.id, incoming);
    await browserExpect(page.locator('#conversation-messages .message')).toHaveCount(5, { timeout: 10000 });
    await browserExpect(page.locator('#conversation-messages .message').last()).toContainText(incoming);
    await browserExpect(input).toBeFocused();
    await browserExpect(input).toHaveValue(draft);
    expect(await input.evaluate(element => element instanceof HTMLTextAreaElement ? [element.selectionStart, element.selectionEnd] : [])).toEqual([5, 16]);
    expect(Math.abs(await page.locator('#board-scroll').evaluate(board => board.scrollTop) - scrollTop)).toBeLessThanOrEqual(1);
    await browserExpect(page.locator('#conversation-messages img, #conversation-messages script')).toHaveCount(0);
    await screenshot('fixture-live-thread-draft.png');
    await page.getByRole('button', { name: 'POST MESSAGE', exact: true }).click();
    await browserExpect(page.locator('#conversation-messages .message').last()).toContainText(draft);
    expect(fixture.store.messages(run.id, thread.id).at(-1)).toMatchObject({ authorId: 'operator', body: draft });
  }, 30000);

  test('ignores a delayed real response when a rapid selection returns to the same swarm', async () => {
    const { run, actor } = await seedRunningSwarm('First selection fixture');
    const second = await fixture.launch({ title: 'Second selection fixture' });
    let release: () => void = () => {};
    let captured: () => void = () => {};
    let delivered: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const capture = new Promise<void>(resolve => { captured = resolve; });
    const delivery = new Promise<void>(resolve => { delivered = resolve; });
    let held = false;
    await page.route(`${servers.origin}/api/swarms/${run.id}`, async route => {
      if (held) { await route.continue(); return; }
      held = true;
      const response = await route.fetch();
      captured();
      await gate;
      await route.fulfill({ response });
      delivered();
    });
    try {
      await page.goto(servers.origin, { waitUntil: 'domcontentloaded' });
      await page.locator(`[data-run="${run.id}"]`).click();
      await capture;
      await page.locator(`[data-run="${second.id}"]`).click();
      await browserExpect(page.locator('#summary h1')).toHaveText('Second selection fixture');
      fixture.store.appendEvent(run.id, actor.agentId, 'tool_start', { tool: 'newest_selection_evidence' });
      await page.getByRole('button', { name: 'SWARMS', exact: true }).click();
      await page.locator(`[data-run="${run.id}"]`).click();
      await browserExpect(page.locator('#summary .stats')).toContainText('175 tokens | 3 calls');
      release();
      await delivery;
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await browserExpect(page.locator('#summary h1')).toHaveText('First selection fixture');
      await browserExpect(page.locator('#summary .stats')).toContainText('175 tokens | 3 calls');
      await browserExpect(page.locator('#connection')).toHaveText('● connected');
    } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  }, 30000);

  test('reconnects after browser network loss without losing worker state or duplicating displayed traces', async () => {
    const { run, actor } = await seedRunningSwarm();
    await selectSwarm(run.id);
    try {
      await context.setOffline(true);
      await browserExpect(page.locator('#connection')).toHaveText(/reconnecting|disconnected/, { timeout: 10000 });
      const offlineEvent = fixture.store.appendEvent(run.id, actor.agentId, 'review_while_browser_offline', { review: 'Durable event created without a browser connection.' });
      expect(fixture.store.getSwarm(run.id).status).toBe('running');
      await context.setOffline(false);
      await browserExpect(page.locator('#connection')).toHaveText('● connected', { timeout: 15000 });
      await browserExpect(page.locator('#timeline')).toContainText(`${fixture.store.events(run.id).length} loaded events`, { timeout: 15000 });
      await page.getByRole('button', { name: 'RAW TRACE', exact: true }).click();
      const offlineTrace = page.locator('.trace-event').filter({ hasText: `#${offlineEvent.seq} ·` });
      await browserExpect(offlineTrace).toHaveCount(1);
      await browserExpect(offlineTrace).toContainText('review_while_browser_offline');
    } finally { await context.setOffline(false); }
  }, 45000);
});
