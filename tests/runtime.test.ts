import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { openSwarmStore, parseSwarmSpec, type Actor, type ModelBinding, type SwarmStore } from '@simpleswarm/swarm';
import type { Sandbox } from '@simpleswarm/sandbox';
import { BudgetAdmission, RequestLiability, waitFor } from '../modules/runtime/budget.ts';
import { createPiRuntime } from '../modules/runtime/pi-runtime.ts';
import { SessionPricing } from '../modules/runtime/pricing.ts';

const stores: SwarmStore[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
const opus: ModelBinding = { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' };
const codex: ModelBinding = { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
const endpoint = 'https://api.anthropic.com/v1/messages';
const signal = () => new AbortController().signal;

function fixture() {
  const store = openSwarmStore(':memory:'); stores.push(store);
  store.registerWorker('admission-circuit-fixture', process.pid);
  const created = store.createSwarm(parseSwarmSpec({ task: 'Synthetic admission circuit fixture', definitionOfDone: 'Unknown charges stop new requests', finalOutput: 'fixture.txt', agentCount: 4, budgetMicros: 100, model: opus }));
  const run = store.claimNextSwarm('admission-circuit-fixture');
  if (!run || run.id !== created.id) throw new Error('Missing fixture run');
  const actors = run.agents.map(agent => ({ swarmId: run.id, agentId: agent.id }));
  for (const actor of actors) store.startAgent(actor, crypto.randomUUID());
  const actor = actors[0]; if (!actor) throw new Error('Missing fixture actor');
  return { store, run, actor, admission: new BudgetAdmission(store) };
}

function gate(current: ReturnType<typeof fixture>, ceiling: number, send: typeof fetch, actor: Actor = current.actor) {
  return new RequestLiability({ store: current.store, admission: current.admission, actor, ceiling, evidence: 'Synthetic fixed tariff', signal: signal(), fetch: send });
}

function intercepted(send: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>): typeof fetch {
  return Object.assign(send, { preconnect: () => { throw new Error('Real network is forbidden'); } });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred value is not initialized'); };
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('swarm admission circuit', () => {
  test('uncertainty wakes budget and FIFO waiters, blocks prepared dispatch, and preserves an in-flight settlement', async () => {
    const current = fixture();
    let calls = 0;
    const pendingResponse = deferred<Response>();
    const dispatched = deferred<void>();
    let liveSignal: AbortSignal | null | undefined;
    const first = gate(current, 30, intercepted(async () => { calls++; return new Response(); }));
    const second = gate(current, 30, intercepted(async (_input, init) => {
      calls++; liveSignal = init?.signal; dispatched.resolve(); return pendingResponse.promise;
    }));
    const prepared = gate(current, 30, intercepted(async () => { calls++; return new Response(); }));
    await first.prepare(); await first.fetch(endpoint, { method: 'POST' });
    await second.prepare();
    const inFlight = second.fetch(endpoint, { method: 'POST' }); await dispatched.promise;
    await prepared.prepare();
    const head = current.admission.acquire(current.actor, 40, 'Synthetic wait', signal()).then(() => null, error => error);
    const queued = current.admission.acquire(current.actor, 40, 'Synthetic queue', signal()).then(() => null, error => error);
    await waitFor(10, signal());
    expect(current.store.getSwarm(current.run.id).agents.some(agent => agent.status === 'waiting')).toBe(true);
    first.uncertain('Synthetic disconnected response');
    const waiters = await Promise.race([Promise.all([head, queued]), waitFor(100, signal()).then(() => [])]);
    expect(waiters).toHaveLength(2);
    for (const failure of waiters) expect(failure).toMatchObject({ code: 'request_uncertain' });
    await expect(prepared.fetch(endpoint, { method: 'POST' })).rejects.toMatchObject({ code: 'request_uncertain' });
    expect(prepared.failure?.code).toBe('request_uncertain');
    prepared.uncertain('Never dispatched after circuit opened');
    expect(liveSignal?.aborted).toBe(false);
    pendingResponse.resolve(new Response('verified response'));
    await inFlight; second.settle(5, usage);
    expect(calls).toBe(2);
    expect(current.store.budget(current.run.id)).toMatchObject({ uncertainMicros: 30, settledMicros: 5, reservedMicros: 0, availableMicros: 65 });
    await expect(current.admission.acquire(current.actor, 1, 'No further requests', signal())).rejects.toMatchObject({ code: 'request_uncertain' });
    expect(current.store.reservations(current.run.id)).toHaveLength(3);
  });

  test('persisted uncertain charges close a fresh admission instance without changing the ledger', async () => {
    const current = fixture();
    const request = gate(current, 30, intercepted(async () => new Response()));
    await request.prepare(); await request.fetch(endpoint, { method: 'POST' }); request.uncertain('Synthetic uncertainty');
    const before = current.store.reservations(current.run.id);
    await expect(new BudgetAdmission(current.store).acquire(current.actor, 1, 'Restarted admission', signal())).rejects.toMatchObject({ code: 'request_uncertain' });
    expect(current.store.reservations(current.run.id)).toEqual(before);
  });

  test('a failure to persist uncertainty still closes admission and retains the original reservation', async () => {
    const current = fixture();
    const request = gate(current, 30, intercepted(async () => new Response()));
    await request.prepare(); await request.fetch(endpoint, { method: 'POST' });
    const original = current.store.markUncertain;
    current.store.markUncertain = () => { throw new Error('Synthetic ledger unavailable'); };
    try {
      expect(() => request.uncertain('Unknown final charge')).toThrow('ledger unavailable');
      await expect(current.admission.acquire(current.actor, 1, 'Blocked despite ledger failure', signal())).rejects.toMatchObject({ code: 'request_uncertain' });
      expect(current.store.budget(current.run.id)).toMatchObject({ reservedMicros: 30, uncertainMicros: 0, settledMicros: 0 });
    } finally { current.store.markUncertain = original; }
  });

  test('payload and endpoint failures before dispatch do not close admission', async () => {
    const current = fixture(); let calls = 0;
    const request = gate(current, 30, intercepted(async () => { calls++; return new Response(); }));
    await expect(request.fetch(endpoint, { method: 'POST' })).rejects.toThrow('payload validation');
    request.uncertain('Rejected unvalidated payload');
    expect(current.admission.failure(current.run.id)).toBeUndefined();
    await request.prepare();
    await expect(request.fetch('https://invalid.example/v1/messages', { method: 'POST' })).rejects.toThrow('endpoint');
    request.uncertain('Rejected before transport');
    expect(calls).toBe(0); expect(current.admission.failure(current.run.id)).toBeUndefined();
    expect(current.store.budget(current.run.id)).toMatchObject({ availableMicros: 100, uncertainMicros: 0 });
    expect((await current.admission.acquire(current.actor, 100, 'Still open', signal())).ceilingMicros).toBe(100);
  });

  test('uncertainty in one swarm does not block another swarm using the same admission instance', async () => {
    const current = fixture();
    const request = gate(current, 30, intercepted(async () => new Response()));
    await request.prepare(); await request.fetch(endpoint, { method: 'POST' }); request.uncertain('First swarm only');
    current.store.createSwarm({ ...current.run.spec, title: 'Independent synthetic swarm' });
    const second = current.store.claimNextSwarm('admission-circuit-fixture'); if (!second) throw new Error('Missing independent swarm');
    const agent = second.agents[0]; if (!agent) throw new Error('Missing independent agent');
    const actor = { swarmId: second.id, agentId: agent.id }; current.store.startAgent(actor, crypto.randomUUID());
    expect((await current.admission.acquire(actor, 100, 'Independent request', signal())).swarmId).toBe(second.id);
  });

  test('a failure after a verified settlement cannot reopen liability or trip admission', async () => {
    const current = fixture();
    const request = gate(current, 30, intercepted(async () => new Response()));
    await request.prepare(); await request.fetch(endpoint, { method: 'POST' }); request.settle(5, usage);
    request.uncertain('Post-settlement callback failure');
    expect(current.admission.failure(current.run.id)).toBeUndefined();
    expect(current.store.budget(current.run.id)).toMatchObject({ uncertainMicros: 0, settledMicros: 5, availableMicros: 95 });
  });
});

describe('pricing for one actual Pi session', () => {
  test('GPT-5.5 retains long-context pricing after input shrinks, including cached input', () => {
    const session = new SessionPricing(codex);
    const small = { input: 100, output: 200, cacheRead: 3, cacheWrite: 0 };
    expect(session.price(small)).toBe(6502);
    expect(session.price({ input: 272_000, output: 1, cacheRead: 0, cacheWrite: 0 })).toBe(1_360_030);
    expect(session.price({ input: 1, output: 1, cacheRead: 272_000, cacheWrite: 0 })).toBe(272_055);
    expect(session.price(small)).toBe(10_003);
    expect(session.price({ input: 0, output: 1, cacheRead: 3, cacheWrite: 0 })).toBe(48);
    expect(new SessionPricing(codex).price(small)).toBe(6502);
  });

  test('invalid usage cannot change session pricing, and Opus has no Codex premium', () => {
    const session = new SessionPricing(codex);
    expect(() => session.price({ input: 273_000, output: 1, cacheRead: 0, cacheWrite: 1 })).toThrow();
    expect(session.price(usage)).toBe(35);
    const anthropic = new SessionPricing(opus);
    expect(anthropic.price({ input: 273_000, output: 1, cacheRead: 0, cacheWrite: 0 })).toBe(1_365_025);
    expect(anthropic.price(usage)).toBe(30);
  });
});

function completedToolResponse() {
  const events = [
    { type: 'message_start', message: { id: 'circuit-peer-response', type: 'message', role: 'assistant', model: opus.id, content: [], usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'circuit-peer-tool', name: 'list_team', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

test('real Pi peers settle an existing response while admission stops the swarm with an accounting failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swarm-circuit-session-')); directories.push(directory);
  const store = openSwarmStore(':memory:'); stores.push(store); store.registerWorker('circuit-session-fixture', process.pid);
  store.createSwarm(parseSwarmSpec({ task: 'Synthetic circuit session fixture', definitionOfDone: 'Existing response settles without a new generation', finalOutput: 'fixture.txt', agentCount: 3, budgetMicros: 10_800_000, maxOutputTokens: 16000, maxRunMs: 10000, idleTimeoutMs: 3000, model: opus }));
  const run = store.claimNextSwarm('circuit-session-fixture'); if (!run) throw new Error('Missing circuit session run');
  const credentials = new InMemoryCredentialStore();
  await credentials.modify('anthropic', async () => ({ type: 'api_key', key: 'synthetic-circuit-credential' }));
  const createModels = () => ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(directory, 'models-cache.json'), allowModelNetwork: false, signal: AbortSignal.timeout(3000) });
  const sandbox: Sandbox = { check: async () => ({ ready: true, reason: 'Synthetic circuit fixture', image: 'fixture' }), execute: async () => { throw new Error('Shell execution forbidden'); }, stop: async () => {} };
  const bothDispatched = deferred<void>(); let requests = 0; let remainingSignal: AbortSignal | null | undefined;
  const send = intercepted(async (_input, init) => {
    const ordinal = ++requests;
    if (ordinal > 2) throw new Error('Circuit allowed an extra inference');
    if (ordinal === 1) {
      await bothDispatched.promise;
      return new Response(JSON.stringify({ error: { type: 'overloaded_error', message: 'Synthetic uncertain request' } }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    remainingSignal = init?.signal; bothDispatched.resolve();
    const deadline = Date.now() + 2000;
    while (store.budget(run.id).uncertainMicros === 0) {
      if (Date.now() > deadline) throw new Error('First request never became uncertain');
      await waitFor(5, signal());
    }
    expect(remainingSignal?.aborted).toBe(false);
    return completedToolResponse();
  });
  const runtime = createPiRuntime({ store, sandbox, sessionDirectory: directory }, { createModels, fetch: send });
  try {
    await runtime.run(run, signal());
    const state = store.getSwarm(run.id);
    expect(requests).toBe(2); expect(state.status).toBe('failed');
    expect(state.reason).toContain('unverified charges');
    expect(state.agents.some(agent => agent.reason?.includes('unverified charges'))).toBe(true);
    expect(state.budget).toMatchObject({ uncertainMicros: 5_400_000, settledMicros: 850, reservedMicros: 0, availableMicros: 5_399_150 });
    expect(store.reservations(run.id).map(reservation => reservation.status).sort()).toEqual(['settled', 'uncertain']);
    expect(store.events(run.id).filter(event => event.kind === 'model_response')).toHaveLength(1);
  } finally { await runtime.dispose(); }
}, 15000);
