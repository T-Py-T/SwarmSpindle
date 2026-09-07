import { describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPodmanSandbox } from '@simpleswarm/sandbox';
import type { Sandbox } from '@simpleswarm/sandbox';
import type { WorkspaceFile } from '@simpleswarm/swarm';

const integration = process.env.SIMPLESWARM_SANDBOX_INTEGRATION === '1' ? describe : describe.skip;
function run(sandbox: Sandbox, command: string, options: { signal?: AbortSignal; swarmId?: string; files?: WorkspaceFile[]; timeoutSeconds?: number } = {}) {
  return sandbox.execute({ swarmId: options.swarmId ?? 'integration', agentId: 'agent', command, files: options.files ?? [], timeoutSeconds: options.timeoutSeconds ?? 15, signal: options.signal ?? new AbortController().signal });
}

integration('real rootless Podman boundary', () => {
  test('requires a running engine and the built sandbox image', async () => {
    expect(await createPodmanSandbox().check()).toMatchObject({ ready: true });
    expect(await createPodmanSandbox({ image: 'localhost/simpleswarm-deliberately-absent:missing' }).check()).toMatchObject({ ready: false });
  }, 60_000);

  test('executes offline tools and returns actual binary changes without mutating its input', async () => {
    const sandbox = createPodmanSandbox();
    const original: WorkspaceFile = { path: 'old.txt', contentBase64: 'b2xk', revision: 7, authorId: 'test', reason: 'seed', createdAt: 1, size: 3, deleted: false };
    const result = await run(sandbox, `set -eu
python3 -c 'from PIL import Image; import cairosvg; Image.new("RGB",(8,8),(255,0,0)).save("image.png")'
node <<'NODE'
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({args:['--no-sandbox']});
  const page=await browser.newPage();
  await page.setContent('<canvas id="c" width="100" height="100"></canvas><script>c.getContext("2d").fillRect(0,0,50,50)</script>');
  await page.screenshot({path:'canvas.png'});
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
NODE
printf new > old.txt
printf ready`, { files: [original], timeoutSeconds: 60 });
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ready');
    expect(result.changes.find(change => change.path === 'old.txt')).toEqual({ path: 'old.txt', baseRevision: 7, contentBase64: 'bmV3' });
    for (const name of ['image.png', 'canvas.png']) {
      const image = result.changes.find(change => change.path === name);
      expect(Buffer.from(image?.contentBase64 ?? '', 'base64').subarray(1, 4).toString()).toBe('PNG');
    }
    expect(original.contentBase64).toBe('b2xk');
  }, 120_000);

  test('does not expose host files, provider environment, network or root writes', async () => {
    const sandbox = createPodmanSandbox();
    const result = await run(sandbox, `set -eu
test "$(id -u)" != 0
test ! -e /Users/taylor/.pi
test ! -e /var/run/docker.sock
test -z "\${ANTHROPIC_API_KEY-}"
test -z "\${OPENAI_API_KEY-}"
test -z "\${SSH_AUTH_SOCK-}"
if touch /host-escape 2>/dev/null; then exit 9; fi
if touch /snapshot/write 2>/dev/null; then exit 10; fi
python3 -c 'import socket; s=socket.socket(); s.settimeout(1); status=s.connect_ex(("1.1.1.1",443)); assert status != 0'
printf isolated`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('isolated');
    expect(result.changes).toEqual([]);
  }, 60_000);

  test.each(['ln -s /etc/passwd escape', 'mkdir sub; ln -s /tmp sub/link', 'mkfifo pipe', 'echo x > original; ln original hardlink'])('rejects unsafe filesystem output: %s', async command => {
    await expect(run(createPodmanSandbox(), command)).rejects.toThrow('validation');
  }, 60_000);

  test('kills escaped background descendants before exporting', async () => {
    const result = await run(createPodmanSandbox(), `python3 -c 'import os,time; pid=os.fork(); (os.setsid(),time.sleep(2),open("late.txt","w").write("bad")) if pid == 0 else None' &
printf immediate > early.txt`);
    expect(result.exitCode).toBe(0);
    expect(result.changes.map(change => change.path)).toEqual(['early.txt']);
  }, 60_000);

  test('bounds output and returns an explicit timeout status', async () => {
    const sandbox = createPodmanSandbox();
    const output = await run(sandbox, `python3 -c 'print("x"*1000000)'`);
    expect(output.stdout.length).toBeLessThan(263_000);
    expect(output.stdout).toContain('[output truncated]');
    const timeout = await run(sandbox, 'sleep 30', { timeoutSeconds: 1 });
    expect(timeout.exitCode).toBe(124);
    expect(timeout.stderr).toContain('timed out');
  }, 90_000);

  test('cancels queued work and stops only the matching swarm', async () => {
    const sandbox = createPodmanSandbox({ maxConcurrent: 1 });
    const first = run(sandbox, 'sleep 1; printf first', { swarmId: 'other' });
    const queued = run(sandbox, 'printf should-never-run', { swarmId: 'cancel-me' }).then(() => 'ran', () => 'cancelled');
    await sandbox.stop('cancel-me');
    expect(await queued).toBe('cancelled');
    expect((await first).stdout).toBe('first');
    expect((await run(sandbox, 'printf recovered')).stdout).toBe('recovered');
  }, 90_000);

  test('honors external cancellation and cleans private snapshots', async () => {
    const directory = await mkdtemp(join(await realpath(homedir()), '.swarm-test-'));
    try {
      const sandbox = createPodmanSandbox({ runtimeDirectory: directory });
      const controller = new AbortController();
      const pending = run(sandbox, 'sleep 30', { signal: controller.signal });
      const timer = setTimeout(() => controller.abort(new Error('test cancellation')), 3000);
      try { await expect(pending).rejects.toThrow(); } finally { clearTimeout(timer); }
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  test('an outside host sentinel is unchanged', async () => {
    const directory = await mkdtemp(join(await realpath(homedir()), '.swarm-sentinel-'));
    try {
      const sentinel = join(directory, 'keep.txt');
      await writeFile(sentinel, 'unchanged');
      const result = await run(createPodmanSandbox(), `test ! -e '${sentinel}'; printf checked`);
      expect(result.stdout).toBe('checked');
      expect(await Bun.file(sentinel).text()).toBe('unchanged');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);
});
