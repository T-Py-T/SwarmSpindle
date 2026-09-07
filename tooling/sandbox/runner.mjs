import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const limits = { entries: 4096, fileBytes: 16 * 1024 * 1024, totalBytes: 48 * 1024 * 1024, outputBytes: 256 * 1024 };

function validatePath(path) {
  if (!path || path.length > 512 || path.startsWith('/') || path.includes('\\') || /[\x00-\x1f]/.test(path)) throw new Error('Invalid output path.');
  const components = path.split('/');
  if (components.some(component => !component || component === '.' || component === '..') || components[0] === '.git' || components[0] === '.swarm') throw new Error('Reserved or unsafe output path.');
}

async function scan(root) {
  const files = [];
  let entries = 0;
  let totalBytes = 0;
  async function visit(relative) {
    const children = await readdir(join(root, relative), { withFileTypes: true });
    for (const child of children) {
      if (++entries > limits.entries) throw new Error('Workspace has too many entries.');
      const path = relative ? `${relative}/${child.name}` : child.name;
      validatePath(path);
      const absolute = join(root, path);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Symlinks are forbidden: ${path}`);
      if (stat.isDirectory()) { await visit(path); continue; }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Only ordinary unlinked files are allowed: ${path}`);
      totalBytes += stat.size;
      if (stat.size > limits.fileBytes || totalBytes > limits.totalBytes) throw new Error('Workspace output exceeds size limits.');
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.ino !== stat.ino || current.dev !== stat.dev || current.nlink !== 1 || current.size !== stat.size) throw new Error('Workspace changed during export.');
        const bytes = await handle.readFile();
        if (bytes.length !== current.size) throw new Error('Workspace size changed during export.');
        files.push({ path, contentBase64: bytes.toString('base64') });
      } finally { await handle.close(); }
    }
  }
  await visit('');
  return files;
}

async function copySnapshot() {
  const files = await scan('/snapshot');
  for (const file of files) {
    const components = file.path.split('/');
    components.pop();
    await mkdir(join('/workspace', ...components), { recursive: true, mode: 0o755 });
    const destination = join('/workspace', file.path);
    await copyFile(join('/snapshot', file.path), destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o644);
  }
  await mkdir('/tmp/home', { mode: 0o700 });
}

function killCommandProcesses() {
  // Linux excludes the calling process and PID 1; the private PID namespace contains only this command.
  try { process.kill(-1, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function ensureProcessesStopped() {
  const deadline = Date.now() + 3000;
  while (true) {
    killCommandProcesses();
    let active = false;
    for (const pid of await readdir('/proc')) {
      if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
      try {
        const status = await readFile(`/proc/${pid}/stat`, 'utf8');
        const state = status.slice(status.lastIndexOf(')') + 2, status.lastIndexOf(')') + 3);
        if (state !== 'Z' && state !== 'X') active = true;
      } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
    }
    if (!active) return;
    if (Date.now() > deadline) throw new Error('Unable to stop every command process before export.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function runCommand(command, timeoutSeconds) {
  const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], {
    cwd: '/workspace', detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/opt/tooling/node_modules/.bin:/usr/local/bin:/usr/bin:/bin', HOME: '/tmp/home', TMPDIR: '/tmp', LANG: 'C.UTF-8', NODE_PATH: '/opt/tooling/node_modules', PLAYWRIGHT_BROWSERS_PATH: '/opt/browsers' },
  });
  function capture(stream) {
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    stream.on('data', chunk => {
      const remaining = limits.outputBytes - bytes;
      if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); bytes += Math.min(remaining, chunk.length); }
      if (chunk.length > remaining) truncated = true;
    });
    return () => {
      // Replacement characters can expand malformed UTF-8; bound the final encoded string too.
      let output = Buffer.concat(chunks).toString('utf8');
      while (Buffer.byteLength(output) > limits.outputBytes) output = output.slice(0, Math.floor(output.length * 0.9));
      return output + (truncated ? '\n[output truncated]' : '');
    };
  }
  const stdout = capture(child.stdout);
  const stderr = capture(child.stderr);
  const closed = new Promise(resolve => child.once('close', resolve));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killCommandProcesses(); }, timeoutSeconds * 1000);
  let exitCode;
  try {
    // Exit fires even when a background descendant still has the output pipe open.
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(timedOut ? 124 : code ?? (signal ? 137 : 1)));
    });
    await ensureProcessesStopped();
    await closed;
  } finally { clearTimeout(timer); }
  return { exitCode, stdout: stdout(), stderr: stderr() + (timedOut ? '\n[command timed out]' : '') };
}

try {
  const command = Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8');
  const timeoutSeconds = Number(process.argv[3]);
  if (!command || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 600) throw new Error('Invalid runner arguments.');
  await copySnapshot();
  const result = await runCommand(command, timeoutSeconds);
  const files = await scan('/workspace');
  process.stdout.write(JSON.stringify({ protocol: 1, ...result, files }));
} catch (error) {
  process.stderr.write(`Sandbox validation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
