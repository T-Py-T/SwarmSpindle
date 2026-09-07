import { afterEach, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openSwarmStore, parseSwarmSpec, type SwarmStore } from '../modules/swarm/index.ts';

const repository = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(new URL('../tooling/run-challenge.ts', import.meta.url));
const roots: string[] = [];
const stores: SwarmStore[] = [];
const heartbeats: ReturnType<typeof setInterval>[] = [];
const children: ReturnType<typeof launch>[] = [];

function launch(dataDirectory: string, args: string[], limitMs = 9000) {
  // A dedicated process group lets timeout cleanup kill the observer and its export/verifier children.
  const child = spawn(process.execPath, [runner, ...args], {
    cwd: repository, env: { ...process.env, SWARM_DATA_DIR: dataDirectory },
    detached: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; let timedOut = false; let finished = false;
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16_000); });
  const kill = () => {
    if (!child.pid || finished) return;
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  const timer = setTimeout(() => { timedOut = true; kill(); }, limitMs);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stderr: string }>((resolve, reject) => {
    child.once('error', error => { finished = true; clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { finished = true; clearTimeout(timer); resolve({ code, signal, timedOut, stderr }); });
  });
  // Assertions can fail before the observer exits; cleanup still owns its termination and rejection.
  void exited.catch(() => {});
  return { exited, kill };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sss-challenge-runner-')); roots.push(root);
  const data = join(root, 'data'); await mkdir(data);
  const store = openSwarmStore(join(data, 'swarm.sqlite')); stores.push(store);
  const worker = 'synthetic-online-record-no-worker-process';
  store.registerWorker(worker, process.pid);
  heartbeats.push(setInterval(() => store.heartbeatWorker(worker), 500));
  return { root, data, store };
}

async function until(predicate: () => Promise<boolean>, limitMs: number) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) { if (await predicate()) return; await Bun.sleep(25); }
  throw new Error('Challenge runner fixture did not reach the expected state before its deadline.');
}

afterEach(async () => {
  heartbeats.splice(0).forEach(clearInterval);
  const active = children.splice(0); active.forEach(child => child.kill());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(active.map(child => child.exited)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Challenge runner process cleanup timed out.')), 1000); }),
    ]);
  } finally {
    clearTimeout(timer); stores.splice(0).forEach(store => store.close());
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  }
});

