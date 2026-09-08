import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { openSwarmStore, parseSwarmSpec, type SwarmStore } from '@simpleswarm/swarm';
import type { Sandbox } from '@simpleswarm/sandbox';
import { BudgetAdmission, RequestLiability, waitFor } from '../modules/runtime/budget.ts';
import { createPiRuntime } from '../modules/runtime/pi-runtime.ts';

const stores: SwarmStore[] = [];
const directories: string[] = [];
const model = { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' } as const;
const marker = 'CURRENT BUDGET SNAPSHOT (runtime-owned; refresh with budget before decisions):\n';
const usage = { input: 20, output: 30, cacheRead: 0, cacheWrite: 0 };
const endpoint = 'https://api.anthropic.com/v1/messages';
const signal = () => new AbortController().signal;
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

function intercepted(send: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>): typeof fetch {
  return Object.assign(send, { preconnect: () => { throw new Error('Real network is forbidden'); } });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred value is not initialized'); };
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Synthetic fixture did not reach the expected ledger state');
    await waitFor(5, signal());
  }
}

function fixture(options: { agentCount?: number; budgetMicros?: number; workingTargetMicros?: number } = {}) {
  const store = openSwarmStore(':memory:'); stores.push(store); store.registerWorker('working-target-fixture', process.pid);
  store.createSwarm(parseSwarmSpec({ task: 'Synthetic working target fixture', definitionOfDone: 'Only an explicit done establishes completion', finalOutput: 'fixture.txt', agentCount: options.agentCount ?? 2, budgetMicros: options.budgetMicros ?? 50_000_000, workingTargetMicros: options.workingTargetMicros, maxOutputTokens: 16000, maxRunMs: 10000, idleTimeoutMs: 3000, model }), [{ path: 'fixture.txt', baseRevision: 0, contentBase64: Buffer.from('Synthetic existing output is not a completion claim.').toString('base64') }]);
  const run = store.claimNextSwarm('working-target-fixture'); if (!run) throw new Error('Missing working target run');
  const actors = run.agents.map(agent => ({ swarmId: run.id, agentId: agent.id }));
  const actor = actors[0]; if (!actor) throw new Error('Missing working target agent');
  return { store, run, actors, actor, admission: new BudgetAdmission(store) };
}

async function runtimeFixture(options: Parameters<typeof fixture>[0] = {}) {
  const current = fixture(options);
  const path = await mkdtemp(join(tmpdir(), 'swarm-working-target-')); directories.push(path);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify('anthropic', async () => ({ type: 'api_key', key: 'synthetic-working-target-credential' }));
  const createModels = () => ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(path, 'models-cache.json'), allowModelNetwork: false, signal: AbortSignal.timeout(3000) });
  const sandbox: Sandbox = { check: async () => ({ ready: true, reason: 'Synthetic working target fixture', image: 'fixture' }), execute: async () => { throw new Error('Shell execution forbidden'); }, stop: async () => {} };
  return { ...current, createRuntime: (send: typeof fetch) => createPiRuntime({ store: current.store, sandbox, sessionDirectory: path }, { createModels, fetch: send }) };
}

function toolResponse(ordinal: number, name: 'budget' | 'list_team' | 'done') {
  const argumentsJson = name === 'done' ? JSON.stringify({ done_reasoning: 'Explicit synthetic completion after budget observations.', output: 'fixture.txt' }) : '{}';
  const events = [
    { type: 'message_start', message: { id: `target-message-${ordinal}`, type: 'message', role: 'assistant', model: model.id, content: [], usage: { input_tokens: usage.input, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `target-tool-${ordinal}`, name, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: argumentsJson } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: usage.output } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a structured fixture result');
  return Object.fromEntries(Object.entries(value));
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) throw new Error('Expected text content');
  return value.map(block => {
    const content = record(block);
    if (content.type !== 'text' || typeof content.text !== 'string') throw new Error('Expected a text block');
    return content.text;
  }).join('\n');
}

function budgetNote(payload: Record<string, unknown>): Record<string, unknown> {
  const text = textContent(payload.system);
  expect(text.split(marker)).toHaveLength(2);
  const note = record(JSON.parse(text.slice(text.indexOf(marker) + marker.length)));
  expect(note.units).toBe('USD-equivalent microdollars');
  expect(note.nextRequestCeilingMicros).toBe(5_400_000);
  if (typeof note.availableMicros !== 'number') throw new Error('Missing available budget');
  expect(note.requestsAdmissibleNow).toBe(Math.floor(note.availableMicros / 5_400_000));
  return note;
}

function latestBudgetToolResult(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.messages)) throw new Error('Missing request messages');
  let result: Record<string, unknown> | undefined;
  for (const item of payload.messages) {
    const message = record(item);
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      const content = record(block);
      if (content.type === 'tool_result') result = record(JSON.parse(textContent(content.content)));
    }
  }
  if (!result) throw new Error('Missing the preceding budget tool result');
  return result;
}

