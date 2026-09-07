import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import type { Sandbox, SandboxCheck, SandboxResult } from './contracts.ts';
import { CommandQueue } from './queue.ts';
import { podman } from './process.ts';
import { compareSnapshot, materializeSnapshot, validateSnapshot, workspaceLimits, type SnapshotEntry } from './snapshot.ts';

const defaultImage = 'localhost/simpleswarm-sandbox:1';
const ownerLabel = 'io.simpleswarm.instance';
interface Execution { swarmId: string; cancel: AbortController; done: Promise<void> }
export interface PodmanSandboxOptions { image?: string; maxConcurrent?: number; runtimeDirectory?: string }

function parseRunnerResult(stdout: string): { exitCode: number; stdout: string; stderr: string; files: SnapshotEntry[] } {
  const result: unknown = JSON.parse(stdout);
  if (typeof result !== 'object' || result === null || !('protocol' in result) || result.protocol !== 1 || !('exitCode' in result) || typeof result.exitCode !== 'number' || !Number.isSafeInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255 || !('stdout' in result) || typeof result.stdout !== 'string' || !('stderr' in result) || typeof result.stderr !== 'string' || !('files' in result) || !Array.isArray(result.files)) throw new Error('Invalid sandbox response.');
  if (Buffer.byteLength(result.stdout) > workspaceLimits.outputBytes + 64 || Buffer.byteLength(result.stderr) > workspaceLimits.outputBytes + 64 || result.files.length > workspaceLimits.entries) throw new Error('Sandbox response exceeds limits.');
  const files: SnapshotEntry[] = [];
  for (const entry of result.files) {
    if (typeof entry !== 'object' || entry === null || !('path' in entry) || typeof entry.path !== 'string' || !('contentBase64' in entry) || typeof entry.contentBase64 !== 'string') throw new Error('Invalid sandbox file response.');
    files.push({ path: entry.path, contentBase64: entry.contentBase64 });
  }
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, files };
}

async function privateSnapshotDirectory(runtimeDirectory: string): Promise<string> {
  const absolute = resolve(runtimeDirectory);
  if (/[\x00-\x1f,]/.test(absolute)) throw new Error('Sandbox runtime directory cannot contain mount separators or control characters.');
  let ancestor = parse(absolute).root;
  for (const component of absolute.slice(ancestor.length).split(sep).filter(Boolean)) {
    ancestor = join(ancestor, component);
    const stat = await lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Sandbox runtime directory must not contain symlinks.');
  }
  const directory = await mkdtemp(join(await realpath(absolute), 'simpleswarm-'));
  await chmod(directory, 0o700);
  return directory;
}

async function defaultRuntimeDirectory(): Promise<string> {
  // macOS Podman machines share the home directory, but may not share the system temporary directory.
  let directory = await realpath(homedir());
  for (const component of ['.cache', 'simpleswarmsystem', 'sandbox']) {
    directory = join(directory, component);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    }
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Sandbox cache directory must not be a symlink.');
  }
  return directory;
}

