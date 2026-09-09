import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSwarmStore, parseSwarmSpec, type Actor, type SwarmStore, type TraceEvent } from '@simpleswarm/swarm';
import { budgetAwareness, type BudgetAwareness } from '../modules/runtime/budget-awareness.ts';
import { assessBudgetProbe, queueBudgetProbe } from '../tooling/budget-probe.ts';
import { requireGuidanceEvidence } from '../tooling/swarm-retest.ts';

const stores: SwarmStore[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
interface Observation { event: Pick<TraceEvent, 'seq'>; snapshot: BudgetAwareness }

function fixture(target: number | null = 250_000) {
  const store = openSwarmStore(':memory:', { clock: () => 1000 }); stores.push(store);
  const run = store.createSwarm(parseSwarmSpec({
    title: 'Synthetic budget probe grading', task: 'Record two accurate budget checkpoints per peer.',
    definitionOfDone: 'Two distinct observations per peer and a canonical budget report.', finalOutput: 'budget-report.md',
    agentCount: 2, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' }, budgetMicros: 6_000_000,
    ...(target === null ? {} : { workingTargetMicros: target }), maxOutputTokens: 4096,
  }));
  store.registerWorker('probe-test-worker', process.pid); store.claimNextSwarm('probe-test-worker');
  const actors: Actor[] = run.agents.map(agent => ({ swarmId: run.id, agentId: agent.id }));
  const firstCandidate = actors[0]; const secondCandidate = actors[1]; const threadCandidate = store.threads(run.id)[0];
  if (!firstCandidate || !secondCandidate || !threadCandidate) throw new Error('Probe fixture requires two peers and a shared board.');
  const first = firstCandidate; const second = secondCandidate; const thread = threadCandidate;
  for (const actor of actors) store.startAgent(actor, `synthetic-${actor.agentId}`);
  function settle(actor: Actor, amount: number) {
    const reservation = store.reserve(actor, amount, 'Synthetic grader usage; no provider request');
    store.settle(reservation.id, amount, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
  }
  function observe(actor: Actor): Observation {
    const snapshot = budgetAwareness(store.getSwarm(run.id), actor);
    const event = store.appendEvent(run.id, actor.agentId, 'budget_observed', { ...snapshot });
    return { event, snapshot };
  }
  function checkpoint(actor: Actor, observation: Observation, overrides: Record<string, unknown> = {}) {
    const snapshot = observation.snapshot;
    const claim = {
      kind: 'budget_checkpoint', observationSeq: observation.event.seq, decision: snapshot.decision,
      capMicros: snapshot.capMicros, availableMicros: snapshot.availableMicros,
      settledMicros: snapshot.settledMicros, reservedMicros: snapshot.reservedMicros, uncertainMicros: snapshot.uncertainMicros,
      workingTargetMicros: snapshot.workingTargetMicros, targetRemainingMicros: snapshot.targetRemainingMicros,
      nextRequestCeilingMicros: snapshot.nextRequestCeilingMicros,
      action: snapshot.decision === 'ready' ? 'continue' : snapshot.decision === 'waiting_for_reservations' ? 'wait' : 'stop',
      explanation: 'Choose the action supported by this immutable budget observation.', ...overrides,
    };
    return store.post(actor, thread.id, JSON.stringify(claim));
  }
  function round() { for (const actor of actors) checkpoint(actor, observe(actor)); }
  function finish(report = true, bailed = false) {
    if (report) {
      store.claimFiles(first, ['budget-report.md'], 'Publish the synthetic grading report');
      store.publishFiles(first, [{ path: 'budget-report.md', baseRevision: 0, contentBase64: Buffer.from('Budget checkpoints are recorded on the shared board.').toString('base64') }], 'Fixture report');
    }
    for (const actor of actors) store.endAgent(actor, bailed && actor.agentId === first.agentId ? 'bailed' : 'done', 'Synthetic terminal fixture');
    store.finishSwarm(run.id, bailed ? 'bailed' : 'completed', 'Synthetic grading outcome');
  }
  function assess() {
    const current = store.getSwarm(run.id);
    const events = store.events(run.id);
    const messages = store.threads(run.id).flatMap(board => store.messages(run.id, board.id));
    const hasReport = store.files(run.id).some(file => file.path === 'budget-report.md' && file.size > 0);
    return assessBudgetProbe(current, events, messages, hasReport);
  }
  return { store, run, actors, first, second, settle, observe, checkpoint, round, finish, assess };
}

describe('budget probe evidence grading', () => {
  test('larger-run prerequisite rejects incomplete evidence and requires both verified Claude peers', () => {
    const f = fixture();
    expect(() => requireGuidanceEvidence(f.store, f.run.id)).toThrow('require a completed Claude budget probe');
    f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000); f.round(); f.finish();
    expect(f.assess().passed).toBe(true);
    expect(() => requireGuidanceEvidence(f.store, f.run.id)).toThrow('verified model responses');
    for (const actor of f.actors) f.store.appendEvent(f.run.id, actor.agentId, 'model_response', {
      provider: 'anthropic', responseModel: 'claude-opus-4-8', requestedModel: 'claude-opus-4-8', thinking: 'high',
    });
    expect(requireGuidanceEvidence(f.store, f.run.id).passed).toBe(true);
  });
  test('accepts two completed peers citing two distinct accurate balances each', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000); f.round(); f.finish();
    const events = f.store.events(f.run.id); const ledger = f.store.reservations(f.run.id);
    const result = f.assess();
    expect(result.passed).toBe(true); expect(result.peers).toHaveLength(2);
    for (const peer of result.peers) expect(peer).toMatchObject({ validCheckpoints: 2, invalidCheckpoints: 0, uniqueObservations: 2, distinctBalances: 2, status: 'done', passed: true });
    expect(result.peakObservedSettledMicros).toBe(100_000);
    expect(result.observedNearTarget).toBe(false); expect(result.observedTargetReached).toBe(false); expect(result.targetReachedByFinalSettlement).toBe(false);
    expect(f.store.events(f.run.id)).toEqual(events); expect(f.store.reservations(f.run.id)).toEqual(ledger);
  });

  for (const field of ['decision', 'capMicros', 'availableMicros', 'settledMicros', 'reservedMicros', 'uncertainMicros', 'workingTargetMicros', 'targetRemainingMicros', 'nextRequestCeilingMicros'] as const) {
    test(`rejects a checkpoint with incorrect ${field} despite otherwise sufficient evidence`, () => {
      const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000);
      const observation = f.observe(f.first); const original = observation.snapshot[field];
      f.checkpoint(f.first, observation, { [field]: typeof original === 'number' ? original + 1 : 'forged' });
      f.checkpoint(f.second, f.observe(f.second)); f.finish();
      const result = f.assess(); expect(result.passed).toBe(false);
      expect(result.peers[0]?.invalidCheckpoints).toBe(1); expect(result.peers[1]?.passed).toBe(true);
    });
  }

  test('rejects an action unsupported by the cited ready decision', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000);
    f.checkpoint(f.first, f.observe(f.first), { action: 'spend_without_limit' });
    f.checkpoint(f.second, f.observe(f.second)); f.finish();
    expect(f.assess().passed).toBe(false); expect(f.assess().peers[0]?.invalidCheckpoints).toBe(1);
  });

  test('rejects continue after the working target is reached', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 200_000);
    const reached = f.observe(f.first); expect(reached.snapshot.decision).toBe('working_target_reached');
    f.checkpoint(f.first, reached, { action: 'continue' }); f.checkpoint(f.second, f.observe(f.second)); f.finish();
    expect(f.assess().passed).toBe(false); expect(f.assess().peers[0]?.invalidCheckpoints).toBe(1);
  });

  test('rejects an empty explanation even when all copied values match', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000);
    f.checkpoint(f.first, f.observe(f.first), { explanation: '   ' }); f.checkpoint(f.second, f.observe(f.second)); f.finish();
    expect(f.assess().passed).toBe(false);
  });

  test('rejects another peer’s observation even when both peers saw identical shared balances', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000);
    const otherPeer = f.observe(f.second);
    f.checkpoint(f.first, otherPeer); f.checkpoint(f.second, otherPeer); f.finish();
    const result = f.assess(); expect(result.passed).toBe(false);
    expect(result.peers[0]?.invalidCheckpoints).toBe(1); expect(result.peers[1]?.passed).toBe(true);
  });

  test('does not count a duplicated citation as a second observation or balance', () => {
    const f = fixture(); f.settle(f.first, 50_000);
    const observations = f.actors.map(actor => ({ actor, observation: f.observe(actor) }));
    for (const { actor, observation } of observations) f.checkpoint(actor, observation);
    f.settle(f.second, 50_000);
    for (const { actor, observation } of observations) f.checkpoint(actor, observation);
    f.finish(); const result = f.assess(); expect(result.passed).toBe(false);
    for (const peer of result.peers) expect(peer).toMatchObject({ validCheckpoints: 2, uniqueObservations: 1, distinctBalances: 1, passed: false });
  });

  test('requires a changed settled balance even for distinct observation events', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.round(); f.finish();
    const result = f.assess(); expect(result.passed).toBe(false);
    for (const peer of result.peers) expect(peer).toMatchObject({ uniqueObservations: 2, distinctBalances: 1, passed: false });
  });

  test('rejects a forged future observation using event order even when wall-clock timestamps match', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000);
    const last = f.store.events(f.run.id).at(-1); if (!last) throw new Error('Expected existing fixture evidence.');
    const guessed = { event: { seq: last.seq + 2 }, snapshot: budgetAwareness(f.store.getSwarm(f.run.id), f.first) };
    const posted = f.checkpoint(f.first, guessed);
    const future = f.observe(f.first); expect(future.event.seq).toBe(guessed.event.seq);
    const futureEvent = f.store.events(f.run.id).find(event => event.seq === future.event.seq);
    if (!futureEvent) throw new Error('Expected the future observation to exist before grading.');
    const postEvent = f.store.events(f.run.id).find(event => event.kind === 'message_posted' && event.seq === future.event.seq - 1);
    if (!postEvent) throw new Error('Expected the checkpoint to precede its forged observation.');
    expect(postEvent.createdAt).toBe(posted.createdAt); expect(futureEvent.createdAt).toBe(posted.createdAt); expect(posted.createdAt).toBe(1000);
    f.checkpoint(f.second, f.observe(f.second)); f.finish();
    const result = f.assess(); expect(result.passed).toBe(false); expect(result.peers[0]?.invalidCheckpoints).toBe(1);
  });

  test('cannot pass without the canonical report even when all checkpoint evidence passes', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000); f.round(); f.finish(false);
    const result = f.assess(); expect(result.hasReport).toBe(false); expect(result.passed).toBe(false);
    expect(result.peers.every(peer => peer.passed)).toBe(true);
  });

  test('a bailed peer and run cannot pass despite accurate observations and a report', () => {
    const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000); f.round(); f.finish(true, true);
    const result = f.assess(); expect(result.passed).toBe(false); expect(result.status).toBe('bailed');
    expect(result.peers[0]).toMatchObject({ status: 'bailed', validCheckpoints: 2, distinctBalances: 2, passed: false });
  });

  for (const peak of [199_999, 200_000, 250_000]) {
    test(`distinguishes observed target boundaries at ${peak} micros from later settlement`, () => {
      const f = fixture(); f.settle(f.first, 50_000); f.round(); f.settle(f.second, peak - 50_000); f.round();
      if (peak < 250_000) f.settle(f.first, 250_000 - peak);
      f.finish(true, true); const result = f.assess();
      expect(result.peakObservedSettledMicros).toBe(peak);
      expect(result.observedNearTarget).toBe(peak >= 200_000);
      expect(result.observedTargetReached).toBe(peak >= 250_000);
      expect(result.targetReachedByFinalSettlement).toBe(true);
      expect(result.passed).toBe(false);
    });
  }

  test('reports no target-boundary evidence when the run has no working target', () => {
    const f = fixture(null); f.settle(f.first, 50_000); f.round(); f.settle(f.second, 50_000); f.round(); f.finish();
    const result = f.assess(); expect(result.passed).toBe(true); expect(result.workingTargetMicros).toBeNull();
    expect(result.observedNearTarget).toBe(false); expect(result.observedTargetReached).toBe(false); expect(result.targetReachedByFinalSettlement).toBe(false);
  });
});