test('concurrent launchers with different directories create one durable thirty-peer $50 attempt', async () => {
  const f = await fixture();
  const contenders = ['first', 'second'].map(name => launch(f.data, ['pelican', join(f.root, name)])); children.push(...contenders);
  const claimPath = join(f.data, 'acceptance-pelican.json');
  await until(async () => {
    if (f.store.listSwarms().length !== 1) return false;
    try { return typeof JSON.parse(await readFile(claimPath, 'utf8')).swarmId === 'string'; }
    catch { return false; } // The durable claim starts pending, then receives its run identity.
  }, 3000);
  const run = f.store.listSwarms()[0]!;
  expect(run.status).toBe('queued'); expect(run.agents).toHaveLength(30);
  expect(run.spec.model).toEqual({ provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' });
  expect(run.spec.agentCount).toBe(30); expect(run.spec.budgetMicros).toBe(50_000_000);
  expect(run.spec.finalOutput).toBe('pelican.svg'); expect(run.agents.every(agent => agent.sessionId === null)).toBe(true);
  const claimBytes = await readFile(claimPath, 'utf8'); const claim = JSON.parse(claimBytes);
  expect(claim.swarmId).toBe(run.id); expect(claim.kind).toBe('pelican');
  expect(claim.specSha256).toBe(createHash('sha256').update(JSON.stringify(run.spec)).digest('hex'));
  expect((await readdir(f.data)).filter(name => /^acceptance-.*\.json$/.test(name))).toEqual(['acceptance-pelican.json']);
  // No worker ever claims the run: cancellation lets the finite observer export and fail on absent output.
  f.store.stopSwarm(run.id, 'Synthetic concurrency test: never invoke models.');
  const results = await Promise.all(contenders.map(child => child.exited));
  expect(results.every(result => !result.timedOut && result.signal === null && result.code === 1)).toBe(true);
  expect(results.filter(result => /EEXIST/.test(result.stderr))).toHaveLength(1);
  expect(f.store.listSwarms()).toHaveLength(1); expect(f.store.getSwarm(run.id).status).toBe('cancelled');
  expect(f.store.reservations(run.id)).toEqual([]);
  expect(f.store.events(run.id).some(event => ['session_verified', 'model_response', 'swarm_started'].includes(event.kind))).toBe(false);
  expect(await readFile(claimPath, 'utf8')).toBe(claimBytes);
  const receipt = JSON.parse(await readFile(join(claim.directory, 'export', 'receipt.json'), 'utf8'));
  expect(receipt.run.id).toBe(run.id); expect(receipt.run.status).toBe('cancelled'); expect(receipt.files).toEqual([]);
}, 11_000);

test('an unrelated terminal pelican without the durable claim cannot authorize a canvas budget', async () => {
  const f = await fixture();
  const unrelated = f.store.createSwarm(parseSwarmSpec({
    title: 'Unrelated synthetic pelican', task: 'No challenge authorization.', definitionOfDone: 'Never run a model.',
    finalOutput: 'pelican.svg', agentCount: 30, budgetMicros: 50_000_000,
    model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' },
  }));
  f.store.stopSwarm(unrelated.id, 'Synthetic unrelated terminal run.');
  const seed = join(f.root, 'seed'); await mkdir(seed);
  const child = launch(f.data, ['canvas', join(f.root, 'canvas'), seed], 2500); children.push(child);
  const result = await child.exited;
  expect(result.timedOut).toBe(false); expect(result.signal).toBeNull(); expect(result.code).toBe(1);
  expect(result.stderr).toContain('acceptance-pelican.json');
  expect(f.store.listSwarms().map(run => run.id)).toEqual([unrelated.id]);
  expect((await readdir(f.data)).filter(name => /^acceptance-.*\.json$/.test(name))).toEqual([]);
  expect(f.store.reservations(unrelated.id)).toEqual([]);
}, 3500);


test('canvas follows the exact finished first attempt without changing its failed status or held liability', async () => {
  const f = await fixture();
  const prior = f.store.createSwarm(parseSwarmSpec({
    title: 'Synthetic ordered attempt fixture', task: 'Test ordering only; no inference.',
    definitionOfDone: 'No real acceptance evidence.', finalOutput: 'pelican.svg',
    agentCount: 30, budgetMicros: 50_000_000,
    model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' },
  }));
  f.store.claimNextSwarm('synthetic-online-record-no-worker-process');
  for (const agent of prior.agents) f.store.startAgent({ swarmId: prior.id, agentId: agent.id }, `SYNTHETIC-ordering-only/${agent.id}`);
  const liability = f.store.reserve({ swarmId: prior.id, agentId: prior.agents[0]!.id }, 45_000_000, 'Synthetic test ceiling, no provider request.');
  f.store.markUncertain(liability.id, 'Synthetic retained liability fixture.');
  const claimPath = join(f.data, 'acceptance-pelican.json');
  const originalClaim = JSON.stringify({ kind: 'pelican', swarmId: prior.id, specSha256: createHash('sha256').update(JSON.stringify(prior.spec)).digest('hex') });
  await writeFile(claimPath, originalClaim);
  const seed = join(f.root, 'seed'); await mkdir(seed);
  const early = launch(f.data, ['canvas', join(f.root, 'too-early'), seed], 2500); children.push(early);
  expect((await early.exited).stderr).toContain('must finish before canvas starts');
  expect(f.store.listSwarms()).toHaveLength(1);
  for (const agent of prior.agents) f.store.endAgent({ swarmId: prior.id, agentId: agent.id }, 'bailed', 'Synthetic budget end.');
  f.store.finishSwarm(prior.id, 'budget_exhausted', 'Synthetic ordering fixture.');
  const before = JSON.stringify({ run: f.store.getSwarm(prior.id), reservations: f.store.reservations(prior.id) });
  const child = launch(f.data, ['canvas', join(f.root, 'canvas'), seed]); children.push(child);
  await until(async () => f.store.listSwarms().length === 2 && await Bun.file(join(f.root, 'canvas', 'launch.json')).exists(), 3000);
  const canvas = f.store.listSwarms().find(run => run.id !== prior.id)!;
  expect(canvas.spec.model).toEqual({ provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' });
  expect(canvas.agents).toHaveLength(30); expect(canvas.spec.budgetMicros).toBe(50_000_000);
  const intent = JSON.parse(await readFile(join(f.root, 'canvas', 'intent.json'), 'utf8'));
  expect(intent.precedingAttempt).toEqual({ swarmId: prior.id, status: 'budget_exhausted', acceptanceAssessedByRunner: false });
  f.store.stopSwarm(canvas.id, 'Synthetic observer cleanup; no actual worker.');
  const result = await child.exited;
  expect(result.timedOut).toBe(false); expect(result.code).toBe(1);
  expect(JSON.stringify({ run: f.store.getSwarm(prior.id), reservations: f.store.reservations(prior.id) })).toBe(before);
  expect(await readFile(claimPath, 'utf8')).toBe(originalClaim);
  expect(f.store.reservations(canvas.id)).toEqual([]);
}, 13_000);
