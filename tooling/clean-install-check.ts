import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

interface ChildResult { code: number | null; signal: string | null; stdout: string; stderr: string; elapsedMs: number }
interface OwnedChild { name: string; child: ChildProcess; done: Promise<ChildResult>; exited: boolean; escalated: boolean }
interface ManifestEntry { path: string; bytes: number; mode: number; sha256: string }
interface WorkerStatus { id: string; pid: number; heartbeatAt: number; status: 'online' | 'offline' }
interface Status { workers: WorkerStatus[]; swarms: unknown[] }

const [requestedOutput, ...extra] = process.argv.slice(2);
if (!requestedOutput || extra.length) throw new Error('Usage: bun run tooling/clean-install-check.ts NEW_PRIVATE_OUTPUT_DIRECTORY (run from the source repository root)');
const source = await realpath(process.cwd());
const outputParent = await realpath(dirname(resolve(requestedOutput)));
const output = join(outputParent, resolve(requestedOutput).split(sep).at(-1)!);
if (output === source || output.startsWith(`${source}${sep}`)) throw new Error('Use a new output directory outside the source repository.');
await mkdir(output, { mode: 0o700 });
const checkout = join(output, 'checkout');
const dataDirectory = join(output, 'data');
const piDirectory = join(output, 'empty-pi-config');
const logDirectory = join(output, 'logs');
await Promise.all([checkout, dataDirectory, piDirectory, logDirectory, join(output, 'cache')].map(path => mkdir(path, { mode: 0o700 })));

const beganAt = Date.now();
const deadlineAt = beganAt + 300_000;
const children: OwnedChild[] = [];
const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
const commands: { name: string; code: number | null; signal: string | null; elapsedMs: number }[] = [];
const excluded: { path: string; reason: string }[] = [];
const report: Record<string, unknown> = { source, output, startedAt: new Date(beganAt).toISOString(), completed: false, providerRequests: 0, queuedSwarms: 0, checks, commands, excluded, scope: 'Clean copied-source dependency/build and empty-queue web/worker process smoke; no provider readiness, model inference, image build, artifact acceptance, or public repository verification.' };
const reportPath = join(output, 'report.json');
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let interrupted = false;
let emergencyExit: ReturnType<typeof setTimeout> | undefined;

function saveReport(): void {
  report.elapsedMs = Date.now() - beganAt;
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
function check(condition: unknown, name: string, detail?: unknown): asserts condition {
  checks.push({ name, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) });
  saveReport();
  if (!condition) throw new Error(`Check failed: ${name}`);
}
function remaining(maximum: number): number {
  if (interrupted) throw new Error('Clean-install check was interrupted.');
  const milliseconds = Math.min(maximum, deadlineAt - Date.now());
  if (milliseconds <= 0) throw new Error('Clean-install overall deadline reached.');
  return milliseconds;
}

const environment: NodeJS.ProcessEnv = {};
for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR']) {
  if (process.env[key] !== undefined) environment[key] = process.env[key];
}
Object.assign(environment, {
  SWARM_DATA_DIR: dataDirectory,
  PI_CODING_AGENT_DIR: piDirectory,
  SWARM_MAX_CONCURRENT: '1',
  BUN_INSTALL_CACHE_DIR: join(output, 'cache', 'bun'),
  npm_config_cache: join(output, 'cache', 'npm'),
  XDG_CACHE_HOME: join(output, 'cache'),
  GIT_OPTIONAL_LOCKS: '0',
  NO_COLOR: '1',
});