export function createPodmanSandbox(options: PodmanSandboxOptions = {}): Sandbox {
  const image = options.image ?? defaultImage;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/.test(image)) throw new Error('Invalid sandbox image reference.');
  const capacity = options.maxConcurrent ?? 4;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4) throw new Error('Sandbox concurrency must be between one and four.');
  if (options.runtimeDirectory && !isAbsolute(options.runtimeDirectory)) throw new Error('Sandbox runtime directory must be absolute.');
  const queue = new CommandQueue(capacity);
  const owner = randomUUID();
  const executions = new Set<Execution>();
  const stoppedSwarms = new Set<string>();
  const pendingCleanup = new Map<string, { swarmId: string; directory: string }>();

  async function check(): Promise<SandboxCheck> {
    try {
      const runtime = await podman(['info', '--format', '{{.Host.Security.Rootless}}']);
      if (runtime.exitCode !== 0 || runtime.stdout.trim() !== 'true') throw new Error('A running rootless Podman engine is required.');
      const inspection = await podman(['image', 'inspect', '--format', '{{index .Labels "io.simpleswarm.sandbox-protocol"}}', image]);
      if (inspection.exitCode !== 0 || inspection.stdout.trim() !== '1') throw new Error(`Build the trusted sandbox image ${image} using tooling/sandbox/Dockerfile.`);
      return { ready: true, reason: 'Rootless Podman and the sandbox image are ready.', image };
    } catch (error) {
      return { ready: false, reason: error instanceof Error ? error.message : String(error), image };
    }
  }

  async function removeContainer(name: string): Promise<void> {
    const inspection = await podman(['container', 'inspect', '--format', `{{index .Config.Labels "${ownerLabel}"}}`, name]);
    if (inspection.exitCode !== 0) {
      // `exists` distinguishes a missing container from a failed engine connection.
      const exists = await podman(['container', 'exists', name]);
      if (exists.exitCode === 1) return;
      throw new Error('Unable to verify sandbox container identity for cleanup.');
    }
    if (inspection.stdout.trim() !== owner) throw new Error('Refusing to remove a container owned by another sandbox instance.');
    const removal = await podman(['rm', '--force', '--time', '0', name]);
    if (removal.exitCode !== 0) throw new Error(`Sandbox container cleanup failed: ${removal.stderr.slice(0, 2048)}`);
  }

  async function execute(request: Parameters<Sandbox['execute']>[0]): Promise<SandboxResult> {
    const files = request.files.map(file => ({ ...file }));
    validateSnapshot(files);
    if (typeof request.command !== 'string' || request.command.length === 0 || Buffer.byteLength(request.command) > 32 * 1024 || request.command.includes('\0')) throw new Error('Sandbox command must contain between one and 32768 bytes without NUL characters.');
    if (!Number.isInteger(request.timeoutSeconds) || request.timeoutSeconds < 1 || request.timeoutSeconds > 600) throw new Error('Sandbox timeout must be between one and 600 seconds.');
    request.signal.throwIfAborted();
    if (stoppedSwarms.has(request.swarmId)) throw new Error('This swarm has been stopped.');
    const cancel = new AbortController();
    const signal = AbortSignal.any([request.signal, cancel.signal]);
    let complete: () => void = () => {};
    const done = new Promise<void>(resolve => { complete = resolve; });
    const execution = { swarmId: request.swarmId, cancel, done };
    executions.add(execution);
    let release: (() => void) | undefined;
    let directory: string | undefined;
    let attemptedCreate = false;
    const name = `simpleswarm-${owner}-${randomUUID()}`;
    const startedAt = Date.now();
    try {
      release = await queue.acquire(signal);
      signal.throwIfAborted();
      const readiness = await check();
      if (!readiness.ready) throw new Error(readiness.reason);
      signal.throwIfAborted();
      directory = await privateSnapshotDirectory(options.runtimeDirectory ?? await defaultRuntimeDirectory());
      const snapshot = join(directory, 'snapshot');
      await mkdir(snapshot, { mode: 0o755 });
      await materializeSnapshot(snapshot, files);
      signal.throwIfAborted();
      attemptedCreate = true;
      pendingCleanup.set(name, { swarmId: request.swarmId, directory });
      const created = await podman([
        'create', '--pull=never', '--name', name, '--label', `${ownerLabel}=${owner}`,
        '--network=none', '--http-proxy=false', '--hostname=swarm-sandbox', '--read-only', '--read-only-tmpfs=false', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--user=1000:1000', '--userns=keep-id', '--pids-limit=128', '--memory=768m', '--memory-swap=768m', '--cpus=2',
        '--ulimit=nofile=256:256', '--ulimit=fsize=16777216:16777216', '--ulimit=core=0:0',
        '--pid=private', '--ipc=private', '--shm-size=64m', '--workdir=/workspace',
        '--tmpfs=/workspace:rw,nosuid,nodev,size=64m,mode=1777', '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,mode=1777',
        '--mount', `type=bind,src=${snapshot},dst=/snapshot,ro=true`,
        '--env=HOME=/tmp/home', '--env=TMPDIR=/tmp', '--env=LANG=C.UTF-8',
        '--env=NODE_PATH=/opt/tooling/node_modules', '--env=PLAYWRIGHT_BROWSERS_PATH=/opt/browsers',
        '--entrypoint=node', image, '/opt/simpleswarm/runner.mjs', Buffer.from(request.command).toString('base64'), String(request.timeoutSeconds),
      ], { signal });
      if (created.exitCode !== 0) throw new Error(`Sandbox container creation failed: ${created.stderr.slice(0, 2048)}`);
      const process = await podman(['start', '--attach', name], { signal, timeoutMs: (request.timeoutSeconds + 30) * 1000, maxBytes: 72 * 1024 * 1024 });
      if (process.exitCode !== 0) throw new Error(`Sandbox execution or validation failed: ${process.stderr.slice(0, 4096)}`);
      signal.throwIfAborted();
      const result = parseRunnerResult(process.stdout);
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, changes: compareSnapshot(files, result.files), durationMs: Date.now() - startedAt };
    } finally {
      try {
        if (attemptedCreate) await removeContainer(name);
        if (directory) await rm(directory, { recursive: true, force: true });
        pendingCleanup.delete(name);
      } finally { executions.delete(execution); release?.(); complete(); }
    }
  }

  async function stop(swarmId: string): Promise<void> {
    stoppedSwarms.add(swarmId);
    const matching = [...executions].filter(execution => execution.swarmId === swarmId);
    for (const execution of matching) execution.cancel.abort(new Error('Swarm stopped.'));
    await Promise.all(matching.map(execution => execution.done));
    for (const [name, cleanup] of pendingCleanup) {
      if (cleanup.swarmId !== swarmId) continue;
      await removeContainer(name);
      await rm(cleanup.directory, { recursive: true, force: true });
      pendingCleanup.delete(name);
    }
  }

  return { check, execute, stop };
}