describe('working target admission without relaxing the hard ceiling', () => {
  test('early admission reserves capacity without validating or dispatching a payload', async () => {
    const current = fixture({ budgetMicros: 100 });
    current.store.startAgent(current.actor, crypto.randomUUID());
    let calls = 0;
    const request = new RequestLiability({ ...current, ceiling: 30, evidence: 'Synthetic early admission', signal: signal(), fetch: intercepted(async () => { calls++; return new Response(); }) });
    await request.awaitAdmission();
    expect(current.store.budget(current.run.id).reservedMicros).toBe(30);
    await expect(request.fetch(endpoint, { method: 'POST' })).rejects.toMatchObject({ code: 'payload_invalid' });
    expect(calls).toBe(0);
    request.uncertain('Undispatched payload did not pass validation');
    expect(current.store.budget(current.run.id)).toMatchObject({ settledMicros: 0, reservedMicros: 0, uncertainMicros: 0, availableMicros: 100 });
  });

  test('settled target blocks both fresh admission and an already reserved but undispatched request', async () => {
    const current = fixture({ budgetMicros: 100, workingTargetMicros: 20 });
    for (const actor of current.actors) current.store.startAgent(actor, crypto.randomUUID());
    let calls = 0;
    const send = intercepted(async () => { calls++; return new Response(); });
    const first = new RequestLiability({ ...current, actor: current.actor, ceiling: 30, evidence: 'Synthetic tariff', signal: signal(), fetch: send });
    const prepared = new RequestLiability({ ...current, actor: current.actor, ceiling: 30, evidence: 'Synthetic tariff', signal: signal(), fetch: send });
    await first.prepare(); await prepared.prepare(); await first.fetch(endpoint, { method: 'POST' });
    first.settle(20, usage);
    await expect(current.admission.acquire(current.actor, 1, 'Fresh request after target', signal())).rejects.toMatchObject({ code: 'working_target_reached' });
    await expect(prepared.fetch(endpoint, { method: 'POST' })).rejects.toMatchObject({ code: 'working_target_reached' });
    prepared.uncertain('Known undispatched request blocked by working target');
    expect(calls).toBe(1);
    expect(current.store.budget(current.run.id)).toMatchObject({ capMicros: 100, settledMicros: 20, reservedMicros: 0, uncertainMicros: 0, availableMicros: 80 });
    expect(current.store.reservations(current.run.id)).toHaveLength(2);
  });

  test('budget and FIFO waiters exit after settled spending reaches the target', async () => {
    const current = fixture({ budgetMicros: 100, workingTargetMicros: 20 });
    for (const actor of current.actors) current.store.startAgent(actor, crypto.randomUUID());
    const hold = await current.admission.acquire(current.actor, 70, 'Synthetic hold', signal());
    const head = current.admission.acquire(current.actor, 70, 'Budget waiter', signal()).then(() => null, error => error);
    const queued = current.admission.acquire(current.actor, 70, 'FIFO waiter', signal()).then(() => null, error => error);
    await eventually(() => current.store.getSwarm(current.run.id).agents.some(agent => agent.status === 'waiting'));
    current.store.settle(hold.id, 20, usage);
    const outcomes = await Promise.race([Promise.all([head, queued]), waitFor(1000, signal()).then(() => [])]);
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) expect(outcome).toMatchObject({ code: 'working_target_reached' });
    expect(current.store.reservations(current.run.id)).toHaveLength(1);
  });

  test('a working target never permits a reservation exceeding remaining hard-cap capacity', async () => {
    const current = fixture({ budgetMicros: 100, workingTargetMicros: 90 });
    for (const actor of current.actors) current.store.startAgent(actor, crypto.randomUUID());
    const first = await current.admission.acquire(current.actor, 85, 'Synthetic spend', signal());
    current.store.settle(first.id, 85, usage);
    await expect(current.admission.acquire(current.actor, 30, 'Bounded request exceeds hard cap', signal())).rejects.toMatchObject({ code: 'budget_exhausted' });
    expect(current.store.budget(current.run.id).availableMicros).toBe(15);
  });
});

