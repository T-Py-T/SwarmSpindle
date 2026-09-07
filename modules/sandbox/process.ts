import { spawn } from 'node:child_process';

export interface ProcessResult { exitCode: number; stdout: string; stderr: string }
export function podman(args: string[], options: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const connection = process.env.SWARM_PODMAN_CONNECTION ?? (process.platform === 'darwin' ? 'podman-machine-default' : undefined);
    const invocation = connection ? ['--connection', connection, ...args] : args;
    const child = spawn('podman', invocation, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const fail = (reason: Error) => { failure ??= reason; child.kill('SIGKILL'); };
    const cancel = () => fail(new Error('Sandbox command cancelled.', { cause: options.signal?.reason }));
    const timer = setTimeout(() => fail(new Error('Podman operation timed out.')), options.timeoutMs ?? 20_000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 256 * 1024)) fail(new Error('Podman output exceeds its safety limit.'));
      else chunks.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', error => { failure ??= error; });
    child.on('close', code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else resolve({ exitCode: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}
