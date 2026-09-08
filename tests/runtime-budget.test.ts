import { afterEach, describe, expect, test } from 'bun:test';
import { openSwarmStore, parseSwarmSpec, type SwarmStore } from '@simpleswarm/swarm';
import { BudgetAdmission, RequestLiability, waitFor } from '../modules/runtime/budget.ts';

const opened: SwarmStore[] = [];
afterEach(() => { for (const store of opened.splice(0)) store.close(); });
function fixture() {
  const store = openSwarmStore(':memory:'); opened.push(store);
  store.registerWorker('runtime-test-worker', process.pid);
  const run = store.createSwarm(parseSwarmSpec({ task: 'Exercise liability accounting', definitionOfDone: 'Ledger remains within cap', finalOutput: 'result.txt', agentCount: 3, budgetMicros: 100, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' } }));
  store.claimNextSwarm('runtime-test-worker');
  const actors = run.agents.map(agent => ({ swarmId: run.id, agentId: agent.id }));
  for (const actor of actors) store.startAgent(actor, crypto.randomUUID());
  const actor = actors[0]; if (!actor) throw new Error('Missing fixture actor');
  return { store, run, actor, admission: new BudgetAdmission(store) };
}
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };

describe('durable inference liability', () => {
  test('does not call the transport until payload validation and reservation succeed', async () => {
    const { store, actor, admission } = fixture(); let calls = 0;
    const gate = new RequestLiability({ store, actor, admission, ceiling: 70, evidence: 'test tariff', signal: new AbortController().signal,
      fetch: Object.assign(async () => { calls++; expect(store.budget(actor.swarmId).reservedMicros).toBe(70); return new Response('ok'); }, { preconnect: () => {} }) });
    await expect(gate.fetch('https://api.anthropic.com/v1/messages', { method: 'POST' })).rejects.toThrow('payload validation');
    expect(calls).toBe(0); gate.validated();
    await gate.fetch('https://api.anthropic.com/v1/messages', { method: 'POST' });
    expect(calls).toBe(1); gate.settle(20, usage);
    expect(store.budget(actor.swarmId)).toMatchObject({ settledMicros: 20, availableMicros: 80, reservedMicros: 0 });
    await expect(gate.fetch('https://api.anthropic.com/v1/messages', { method: 'POST' })).rejects.toThrow('reuse');
  });
  test('an unknown interrupted attempt retains its entire ceiling across repeated accounting', async () => {
    const { store, actor, admission } = fixture();
    const gate = new RequestLiability({ store, actor, admission, ceiling: 70, evidence: 'test tariff', signal: new AbortController().signal,
      fetch: Object.assign(async () => { throw new Error('lost response'); }, { preconnect: () => {} }) });
    gate.validated(); await expect(gate.fetch('https://api.anthropic.com/v1/messages', { method: 'POST' })).rejects.toThrow('lost response');
    gate.uncertain('Disconnected'); gate.uncertain('Repeated callback');
    expect(store.budget(actor.swarmId)).toMatchObject({ uncertainMicros: 70, availableMicros: 30, reservedMicros: 0 });
    await expect(admission.acquire(actor, 40, 'test', new AbortController().signal)).rejects.toThrow('unverified charges');
  });
  test('temporary concurrent reservations wait and settle before fair admission', async () => {
    const { store, actor, admission } = fixture(); const signal = new AbortController().signal;
    const first = await admission.acquire(actor, 70, 'test', signal);
    let admitted = false; const second = admission.acquire(actor, 70, 'test', signal).then(reservation => { admitted = true; return reservation; });
    await waitFor(20, signal); expect(admitted).toBe(false);
    store.settle(first.id, 10, usage); const next = await second;
    expect(next.ceilingMicros).toBe(70); expect(store.budget(actor.swarmId).availableMicros).toBe(20);
  });
  test('cancellation while budget blocked sends no new request', async () => {
    const { store, actor, admission } = fixture(); const controller = new AbortController();
    await admission.acquire(actor, 70, 'test', controller.signal);
    const next = admission.acquire(actor, 70, 'test', controller.signal);
    controller.abort(new Error('user stopped')); await expect(next).rejects.toThrow('user stopped');
    expect(store.reservations(actor.swarmId)).toHaveLength(1);
  });
  test('redirects and non-inference endpoints cannot reuse trusted credentials', async () => {
    const { store, actor, admission } = fixture(); let calls = 0;
    const gate = new RequestLiability({ store, actor, admission, ceiling: 70, evidence: 'test', signal: new AbortController().signal,
      fetch: Object.assign(async (_input: unknown, init?: RequestInit) => { calls++; expect(init?.redirect).toBe('error'); return new Response(); }, { preconnect: () => {} }) }); gate.validated();
    await expect(gate.fetch('https://attacker.example/v1/messages', { method: 'POST' })).rejects.toThrow('endpoint');
    await expect(gate.fetch('https://api.anthropic.com/v1/messages', { method: 'GET' })).rejects.toThrow('inference');
    expect(calls).toBe(0); expect(store.reservations(actor.swarmId)).toHaveLength(0);
  });
});

test('an aborted queued caller rejects promptly without jumping live callers ahead of their predecessor', async () => {
  const { store, actor, admission } = fixture();
  const hold = await admission.acquire(actor, 70, 'test', new AbortController().signal);
  const headController = new AbortController();
  const head = admission.acquire(actor, 70, 'test', headController.signal);
  const queuedController = new AbortController();
  const queued = admission.acquire(actor, 70, 'test', queuedController.signal);
  queuedController.abort(new Error('cancel queued now'));
  const outcome = await Promise.race([queued.then(() => 'unexpected admission', error => error.message), waitFor(100, new AbortController().signal).then(() => 'hung')]);
  expect(outcome).toBe('cancel queued now');
  expect(store.reservations(actor.swarmId)).toHaveLength(1);
  headController.abort(new Error('cleanup head')); await expect(head).rejects.toThrow('cleanup head');
  store.settle(hold.id, 1, usage);
});

test('one swarm waiting for funds cannot block another swarm admission', async () => {
  const { store, actor, admission } = fixture();
  await admission.acquire(actor, 70, 'test', new AbortController().signal);
  const stalled = new AbortController(); const waiting = admission.acquire(actor, 70, 'test', stalled.signal);
  const second = store.createSwarm(parseSwarmSpec({ task: 'Independent run', definitionOfDone: 'Separate budget', finalOutput: 'two.txt', agentCount: 1, budgetMicros: 100, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' } }));
  store.claimNextSwarm('runtime-test-worker'); const agent = second.agents[0]; if (!agent) throw new Error('Missing second agent');
  const secondActor = { swarmId: second.id, agentId: agent.id }; store.startAgent(secondActor, crypto.randomUUID());
  const next = await Promise.race([admission.acquire(secondActor, 70, 'test', new AbortController().signal), waitFor(100, new AbortController().signal).then(() => null)]);
  expect(next?.swarmId).toBe(second.id);
  stalled.abort(new Error('cleanup stalled run')); await expect(waiting).rejects.toThrow('cleanup stalled run');
});

test('an admitted request cancelled before transmission releases only its known unattempted reservation', async () => {
  const { store, actor, admission } = fixture(); const controller = new AbortController(); let calls = 0;
  const gate = new RequestLiability({ store, actor, admission, ceiling: 70, evidence: 'test', signal: controller.signal,
    fetch: Object.assign(async () => { calls++; return new Response(); }, { preconnect: () => {} }) });
  await gate.prepare(); controller.abort(new Error('cancel before transmit'));
  await expect(gate.fetch('https://api.anthropic.com/v1/messages', { method: 'POST' })).rejects.toThrow('cancel before transmit');
  gate.uncertain('Locally cancelled');
  expect(calls).toBe(0); expect(store.budget(actor.swarmId)).toMatchObject({ availableMicros: 100, uncertainMicros: 0, settledMicros: 0 });
});