function signalOwned(entry: OwnedChild, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (entry.exited || entry.child.exitCode !== null || entry.child.signalCode !== null || entry.child.pid === undefined) return;
  try { process.kill(-entry.child.pid, signal); }
  catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

function startChild(name: string, argv: string[], timeoutMs: number, cwd = checkout): OwnedChild {
  const timeout = remaining(timeoutMs);
  const executable = argv[0];
  if (!executable) throw new Error('Missing child executable.');
  const stdoutPath = join(logDirectory, `${name}.stdout.log`);
  const stderrPath = join(logDirectory, `${name}.stderr.log`);
  writeFileSync(stdoutPath, '', { flag: 'wx', mode: 0o600 });
  writeFileSync(stderrPath, '', { flag: 'wx', mode: 0o600 });
  const startAt = Date.now();
  const child = spawn(executable, argv.slice(1), { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let resolveDone: (result: ChildResult) => void = () => {};
  const done = new Promise<ChildResult>(resolveResult => { resolveDone = resolveResult; });
  const entry: OwnedChild = { name, child, done, exited: false, escalated: false };
  children.push(entry);
  const stdout: Buffer[] = []; const stderr: Buffer[] = [];
  let bytes = 0; let failure: string | null = null;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let drainDeadline: ReturnType<typeof setTimeout> | undefined;
  function stop(reason: string) {
    failure ??= reason;
    signalOwned(entry, 'SIGTERM');
    escalation ??= setTimeout(() => { entry.escalated = true; signalOwned(entry, 'SIGKILL'); }, 2000);
  }
  const timer = setTimeout(() => stop(`${name} exceeded its deadline`), timeout);
  function collect(chunk: Buffer, destination: Buffer[], path: string) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) { stop(`${name} exceeded its bounded output allowance`); return; }
    destination.push(chunk); appendFileSync(path, chunk);
  }
  child.stdout?.on('data', (chunk: Buffer) => collect(chunk, stdout, stdoutPath));
  child.stderr?.on('data', (chunk: Buffer) => collect(chunk, stderr, stderrPath));
  child.once('error', error => { failure = error.message; });
  child.once('exit', () => {
    entry.exited = true;
    drainDeadline = setTimeout(() => {
      failure ??= `${name} left its output streams open after exit`;
      child.stdout?.destroy(); child.stderr?.destroy();
    }, 1000);
  });
  child.once('close', (code, signal) => {
    entry.exited = true; clearTimeout(timer); if (escalation) clearTimeout(escalation); if (drainDeadline) clearTimeout(drainDeadline);
    const result: ChildResult = { code: failure ? 1 : code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: [Buffer.concat(stderr).toString('utf8'), failure].filter(Boolean).join('\n'), elapsedMs: Date.now() - startAt };
    commands.push({ name, code: result.code, signal, elapsedMs: result.elapsedMs }); saveReport(); resolveDone(result);
  });
  return entry;
}

async function runCommand(name: string, argv: string[], timeoutMs: number, cwd = checkout): Promise<ChildResult> {
  const result = await startChild(name, argv, timeoutMs, cwd).done;
  if (result.code !== 0) throw new Error(`${name} failed (see private logs; exit ${result.code}, signal ${result.signal}).`);
  return result;
}

async function stopChild(entry: OwnedChild): Promise<void> {
  if (entry.exited) { await entry.done; return; }
  signalOwned(entry, 'SIGTERM');
  const timer = setTimeout(() => { entry.escalated = true; signalOwned(entry, 'SIGKILL'); }, 3000);
  try { await entry.done; }
  finally { clearTimeout(timer); }
}

function emergencyStop(reason: string): void {
  if (interrupted) return;
  interrupted = true; process.exitCode = 1;
  report.failure = reason; report.completed = false; saveReport();
  for (const entry of children) { try { signalOwned(entry, 'SIGTERM'); } catch { /* Continue cleanup of the other owned children. */ } }
  emergencyExit = setTimeout(() => {
    for (const entry of children) {
      if (!entry.exited) entry.escalated = true;
      try { signalOwned(entry, 'SIGKILL'); } catch { /* The report already records interruption failure. */ }
    }
    report.cleanupPassed = children.every(entry => entry.exited);
    report.forcedChildren = children.filter(entry => entry.escalated).map(entry => entry.name);
    saveReport(); process.exit(1);
  }, 2500);
}
const onTerminate = () => emergencyStop('Clean-install check received SIGTERM.');
const onInterrupt = () => emergencyStop('Clean-install check received SIGINT.');
process.once('SIGTERM', onTerminate); process.once('SIGINT', onInterrupt);
const watchdog = setTimeout(() => emergencyStop('Overall five-minute watchdog expired.'), 300_000);

function excludedPath(path: string): string | null {
  if (isAbsolute(path) || path.includes('\\') || /[\x00-\x1f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return 'unsafe path';
  const deniedDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.swarm', '.artifacts', '.pi', '.codex', '.research-staging', '.aws', '.ssh', '.gnupg', '.azure', 'sessions', 'logs', 'private', 'secrets']);
  if (path.split('/').some(part => deniedDirectories.has(part) || part.startsWith('.env'))) return 'runtime, dependency, build, or private path';
  const basename = path.split('/').at(-1) ?? '';
  if (/^(?:auth|credentials|tokens?|models-store)\.json$|^id_(?:rsa|ed25519)$|^\.(?:netrc|npmrc|pypirc|git-credentials)$|\.(?:pem|key|p12|pfx|sqlite|sqlite-wal|sqlite-shm|db|log)$/i.test(basename)) return 'credential or runtime file';
  return null;
}

async function sourcePaths(name: string): Promise<string[]> {
  const result = await runCommand(name, ['git', '-C', source, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], 15_000, source);
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
}

async function copySource(): Promise<void> {
  const paths = await sourcePaths('source-paths');
  check(paths.length > 0 && paths.length <= 4096, 'bounded nonempty source inventory', { files: paths.length });
  const manifest: ManifestEntry[] = [];
  let totalBytes = 0;
  for (const path of paths) {
    remaining(1);
    const reason = excludedPath(path);
    if (reason) { excluded.push({ path, reason }); continue; }
    const from = join(source, path);
    let metadata;
    try { metadata = await lstat(from); }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') { excluded.push({ path, reason: 'deleted from current worktree' }); continue; }
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) { excluded.push({ path, reason: 'not an ordinary file' }); continue; }
    if (await realpath(from) !== from) throw new Error(`Source path crosses a symlink: ${path}`);
    totalBytes += metadata.size;
    if (metadata.size > 16 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) throw new Error('Source snapshot exceeds its byte allowance.');
    const bytes = await readFile(from);
    if (bytes.length !== metadata.size) throw new Error(`Source changed during capture: ${path}`);
    // The native transport regression uses this exact public, synthetic token.
    const scannedText = bytes.toString('utf8').replaceAll('sk-ant-oat01-fixture-not-a-real-credential', 'synthetic-token');
    if (/\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,})|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(scannedText)) throw new Error(`Credential pattern in source path ${path}; review before copying.`);
    const destination = join(checkout, path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { flag: 'wx', mode: metadata.mode & 0o777 });
    manifest.push({ path, bytes: bytes.length, mode: metadata.mode & 0o777, sha256: sha256(bytes) });
  }
  for (const entry of manifest) if (sha256(await readFile(join(source, entry.path))) !== entry.sha256) throw new Error(`Source changed during snapshot: ${entry.path}`);
  const pathsAfter = await sourcePaths('source-paths-after');
  check(JSON.stringify(pathsAfter) === JSON.stringify(paths), 'source inventory stable during capture');
  check(manifest.some(entry => entry.path === 'package.json') && manifest.some(entry => entry.path === 'bun.lock'), 'snapshot includes manifests and frozen lock');
  await writeFile(join(output, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  report.manifestSha256 = sha256(JSON.stringify(manifest)); report.copiedFiles = manifest.length; report.sourceBytes = totalBytes; saveReport();
}

async function freePort(exclude: Set<number>): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = createServer();
    await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const address = server.address();
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    if (address && typeof address !== 'string' && !exclude.has(address.port)) return address.port;
  }
  throw new Error('Could not allocate fresh private loopback ports.');
}

