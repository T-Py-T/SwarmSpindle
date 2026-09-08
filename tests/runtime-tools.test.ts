import { afterEach, expect, test } from 'bun:test';
import { openSwarmStore, parseSwarmSpec, type SwarmStore } from '@simpleswarm/swarm';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Sandbox, SandboxResult } from '@simpleswarm/sandbox';
import { createSwarmTools, type AgentCompletion } from '../modules/runtime/tools.ts';
import { budgetAwareness } from '../modules/runtime/budget-awareness.ts';

const unused = (): never => { throw new Error('Swarm tools must not use Pi extension context'); };
const noExtensionContext: ExtensionContext = {
  get ui() { return unused(); }, mode: 'rpc', hasUI: false, cwd: '/unavailable',
  get sessionManager() { return unused(); }, get modelRegistry() { return unused(); },
  model: undefined, scopedModels: [], signal: undefined, isIdle: unused, isProjectTrusted: unused, abort: unused,
  hasPendingMessages: unused, shutdown: unused, getContextUsage: unused, compact: unused, getSystemPrompt: unused,
};
const opened: SwarmStore[] = [];
afterEach(() => { for (const store of opened.splice(0)) store.close(); });
function fixture(shellResult: SandboxResult = { exitCode: 0, stdout: '', stderr: '', durationMs: 1, changes: [] }) {
  const store = openSwarmStore(':memory:'); opened.push(store); store.registerWorker('tools-test-worker', process.pid);
  const run = store.createSwarm(parseSwarmSpec({ task: 'Tool protocol', definitionOfDone: 'Verified claims', finalOutput: 'result.txt', agentCount: 2, budgetMicros: 50_000_000, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' } }));
  store.claimNextSwarm('tools-test-worker');
  const agent = run.agents[0]; if (!agent) throw new Error('Missing fixture agent');
  const actor = { swarmId: run.id, agentId: agent.id }; store.startAgent(actor, crypto.randomUUID());
  const sandbox: Sandbox = { check: async () => ({ ready: true, reason: 'test adapter', image: 'test' }), execute: async () => shellResult, stop: async () => {} };
  let completion: AgentCompletion | undefined;
  const tools = createSwarmTools({ store, sandbox, actor, signal: new AbortController().signal }, value => { completion = value; });
  const invoke = async (name: string, parameters: object) => {
    const tool = tools.find(candidate => candidate.name === name); if (!tool) throw new Error('Missing tool');
    // SDK extension context is not used by these explicit tools. Exercise their actual handlers.
    return tool.execute(crypto.randomUUID(), parameters, undefined, undefined, noExtensionContext);
  };
  return { store, run, actor, tools, invoke, completion: () => completion };
}

test('structured edits require claims and stale revisions cannot overwrite peers', async () => {
  const { invoke, store, run } = fixture();
  await expect(invoke('write', { path: 'result.txt', content: 'first', base_revision: 0, reason: 'draft' })).rejects.toThrow();
  await invoke('claim_file', { paths: ['result.txt'], reason: 'draft' });
  await invoke('write', { path: 'result.txt', content: 'first', base_revision: 0, reason: 'draft' });
  await expect(invoke('write', { path: 'result.txt', content: 'stale', base_revision: 0, reason: 'stale draft' })).rejects.toThrow();
  await invoke('edit', { path: 'result.txt', old_text: 'first', new_text: 'second', base_revision: 1, reason: 'revise' });
  expect(Buffer.from(store.readFile(run.id, 'result.txt').contentBase64, 'base64').toString()).toBe('second');
});

test('shell changes cannot bypass claims, including one forbidden file among otherwise permitted outputs', async () => {
  const { invoke, store, run } = fixture({ exitCode: 0, stdout: 'done', stderr: '', durationMs: 1, changes: [
    { path: 'allowed.txt', baseRevision: 0, contentBase64: Buffer.from('allowed').toString('base64') },
    { path: 'forbidden.txt', baseRevision: 0, contentBase64: Buffer.from('forbidden').toString('base64') },
  ] });
  await invoke('claim_file', { paths: ['allowed.txt'], reason: 'draft' });
  await expect(invoke('bash', { command: 'generate files' })).rejects.toThrow();
  expect(store.files(run.id)).toHaveLength(0);
});

test('restoration, history and comparison use the canonical owner', async () => {
  const { invoke, store, run } = fixture();
  await invoke('claim_file', { paths: ['result.txt'], reason: 'draft' });
  await invoke('write', { path: 'result.txt', content: 'one', base_revision: 0, reason: 'draft' });
  await invoke('write', { path: 'result.txt', content: 'two', base_revision: 1, reason: 'revise' });
  const history = await invoke('file_history', { path: 'result.txt' }); expect(JSON.stringify(history)).toContain('revision');
  const comparison = await invoke('file_diff', { path: 'result.txt', from_revision: 1, to_revision: 2 }); expect(JSON.stringify(comparison)).toContain('two');
  await invoke('file_restore', { path: 'result.txt', revision: 1, reason: 'restore known good' });
  expect(Buffer.from(store.readFile(run.id, 'result.txt').contentBase64, 'base64').toString()).toBe('one');
});

test('done persists reasoning, ends participation, and blocks subsequent tools', async () => {
  const { invoke, completion, store, run } = fixture();
  await invoke('done', { done_reasoning: 'Rendered and independently verified final output.', output: 'result.txt' });
  expect(completion()?.status).toBe('done');
  expect(store.getSwarm(run.id).agents[0]?.reason).toContain('independently verified');
  await expect(invoke('claim_file', { paths: ['late.txt'], reason: 'late mutation' })).rejects.toThrow('cannot execute');
});

test('bail remains distinct from successful done', async () => {
  const { invoke, completion } = fixture();
  await invoke('done', { done_reasoning: 'Reference is missing.', bail: true });
  expect(completion()?.status).toBe('bailed');
});

test('budget returns one current assessment and its immutable observation event without changing the ledger', async () => {
  const { store, run, actor, invoke } = fixture();
  const own = store.reserve(actor, 1_000_000, 'Synthetic tool observation');
  store.settle(own.id, 543_210, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
  const held = store.reserve(actor, 1_000_000, 'Synthetic temporary reservation');
  const uncertain = store.reserve(actor, 2_000_000, 'Synthetic unknown usage');
  store.markUncertain(uncertain.id, 'Fixture connection loss');
  const before = store.getSwarm(run.id); const ledger = store.reservations(run.id); const events = store.events(run.id);
  const expected = budgetAwareness(before, actor);
  const originalGet = store.getSwarm.bind(store); let reads = 0;
  store.getSwarm = id => { reads++; return originalGet(id); };
  let result: Awaited<ReturnType<typeof invoke>>;
  try { result = await invoke('budget', {}); }
  finally { store.getSwarm = originalGet; }
  expect(reads).toBe(1);
  const part = result.content.find(item => item.type === 'text');
  if (!part || part.type !== 'text') throw new Error('Expected budget text output.');
  const returned: unknown = JSON.parse(part.text);
  const observation = store.events(run.id).at(-1);
  if (!observation) throw new Error('Expected a persisted budget observation.');
  expect(observation).toMatchObject({ seq: events.length + 1, kind: 'budget_observed', agentId: actor.agentId, swarmId: run.id });
  expect(observation.payload).toEqual({ ...expected });
  expect(returned).toEqual({ ...expected, observationSeq: observation.seq });
  expect(store.reservations(run.id)).toEqual(ledger); expect(store.getSwarm(run.id)).toEqual(before);
  expect(store.events(run.id).slice(0, -1)).toEqual(events);
  store.settle(held.id, 100_000, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
  expect(store.events(run.id).find(event => event.seq === observation.seq)?.payload).toEqual(observation.payload);
  expect(returned).toEqual({ ...expected, observationSeq: observation.seq });
});

test('budget does not claim an observation when its event cannot be persisted', async () => {
  const { store, run, invoke } = fixture();
  const before = store.getSwarm(run.id); const events = store.events(run.id);
  const originalAppend = store.appendEvent.bind(store);
  store.appendEvent = () => { throw new Error('Synthetic observation write failure'); };
  try { await expect(invoke('budget', {})).rejects.toThrow('observation write failure'); }
  finally { store.appendEvent = originalAppend; }
  expect(store.getSwarm(run.id)).toEqual(before); expect(store.events(run.id)).toEqual(events);
});