test('two real Pi peers may finish dispatched requests beyond the working target without a new dispatch or implicit completion', async () => {
  const current = await runtimeFixture({ agentCount: 2, workingTargetMicros: 850 });
  const bothDispatched = deferred<void>(); let calls = 0;
  const send = intercepted(async (_input, init) => {
    const ordinal = ++calls;
    if (ordinal > 2) throw new Error('Working target allowed another inference');
    if (ordinal === 1) {
      await bothDispatched.promise;
      return toolResponse(ordinal, 'list_team');
    }
    bothDispatched.resolve();
    await eventually(() => current.store.budget(current.run.id).settledMicros === 850);
    expect(init?.signal?.aborted).toBe(false);
    expect(current.store.budget(current.run.id).reservedMicros).toBe(5_400_000);
    return toolResponse(ordinal, 'list_team');
  });
  const runtime = current.createRuntime(send);
  try {
    await runtime.run(current.run, signal());
    const state = current.store.getSwarm(current.run.id);
    expect(calls).toBe(2);
    expect(state.status).toBe('bailed');
    expect(state.reason).toMatch(/working target/i);
    expect(state.agents.every(agent => agent.status === 'bailed')).toBe(true);
    expect(state.agents.some(agent => agent.reason?.match(/working target/i))).toBe(true);
    expect(state.budget).toMatchObject({ capMicros: 50_000_000, settledMicros: 1700, reservedMicros: 0, uncertainMicros: 0, availableMicros: 49_998_300 });
    expect(current.store.reservations(state.id).map(item => item.status)).toEqual(['settled', 'settled']);
    expect(current.store.events(state.id).filter(event => event.kind === 'model_response')).toHaveLength(2);
    expect(current.store.files(state.id).some(file => file.path === 'fixture.txt')).toBe(true);
  } finally { await runtime.dispose(); }
}, 15000);

test('a real Pi peer waiting for hard-cap capacity receives its predecessor settlement in the dispatched context', async () => {
  const current = await runtimeFixture({ agentCount: 2, budgetMicros: 6_000_000, workingTargetMicros: 2000 });
  const notes: Record<string, unknown>[] = [];
  let calls = 0;
  const runtime = current.createRuntime(intercepted(async (input, init) => {
    const ordinal = ++calls;
    if (ordinal > 2) throw new Error('Completed peers attempted another model request');
    const note = budgetNote(record(await new Request(input, init).json()));
    notes.push(note);
    const balance = current.store.budget(current.run.id);
    expect(note).toMatchObject({ ...balance, ownSettledMicros: 0, targetRemainingMicros: 2000 - (ordinal - 1) * 850 });
    expect(note.settledMicros).toBe((ordinal - 1) * 850);
    expect(note.reservedMicros).toBe(5_400_000);
    expect(note.availableMicros).toBe(600_000 - (ordinal - 1) * 850);
    if (ordinal === 1) {
      await eventually(() => current.store.getSwarm(current.run.id).agents.some(agent => agent.status === 'waiting'));
      expect(calls).toBe(1);
      expect(current.store.budget(current.run.id).settledMicros).toBe(0);
    }
    return toolResponse(ordinal, 'done');
  }));
  try {
    await runtime.run(current.run, signal());
    const state = current.store.getSwarm(current.run.id);
    expect(calls).toBe(2);
    expect(notes.map(note => note.settledMicros)).toEqual([0, 850]);
    expect(notes.map(note => note.targetRemainingMicros)).toEqual([2000, 1150]);
    expect(state.status).toBe('completed');
    expect(state.agents.map(agent => agent.status)).toEqual(['done', 'done']);
    expect(state.budget).toMatchObject({ settledMicros: 1700, reservedMicros: 0, uncertainMicros: 0, availableMicros: 5_998_300 });
    expect(current.store.reservations(state.id).map(reservation => reservation.status)).toEqual(['settled', 'settled']);
  } finally { await runtime.dispose(); }
}, 15000);