function parseStatus(value: unknown): Status {
  if (typeof value !== 'object' || value === null || !('workers' in value) || !Array.isArray(value.workers) || !('swarms' in value) || !Array.isArray(value.swarms)) throw new Error('Invalid status response.');
  const workers = value.workers.map((worker: unknown): WorkerStatus => {
    if (typeof worker !== 'object' || worker === null || !('id' in worker) || typeof worker.id !== 'string' || !('pid' in worker) || typeof worker.pid !== 'number' || !('heartbeatAt' in worker) || typeof worker.heartbeatAt !== 'number' || !('status' in worker) || (worker.status !== 'online' && worker.status !== 'offline')) throw new Error('Invalid worker status.');
    return { id: worker.id, pid: worker.pid, heartbeatAt: worker.heartbeatAt, status: worker.status };
  });
  return { workers, swarms: value.swarms };
}

let statusSequence = 0;
async function cliStatus(): Promise<Status> {
  const result = await runCommand(`status-${++statusSequence}`, [process.execPath, 'run', join(checkout, 'apps/cli/main.ts'), 'status'], 15_000);
  return parseStatus(JSON.parse(result.stdout));
}

async function eventually<T>(description: string, operation: () => Promise<T | null>): Promise<T> {
  const until = Date.now() + remaining(20_000); let lastFailure: unknown;
  while (Date.now() < until) {
    try { const value = await operation(); if (value !== null) return value; }
    catch (error) { lastFailure = error; }
    await new Promise(resolvePause => setTimeout(resolvePause, 250));
  }
  throw new Error(`${description} did not become ready.`, { cause: lastFailure });
}

async function servedAssets(origin: string): Promise<string> {
  const response = await eventually('Copied web service', async () => {
    const candidate = await fetch(origin, { signal: AbortSignal.timeout(1500) });
    return candidate.ok ? candidate : null;
  });
  const html = await response.text();
  check(html.includes('<title>SwarmSpindle</title>') && html.includes('/app.js') && !html.includes('__CSRF__'), 'actual copied dashboard HTML served');
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  check(cookie, 'web bootstrap cookie issued');
  const script = await fetch(`${origin}/app.js`, { signal: AbortSignal.timeout(5000) });
  const javascript = await script.text();
  check(script.ok && (script.headers.get('content-type') ?? '').includes('javascript') && javascript.length > 1000, 'actual copied dashboard JavaScript served', { bytes: javascript.length, sha256: sha256(javascript) });
  return cookie;
}