async function queueFixture() {
  const root = await mkdtemp(join(tmpdir(), 'budget-probe-queue-')); roots.push(root);
  const databasePath = join(root, 'swarm.sqlite');
  const store = openSwarmStore(databasePath); stores.push(store);
  const first = join(root, 'first'); const second = join(root, 'second'); const third = join(root, 'third');
  await Promise.all([first, second, third].map(directory => mkdir(directory, { mode: 0o700 })));
  const spec = parseSwarmSpec({ title: 'Synthetic single-attempt queue', task: 'Do not execute this queued fixture.', definitionOfDone: 'The queue claim blocks duplicate attempts.', finalOutput: 'budget-report.md', agentCount: 2, budgetMicros: 6_000_000, workingTargetMicros: 250_000, maxOutputTokens: 4096, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' } });
  return { store, databasePath, spec, first, second, third, claimPath: join(root, 'probe-claim.json') };
}

describe('durable budget probe launch claim', () => {
  test('creates the claim before queue visibility and rejects another output directory even after cancellation', async () => {
    const f = await queueFixture(); const create = f.store.createSwarm.bind(f.store); let creates = 0;
    f.store.createSwarm = (spec, files) => {
      creates++;
      const claim: unknown = JSON.parse(readFileSync(f.claimPath, 'utf8'));
      expect(claim).toEqual({ spec: f.spec, directory: f.first, swarmId: null, automaticRetry: false });
      return create(spec, files);
    };
    const run = await queueBudgetProbe(f.store, f.spec, f.first, f.claimPath);
    expect(run.status).toBe('queued'); expect(creates).toBe(1);
    const receipt: unknown = JSON.parse(await readFile(join(f.first, 'launch.json'), 'utf8'));
    expect(receipt).toEqual({ swarmId: run.id, spec: f.spec });
    const completedClaim: unknown = JSON.parse(await readFile(f.claimPath, 'utf8'));
    expect(completedClaim).toMatchObject({ swarmId: run.id, spec: f.spec, directory: f.first, automaticRetry: false });
    await expect(queueBudgetProbe(f.store, f.spec, f.second, f.claimPath)).rejects.toThrow();
    expect(creates).toBe(1); expect(f.store.listSwarms().map(candidate => candidate.id)).toEqual([run.id]);
    f.store.stopSwarm(run.id, 'End synthetic queued fixture without provider work');
    await expect(queueBudgetProbe(f.store, f.spec, f.third, f.claimPath)).rejects.toThrow();
    expect(creates).toBe(1); expect(f.store.listSwarms()).toHaveLength(1);
    expect(JSON.parse(await readFile(f.claimPath, 'utf8'))).toEqual(completedClaim);
    expect(f.store.listWorkers()).toEqual([]);
  });

  test('two concurrent callers with separate database connections admit only one attempt', async () => {
    const f = await queueFixture(); const secondStore = openSwarmStore(f.databasePath); stores.push(secondStore);
    const results = await Promise.allSettled([
      queueBudgetProbe(f.store, f.spec, f.first, f.claimPath),
      queueBudgetProbe(secondStore, f.spec, f.second, f.claimPath),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const winner = results.find(result => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('Expected exactly one claimed probe.');
    expect(f.store.listSwarms().map(run => run.id)).toEqual([winner.value.id]);
    expect(secondStore.listSwarms().map(run => run.id)).toEqual([winner.value.id]);
    const claim: unknown = JSON.parse(await readFile(f.claimPath, 'utf8'));
    expect(claim).toMatchObject({ swarmId: winner.value.id, automaticRetry: false });
  });

  test('a preexisting claim without a swarm ID is retained and blocks retries after a simulated crash', async () => {
    const f = await queueFixture();
    const pending = JSON.stringify({ spec: f.spec, directory: f.first, swarmId: null, automaticRetry: false });
    await writeFile(f.claimPath, pending, { flag: 'wx', mode: 0o600 });
    await expect(queueBudgetProbe(f.store, f.spec, f.second, f.claimPath)).rejects.toThrow();
    expect(f.store.listSwarms()).toEqual([]); expect(await readFile(f.claimPath, 'utf8')).toBe(pending);
  });

  test('a queue failure never releases the claim or permits another directory to retry', async () => {
    const f = await queueFixture(); const create = f.store.createSwarm.bind(f.store);
    f.store.createSwarm = () => { throw new Error('Synthetic queue persistence failure'); };
    try { await expect(queueBudgetProbe(f.store, f.spec, f.first, f.claimPath)).rejects.toThrow('queue persistence failure'); }
    finally { f.store.createSwarm = create; }
    const claim = await readFile(f.claimPath, 'utf8');
    expect(JSON.parse(claim)).toMatchObject({ swarmId: null, automaticRetry: false });
    await expect(queueBudgetProbe(f.store, f.spec, f.second, f.claimPath)).rejects.toThrow();
    expect(f.store.listSwarms()).toEqual([]); expect(await readFile(f.claimPath, 'utf8')).toBe(claim);
  });

  test('a receipt failure after queue creation retains the live attempt and prevents a second launch', async () => {
    const f = await queueFixture(); const create = f.store.createSwarm.bind(f.store);
    f.store.createSwarm = (spec, files) => {
      const run = create(spec, files);
      mkdirSync(join(f.first, 'launch.json')); // Force the subsequent receipt write to fail after the actual queue commit.
      return run;
    };
    try { await expect(queueBudgetProbe(f.store, f.spec, f.first, f.claimPath)).rejects.toThrow(); }
    finally { f.store.createSwarm = create; }
    const existing = f.store.listSwarms()[0]; if (!existing) throw new Error('Expected the committed probe to remain inspectable.');
    expect(existing.status).toBe('queued');
    const claim: unknown = JSON.parse(await readFile(f.claimPath, 'utf8'));
    expect(claim).toMatchObject({ swarmId: existing.id, automaticRetry: false });
    await expect(queueBudgetProbe(f.store, f.spec, f.second, f.claimPath)).rejects.toThrow();
    expect(f.store.listSwarms().map(run => run.id)).toEqual([existing.id]);
    expect(JSON.parse(await readFile(f.claimPath, 'utf8'))).toEqual(claim);
    expect(f.store.reservations(existing.id)).toEqual([]);
  });
});