for (const workingTargetMicros of [850, 800]) {
  test(`explicit completion stays completed when its final verified response reaches target ${workingTargetMicros}`, async () => {
    const current = await runtimeFixture({ agentCount: 1, workingTargetMicros });
    let calls = 0;
    const runtime = current.createRuntime(intercepted(async () => {
      if (++calls > 1) throw new Error('Completed peer attempted another model request');
      return toolResponse(calls, 'done');
    }));
    try {
      await runtime.run(current.run, signal());
      const state = current.store.getSwarm(current.run.id);
      expect(calls).toBe(1);
      expect(state.status).toBe('completed');
      expect(state.reason).toContain('All peers explicitly completed');
      expect(state.agents.map(agent => agent.status)).toEqual(['done']);
      expect(state.agents[0]?.reason).toContain('Explicit synthetic completion');
      expect(current.store.files(state.id).some(file => file.path === 'fixture.txt' && file.size > 0)).toBe(true);
      expect(state.budget).toMatchObject({ settledMicros: 850, reservedMicros: 0, uncertainMicros: 0 });
      expect(current.store.reservations(state.id).map(reservation => reservation.status)).toEqual(['settled']);
      expect(current.store.events(state.id).filter(event => event.kind === 'model_response')).toHaveLength(1);
    } finally { await runtime.dispose(); }
  }, 15000);
}

for (const workingTargetMicros of [100_000, undefined]) {
  test(`real Pi refreshes budget awareness on every turn ${workingTargetMicros === undefined ? 'without a working target' : 'with a working target'}`, async () => {
    const current = await runtimeFixture({ agentCount: 1, workingTargetMicros });
    const notes: Record<string, unknown>[] = [];
    const toolResults: Record<string, unknown>[] = [];
    const observationSeqs: number[] = [];
    let calls = 0;
    const send = intercepted(async (input, init) => {
      const ordinal = ++calls;
      if (ordinal > 3) throw new Error('Explicit done did not end participation');
      const payload = record(await new Request(input, init).json());
      const note = budgetNote(payload); notes.push(note);
      expect(note).toMatchObject({ settledMicros: (ordinal - 1) * 850, ownSettledMicros: (ordinal - 1) * 850, workingTargetMicros: workingTargetMicros ?? null, targetRemainingMicros: workingTargetMicros === undefined ? null : workingTargetMicros - (ordinal - 1) * 850, decision: 'ready' });
      expect(note).toMatchObject({ reservedMicros: 5_400_000, availableMicros: 44_600_000 - (ordinal - 1) * 850 });
      if (ordinal > 1) {
        const { observationSeq, ...result } = latestBudgetToolResult(payload);
        if (typeof observationSeq !== 'number' || !Number.isSafeInteger(observationSeq) || observationSeq <= 0) throw new Error('Budget tool omitted its immutable observation cursor');
        observationSeqs.push(observationSeq); toolResults.push(result);
        // The preceding tool ran after settlement; this fresh context includes its own new reservation.
        expect(result).toMatchObject({ settledMicros: note.settledMicros, ownSettledMicros: note.ownSettledMicros, workingTargetMicros: note.workingTargetMicros, targetRemainingMicros: note.targetRemainingMicros, reservedMicros: 0, availableMicros: 50_000_000 - (ordinal - 1) * 850, decision: 'ready' });
      }
      return toolResponse(ordinal, ordinal === 3 ? 'done' : 'budget');
    });
    const runtime = current.createRuntime(send);
    try {
      await runtime.run(current.run, signal());
      const state = current.store.getSwarm(current.run.id);
      expect(calls).toBe(3); expect(state.status).toBe('completed');
      expect(state.agents[0]?.reason).toContain('Explicit synthetic completion');
      expect(notes.map(note => note.settledMicros)).toEqual([0, 850, 1700]);
      expect(state.budget).toMatchObject({ settledMicros: 2550, reservedMicros: 0, uncertainMicros: 0 });
      const observations = current.store.events(state.id).filter(event => event.kind === 'budget_observed');
      expect(observations).toHaveLength(2);
      expect(observations.map(event => event.seq)).toEqual(observationSeqs);
      const observedPayloads: unknown = observations.map(event => event.payload);
      expect(observedPayloads).toEqual(toolResults);
      expect(observations.every(event => event.agentId === current.actor.agentId)).toBe(true);
    } finally { await runtime.dispose(); }
  }, 15000);
}