async function apiStatus(origin: string, cookie: string): Promise<Status> {
  const headers = { cookie };
  const [workers, swarms] = await Promise.all(['/api/workers', '/api/swarms'].map(async path => {
    const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Copied API returned ${response.status} for ${path}.`);
    return await response.json();
  }));
  return parseStatus({ workers, swarms });
}

try {
  await copySource();
  await runCommand('install', [process.execPath, 'install', '--frozen-lockfile'], 120_000);
  await runCommand('typecheck', [process.execPath, 'run', 'typecheck'], 60_000);
  await runCommand('build', [process.execPath, 'run', 'build'], 60_000);
  const port = await freePort(new Set([5178, 5179]));
  const previewPort = await freePort(new Set([5178, 5179, port]));
  environment.SWARM_PORT = String(port); environment.SWARM_PREVIEW_PORT = String(previewPort);
  const origin = `http://127.0.0.1:${port}`;
  report.ports = { port, previewPort };
  const web = startChild('web-initial', [process.execPath, 'run', join(checkout, 'apps/web/main.ts')], 90_000);
  const worker = startChild('worker', [process.execPath, 'run', join(checkout, 'apps/worker/main.ts')], 90_000);
  const cookie = await servedAssets(origin);
  const initial = await eventually('Copied worker registration', async () => {
    const status = await cliStatus();
    return status.workers.length === 1 && status.workers[0]?.status === 'online' ? status : null;
  });
  const identity = initial.workers[0];
  check(identity && identity.pid === worker.child.pid && initial.swarms.length === 0, 'private empty queue and exact owned worker PID', identity);
  const apiInitial = await apiStatus(origin, cookie);
  check(apiInitial.workers[0]?.id === identity.id && apiInitial.swarms.length === 0, 'authenticated API agrees with copied CLI');
  await stopChild(web);
  check((await web.done).code === 0 && !web.escalated, 'web-only stop was graceful');
  const whileWebStopped = await cliStatus();
  const stoppedBaseline = whileWebStopped.workers[0];
  check(stoppedBaseline && stoppedBaseline.id === identity.id && stoppedBaseline.pid === identity.pid && stoppedBaseline.status === 'online', 'same worker remains registered after web exit');
  const surviving = await eventually('Same worker heartbeat while web is stopped', async () => {
    const status = await cliStatus();
    const candidate = status.workers[0];
    return candidate && candidate.id === identity.id && candidate.pid === identity.pid && candidate.status === 'online' && candidate.heartbeatAt > stoppedBaseline.heartbeatAt ? status : null;
  });
  check(!worker.exited && surviving.swarms.length === 0, 'actual worker survived web stop and heartbeat advanced', { before: stoppedBaseline.heartbeatAt, after: surviving.workers[0]?.heartbeatAt });
  const restartedWeb = startChild('web-restarted', [process.execPath, 'run', join(checkout, 'apps/web/main.ts')], 60_000);
  const restartedCookie = await servedAssets(origin);
  const afterRestart = await apiStatus(origin, restartedCookie);
  check(afterRestart.workers[0]?.id === identity.id && afterRestart.workers[0]?.pid === identity.pid && afterRestart.workers[0]?.status === 'online' && afterRestart.swarms.length === 0, 'restarted web sees same worker and untouched empty queue');
  await stopChild(restartedWeb); await stopChild(worker);
  check((await restartedWeb.done).code === 0 && !restartedWeb.escalated, 'restarted web shutdown was graceful');
  const final = await cliStatus();
  check((await worker.done).code === 0 && !worker.escalated && final.workers[0]?.id === identity.id && final.workers[0]?.status === 'offline', 'worker shutdown was graceful and durable');
  check(final.swarms.length === 0 && (await readdir(piDirectory)).length === 0, 'no queued model work or private Pi credential changes');
  report.completed = true;
} catch (error) {
  report.failure ??= error instanceof Error ? error.message : 'Unknown clean-install failure.';
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled(children.filter(entry => !entry.exited).map(entry => stopChild(entry)));
  report.cleanupPassed = cleanup.every(result => result.status === 'fulfilled') && children.every(entry => entry.exited);
  report.forcedChildren = children.filter(entry => entry.escalated).map(entry => entry.name);
  if (interrupted || !report.cleanupPassed || children.some(entry => entry.escalated)) { report.completed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); saveReport(); clearTimeout(watchdog);
  if (emergencyExit) clearTimeout(emergencyExit);
  process.removeListener('SIGTERM', onTerminate); process.removeListener('SIGINT', onInterrupt);
  console.log(JSON.stringify({ completed: report.completed, manifestSha256: report.manifestSha256, elapsedMs: report.elapsedMs, reportPath, providerRequests: 0 }));
}
