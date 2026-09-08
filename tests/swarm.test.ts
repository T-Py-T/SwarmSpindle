import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Database } from 'bun:sqlite';
import { openSwarmStore, parseSwarmSpec, SwarmError, type Actor, type SwarmStore } from '../modules/swarm/index.ts';

const roots: string[] = [];
const stores: SwarmStore[] = [];
const usage = { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 };
const encode = (content: string) => Buffer.from(content).toString('base64');
const spec = (overrides: Record<string, unknown> = {}) => parseSwarmSpec({ task: 'Build a pelican riding a bicycle as an SVG.', definitionOfDone: 'An SVG depicts a pelican riding a bicycle and renders without errors.', finalOutput:'pelican.svg', agentCount: 30, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' }, budgetMicros: 50_000_000, ...overrides });

function fixture(count = 2, cap = 100, historyByteLimit?: number) {
  const directory = mkdtempSync(join(tmpdir(), 'swarm-core-')); roots.push(directory);
  const path = join(directory, 'swarm.sqlite'); let now = 1000;
  const store = openSwarmStore(path, { clock: () => now, historyByteLimit }); stores.push(store);
  const swarm = store.createSwarm(spec({ agentCount: count, budgetMicros: cap }));
  store.registerWorker('worker', 123); store.claimNextSwarm('worker');
  const actors = swarm.agents.map(agent => ({ swarmId: swarm.id, agentId: agent.id }));
  actors.forEach(actor => store.startAgent(actor, `session-${actor.agentId}`));
  return { store, path, swarm, actors, first: actors[0]!, second: actors[1]!, tick: (milliseconds: number) => { now += milliseconds; } };
}

function errorCode(action: () => unknown, code: string) {
  try { action(); throw new Error('Expected operation to reject.'); } catch (error) { expect(error).toBeInstanceOf(SwarmError); expect((error as SwarmError).code).toBe(code); }
}

afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('specification and durable lifecycle', () => {
  test('working targets are optional, durable and never exceed the independent hard ceiling', () => {
    const f = fixture();
    const omitted = f.store.createSwarm(spec({ workingTargetMicros: undefined }));
    expect(Object.hasOwn(omitted.spec, 'workingTargetMicros')).toBe(false);
    const targeted = f.store.createSwarm(spec({ budgetMicros: 6_000_000, workingTargetMicros: 250_000, agentCount: 2 }));
    const reopened = openSwarmStore(f.path); stores.push(reopened);
    expect(reopened.getSwarm(targeted.id).spec.workingTargetMicros).toBe(250_000);
    const before = f.store.listSwarms().length;
    for (const target of [0, -1, 0.5, 6_000_001]) errorCode(() => f.store.createSwarm(spec({ budgetMicros: 6_000_000, workingTargetMicros: target })), 'invalid_spec');
    expect(f.store.listSwarms()).toHaveLength(before);
  });
  test('retains exact challenge configuration and rejects missing done criteria', () => {
    const parsed = spec(); expect(parsed.agentCount).toBe(30); expect(parsed.model).toEqual({ provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' }); expect(parsed.budgetMicros).toBe(50_000_000);
    expect(spec({ model: { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' } }).model.id).toBe('gpt-5.5');
    errorCode(() => spec({ definitionOfDone: undefined }), 'invalid_spec');
    for (const finalOutput of [undefined, '', '../pelican.svg', '/tmp/pelican.svg']) errorCode(() => spec({ finalOutput }), 'invalid_spec');
    errorCode(() => spec({ model: { provider:'anthropic',id:'some-other-model',thinking:'high' } }), 'invalid_spec');
    errorCode(() => spec({ model: { provider:'anthropic',id:'claude-opus-4-8',thinking:'low' } }), 'invalid_spec');
    for (const invalid of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) errorCode(() => spec({ budgetMicros: invalid }), 'invalid_spec');
  });
  test('persists agent lifecycle, ordered events, worker heartbeat and budget across reopen', () => {
    const f = fixture(); f.store.renameAgent(f.first, 'Builder'); f.store.setAgentStatus(f.first, 'waiting'); f.tick(50); f.store.heartbeatWorker('worker');
    expect(f.store.listWorkers()[0]?.heartbeatAt).toBe(1050);
    const reservation = f.store.reserve(f.first, 20, 'Known provider rates and maximum tokens'); f.store.settle(reservation.id, 10, usage);
    f.store.endAgent(f.first, 'done', 'SVG tested', 'pelican.svg'); f.store.endAgent(f.second, 'done', 'Reviewed'); f.store.finishSwarm(f.swarm.id, 'completed', 'Every deliverable verified');
    const reopened = openSwarmStore(f.path); stores.push(reopened); const saved = reopened.getSwarm(f.swarm.id);
    expect(saved.status).toBe('completed'); expect(saved.agents[0]?.name).toBe('Builder'); expect(saved.budget.settledMicros).toBe(10); expect(saved.agents[0]?.usage).toEqual(usage);
    const events = reopened.events(f.swarm.id); expect(events.map(event => event.seq)).toEqual(Array.from({ length: events.length }, (_, index) => index + 1)); expect(events.at(-1)?.kind).toBe('swarm_ended');
    expect(reopened.events(f.swarm.id, events.length)).toEqual([]);
    errorCode(() => reopened.stopSwarm(f.swarm.id, 'Stop'), 'run_terminal');
  });
  test('cancellation cannot turn into successful completion and queued cancellation cannot be claimed', () => {
    const f = fixture(); f.store.stopSwarm(f.swarm.id, 'User cancelled');
    errorCode(() => f.store.endAgent(f.first, 'done', 'Too late'), 'run_stopping'); errorCode(() => f.store.reserve(f.first, 1, 'rates'), 'run_not_running');
    f.store.finishSwarm(f.swarm.id, 'cancelled', 'Stopped all sessions');
    errorCode(() => f.store.endAgent(f.first, 'cancelled', 'again'), 'agent_terminal');
    const queued = f.store.createSwarm(spec()); expect(f.store.stopSwarm(queued.id, 'Cancelled before start').status).toBe('cancelled'); expect(f.store.claimNextSwarm('worker')).toBeNull();
  });
  test('rejects invalid stored state on the public read boundary', () => {
    const f = fixture(); const database = new Database(f.path); database.query('UPDATE swarms SET body = ? WHERE id = ?').run('{"version":1}', f.swarm.id); database.close();
    errorCode(() => f.store.getSwarm(f.swarm.id), 'corrupt_state');
  });
  test('seeds operator files only while queued and prevents duplicate worker claims', () => {
    const f = fixture(); const queued = f.store.createSwarm(spec({ agentCount: 1 }));
    f.store.seedFiles(queued.id, [{ path: 'requirements.txt', baseRevision: 0, contentBase64: encode('Draw the complete pelican and bicycle.') }]);
    expect(f.store.readFile(queued.id, 'requirements.txt').authorId).toBe('operator');
    f.store.registerWorker('second-worker', 456);
    expect(f.store.claimNextSwarm('second-worker')?.id).toBe(queued.id); expect(f.store.claimNextSwarm('worker')).toBeNull();
    f.store.offlineWorker('second-worker'); errorCode(() => f.store.heartbeatWorker('second-worker'), 'worker_offline'); errorCode(() => f.store.claimNextSwarm('second-worker'), 'worker_offline');
  });
  test('initial references are atomic with queue creation and invalid references leave no queued run', () => {
    const f=fixture(); const before=f.store.listSwarms().length;
    errorCode(()=>f.store.createSwarm(spec(),[{path:'../escape',baseRevision:0,contentBase64:encode('bad')}]),'invalid_path');
    expect(f.store.listSwarms()).toHaveLength(before);
    const run=f.store.createSwarm(spec(),[{path:'reference/criteria.txt',baseRevision:0,contentBase64:encode('inspect this')}]);
    expect(f.store.claimNextSwarm('worker')?.id).toBe(run.id);
    expect(f.store.readFile(run.id,'reference/criteria.txt').contentBase64).toBe(encode('inspect this'));
  });
});

describe('coordination and scope', () => {
  test('joins threads, keeps inbox incremental, rejects foreign threads and agents, enforces unique names', () => {
    const f = fixture(); const thread = f.store.createThread(f.first, 'SVG composition');
    f.store.joinThread(f.second, thread.id); f.store.post(f.first, thread.id, 'I will draw the bicycle.');
    expect(f.store.inbox(f.second).map(message => message.body)).toEqual(['I will draw the bicycle.']); expect(f.store.inbox(f.second)).toEqual([]);
    f.store.postOperator(f.swarm.id, thread.id, 'Use a white background.'); expect(f.store.inbox(f.second)).toHaveLength(1);
    f.store.renameAgent(f.first, 'Designer'); errorCode(() => f.store.renameAgent(f.second, 'designer'), 'name_taken');
    const other = f.store.createSwarm(spec()); const otherThread = f.store.threads(other.id)[0]!;
    errorCode(() => f.store.post(f.first, otherThread.id, 'Wrong swarm'), 'thread_not_found');
    errorCode(() => f.store.joinThread(f.first, otherThread.id), 'thread_not_found');
    errorCode(() => f.store.inbox({ swarmId: other.id, agentId: f.first.agentId }), 'agent_not_found');
    expect(f.store.messages(f.swarm.id, thread.id, 1)).toHaveLength(1);
  });
});

describe('full-message search and context', () => {
  test('finds earlier full bodies across boards, preserves message identities, and scopes author and swarm', () => {
    const f = fixture();
    const thread = f.store.createThread(f.first, 'Illustration board');
    f.store.renameAgent(f.first, 'Illustrator');
    const earlier = f.store.post(f.first, thread.id, `${'Earlier detail. '.repeat(700)}MiXeD coordination needle`);
    f.store.post(f.first, thread.id, 'The most recent message does not contain the searched word.');
    const general = f.store.threads(f.swarm.id)[0]!;
    const operator = f.store.postOperator(f.swarm.id, general.id, 'Operator coordination needle');
    const other = f.store.createSwarm(spec({ title: 'Another mission' }));
    const otherThread = f.store.threads(other.id)[0]!;
    const foreign = f.store.postOperator(other.id, otherThread.id, 'Across swarms: coordination needle');
    f.store.postOperator(other.id, otherThread.id, 'Unrelated recent update');
    const page = f.store.searchMessages({ query: ' COORDINATION NEEDLE ' });
    expect(page.messages.map(hit => [hit.swarmId, hit.id])).toEqual([[f.swarm.id, earlier.id], [f.swarm.id, operator.id], [other.id, foreign.id]]);
    expect(page.messages[0]).toMatchObject({ body: earlier.body, swarmTitle: f.swarm.spec.title, threadTitle: thread.title, authorName: 'Illustrator' });
    expect(new Set(page.messages.map(hit => hit.searchId)).size).toBe(3);
    expect(page.messages[2]?.id).toBe(1); // Local IDs intentionally overlap between swarms.
    expect(f.store.searchMessages({ query: 'needle', swarmId: f.swarm.id }).messages.map(hit => hit.id)).toEqual([earlier.id, operator.id]);
    expect(f.store.searchMessages({ query: 'needle', authorId: f.first.agentId }).messages.map(hit => hit.id)).toEqual([earlier.id]);
    expect(f.store.searchMessages({ query: 'needle', authorId: 'operator' }).messages).toHaveLength(2);
    expect(f.store.searchMessages({ query: 'needle', swarmId: other.id, authorId: f.first.agentId }).messages).toEqual([]);
    expect(f.store.searchMessages({ query: 'Illustration board' }).messages).toEqual([]);
    f.store.renameAgent(f.first, 'Renamed Illustrator');
    expect(f.store.searchMessages({ query: 'needle', authorId: f.first.agentId }).messages[0]?.authorName).toBe('Renamed Illustrator');
  });
  test('treats punctuation and HTML literally and documents SQLite ASCII case folding', () => {
    const f = fixture(); const thread = f.store.threads(f.swarm.id)[0]!;
    const body = 'Literal 100%_score and a quote \' OR 1=1 -- <img src=x onerror=alert(1)> Ä';
    f.store.postOperator(f.swarm.id, thread.id, body);
    f.store.postOperator(f.swarm.id, thread.id, '100ZZscore does not match wildcard syntax');
    for (const query of ['100%_SCORE', "' OR 1=1 --", '<img src=x onerror=alert(1)>', 'Ä']) {
      expect(f.store.searchMessages({ query }).messages.map(hit => hit.body)).toEqual([body]);
    }
    expect(f.store.searchMessages({ query: 'ä' }).messages).toEqual([]);
    for (const query of ['', '   ', 'x'.repeat(201)]) errorCode(() => f.store.searchMessages({ query }), 'invalid_text');
    for (const limit of [0, -1, 1.5, 51]) expect(() => f.store.searchMessages({ query: 'score', limit })).toThrow(SwarmError);
    for (const after of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => f.store.searchMessages({ query: 'score', after })).toThrow(SwarmError);
    expect(() => f.store.searchMessages({ query: 'score', through: 999 })).toThrow(SwarmError);
  });
  test('keeps global snapshot pages stable across new messages, two connections, and true reopen', () => {
    const f = fixture(); const thread = f.store.threads(f.swarm.id)[0]!;
    const other = f.store.createSwarm(spec()); const secondThread = f.store.threads(other.id)[0]!;
    for (let index = 0; index < 6; index++) f.store.postOperator(index % 2 ? other.id : f.swarm.id, index % 2 ? secondThread.id : thread.id, `needle ${index}`);
    const first = f.store.searchMessages({ query: 'needle', limit: 2 });
    const lastOnFirstPage = first.messages[1];
    if (!lastOnFirstPage) throw new Error('Expected two search hits on the first page.');
    expect(first.next).toBe(lastOnFirstPage.searchId);
    const writer = openSwarmStore(f.path); stores.push(writer);
    writer.postOperator(f.swarm.id, thread.id, 'needle newly arrived');
    const second = f.store.searchMessages({ query: 'needle', limit: 2, after: first.next!, through: first.through });
    const third = f.store.searchMessages({ query: 'needle', limit: 2, after: second.next!, through: first.through });
    expect([...first.messages, ...second.messages, ...third.messages].map(hit => hit.body)).toEqual(Array.from({ length: 6 }, (_, index) => `needle ${index}`));
    expect(third.next).toBeNull(); expect(third.through).toBe(first.through);
    expect(f.store.searchMessages({ query: 'needle' }).messages).toHaveLength(7);
    const saved = f.store.searchMessages({ query: 'needle' });
    stores.splice(stores.indexOf(f.store), 1); f.store.close(); stores.splice(stores.indexOf(writer), 1); writer.close();
    const reopened = openSwarmStore(f.path); stores.push(reopened);
    expect(reopened.searchMessages({ query: 'needle' })).toEqual(saved);
    expect(reopened.searchMessages({ query: 'needle', after: third.messages.at(-1)!.searchId, through: first.through }).messages).toEqual([]);
  });
  test('backfills legacy messages without rewriting canonical state and rolls back failed publications', () => {
    const f = fixture(); const thread = f.store.threads(f.swarm.id)[0]!;
    f.store.post(f.first, thread.id, 'legacy needle');
    const canonical = f.store.getSwarm(f.swarm.id); const events = f.store.events(f.swarm.id);
    const ledger = f.store.reservations(f.swarm.id);
    stores.splice(stores.indexOf(f.store), 1); f.store.close();
    const legacy = new Database(f.path); legacy.exec('DROP TABLE message_search'); legacy.close();
    const reopened = openSwarmStore(f.path); stores.push(reopened);
    expect(reopened.searchMessages({ query: 'legacy' }).messages[0]).toMatchObject({ id: 1, body: 'legacy needle', authorName: 'agent-1' });
    expect(reopened.getSwarm(f.swarm.id)).toEqual(canonical); expect(reopened.events(f.swarm.id)).toEqual(events);
    expect(reopened.reservations(f.swarm.id)).toEqual(ledger);
    const projection = reopened.searchMessages({ query: 'needle' });
    const fault = new Database(f.path);
    fault.exec("CREATE TRIGGER reject_swarm_save BEFORE UPDATE ON swarms BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END;");
    expect(() => reopened.postOperator(f.swarm.id, thread.id, 'failed needle')).toThrow('fixture disk failure');
    expect(reopened.searchMessages({ query: 'needle' })).toEqual(projection);
    expect(reopened.messages(f.swarm.id, thread.id)).toHaveLength(1);
    expect(reopened.events(f.swarm.id)).toEqual(events);
    expect(() => reopened.renameAgent(f.first, 'Rollback rename')).toThrow('fixture disk failure');
    expect(reopened.getSwarm(f.swarm.id)).toEqual(canonical);
    expect(reopened.searchMessages({ query: 'needle' })).toEqual(projection);
    fault.exec('DROP TRIGGER reject_swarm_save'); fault.close();
  });
  test('repairs historical posts missing from an existing projection on reopen while preserving earlier global IDs', () => {
    const f = fixture(); const thread = f.store.threads(f.swarm.id)[0]!;
    f.store.postOperator(f.swarm.id, thread.id, 'needle before upgrade');
    const before = f.store.searchMessages({ query: 'needle' });
    const later = f.store.postOperator(f.swarm.id, thread.id, 'needle posted by an older writer');
    const canonical = f.store.messages(f.swarm.id, thread.id); const budget = f.store.budget(f.swarm.id);
    stores.splice(stores.indexOf(f.store), 1); f.store.close();
    const oldWriter = new Database(f.path);
    oldWriter.query('DELETE FROM message_search WHERE swarm_id = ? AND message_id = ?').run(f.swarm.id, later.id);
    oldWriter.close();
    const reopened = openSwarmStore(f.path); stores.push(reopened);
    const repaired = reopened.searchMessages({ query: 'needle' });
    expect(repaired.messages[0]?.searchId).toBe(before.messages[0]?.searchId);
    expect(repaired.messages.map(({ id, body }) => ({ id, body }))).toEqual(canonical.map(({ id, body }) => ({ id, body })));
    expect(reopened.searchMessages({ query: 'needle', through: before.through })).toEqual(before);
    expect(reopened.messages(f.swarm.id, thread.id)).toEqual(canonical); expect(reopened.budget(f.swarm.id)).toEqual(budget);
    const again = openSwarmStore(f.path); stores.push(again);
    expect(again.searchMessages({ query: 'needle' })).toEqual(repaired);
  });
  test('caps UTF-8 body bytes without truncating messages or skipping hits between pages', () => {
    const f = fixture(); const thread = f.store.threads(f.swarm.id)[0]!;
    const bodies = Array.from({ length: 4 }, (_, index) => `needle ${index} ${'😀'.repeat(90_000)}`);
    bodies.forEach(body => f.store.postOperator(f.swarm.id, thread.id, body));
    const first = f.store.searchMessages({ query: 'needle', limit: 50 });
    expect(first.messages).toHaveLength(2);
    expect(first.messages.reduce((total, message) => total + Buffer.byteLength(message.body), 0)).toBeLessThanOrEqual(1024 * 1024);
    const lastOnFirstPage = first.messages.at(-1);
    if (!lastOnFirstPage) throw new Error('Expected a nonempty byte-bounded search page.');
    expect(first.next).toBe(lastOnFirstPage.searchId);
    const second = f.store.searchMessages({ query: 'needle', limit: 50, after: first.next!, through: first.through });
    expect(second.next).toBeNull();
    expect([...first.messages, ...second.messages].map(message => message.body)).toEqual(bodies);
  });
  test('returns at most three neighbors on each side from the target thread only', () => {
    const f = fixture(); const firstThread = f.store.threads(f.swarm.id)[0]!;
    const unrelated = f.store.createThread(f.first, 'Unrelated board');
    const messages = Array.from({ length: 9 }, (_, index) => {
      const message = f.store.postOperator(f.swarm.id, firstThread.id, `context ${index}`);
      f.store.post(f.first, unrelated.id, `other ${index}`); return message;
    });
    const updatedThread = f.store.threads(f.swarm.id)[0];
    if (!updatedThread) throw new Error('Expected the populated context thread.');
    expect(f.store.messageContext(f.swarm.id, messages[4]!.id)).toEqual({ thread: updatedThread, messages: messages.slice(1, 8), targetId: messages[4]!.id });
    expect(f.store.messageContext(f.swarm.id, messages[0]!.id).messages).toEqual(messages.slice(0, 4));
    expect(f.store.messageContext(f.swarm.id, messages[8]!.id).messages).toEqual(messages.slice(5));
    const other = f.store.createSwarm(spec());
    errorCode(() => f.store.messageContext(other.id, messages[4]!.id), 'message_not_found');
    errorCode(() => f.store.messageContext('missing-swarm', 1), 'swarm_not_found');
    errorCode(() => f.store.messageContext(f.swarm.id, 9999), 'message_not_found');
  });
});

describe('versioned atomic files', () => {
  test('bounds repeated historical contents and rolls back every file and event in an oversized batch', () => {
    const f = fixture(2, 100, 1024);
    f.store.claimFiles(f.first, ['repeated.bin', 'other.bin'], 'Exercise the retained history quota');
    const reservation = f.store.reserve(f.first, 10, 'Synthetic accounting remains available at the file quota');
    const content = Buffer.alloc(256, 97).toString('base64');
    for (let revision = 0; revision < 4; revision += 1) {
      f.store.publishFiles(f.first, [{ path: 'repeated.bin', baseRevision: revision, contentBase64: content }], 'Repeated revision');
    }
    const eventsBefore = f.store.events(f.swarm.id);
    errorCode(() => f.store.publishFiles(f.first, [
      { path: 'repeated.bin', baseRevision: 4, contentBase64: encode('replacement') },
      { path: 'other.bin', baseRevision: 0, contentBase64: encode('new file') },
    ], 'This entire batch must be rejected'), 'history_too_large');
    expect(f.store.fileHistory(f.swarm.id, 'repeated.bin').map(version => version.revision)).toEqual([1, 2, 3, 4]);
    expect(f.store.readFile(f.swarm.id, 'repeated.bin').contentBase64).toBe(content);
    expect(f.store.fileHistory(f.swarm.id, 'other.bin')).toEqual([]);
    expect(f.store.events(f.swarm.id)).toEqual(eventsBefore);
    f.store.publishFiles(f.first, [{ path: 'repeated.bin', baseRevision: 4, contentBase64: null }], 'Delete current file without discarding history');
    expect(f.store.files(f.swarm.id)).toEqual([]);
    expect(f.store.fileAtRevision(f.swarm.id, 'repeated.bin', 1).contentBase64).toBe(content);
    errorCode(() => f.store.restoreFile(f.first, 'repeated.bin', 1, 'Restoration also retains new bytes'), 'history_too_large');
    const reopened = openSwarmStore(f.path, { clock: () => 1000, historyByteLimit: 1024 }); stores.push(reopened);
    errorCode(() => reopened.publishFiles(f.first, [{ path: 'other.bin', baseRevision: 0, contentBase64: encode('x') }], 'Reopen cannot refund history'), 'history_too_large');
    f.store.settle(reservation.id, 1, usage);
    f.store.stopSwarm(f.swarm.id, 'Stop after reaching quota');
    f.store.finishSwarm(f.swarm.id, 'cancelled', 'Quota does not block lifecycle evidence');
    expect(f.store.getSwarm(f.swarm.id).budget.settledMicros).toBe(1);
    expect(f.store.events(f.swarm.id).at(-1)?.kind).toBe('swarm_ended');
  });

  test('applies the retained quota to atomic initial seeding and cannot configure above 100 MiB', () => {
    const f = fixture(1, 100, 8); const before = f.store.listSwarms().length;
    errorCode(() => f.store.createSwarm(spec(), [
      { path: 'reference/a.txt', baseRevision: 0, contentBase64: encode('12345') },
      { path: 'reference/b.txt', baseRevision: 0, contentBase64: encode('6789') },
    ]), 'history_too_large');
    expect(f.store.listSwarms()).toHaveLength(before);
    const queued = f.store.createSwarm(spec(), [{ path: 'reference/a.txt', baseRevision: 0, contentBase64: encode('12345678') }]);
    errorCode(() => f.store.seedFiles(queued.id, [{ path: 'reference/b.txt', baseRevision: 0, contentBase64: encode('9') }]), 'history_too_large');
    expect(f.store.files(queued.id).map(file => file.path)).toEqual(['reference/a.txt']);
    for (const invalid of [0, -1, 0.5, Number.NaN, 100 * 1024 * 1024 + 1]) {
      errorCode(() => openSwarmStore(':memory:', { historyByteLimit: invalid }), 'invalid_history_limit');
    }
  });

  test('protects owner-only claims, renewals, expiry and atomic multi-file publication', () => {
    const f = fixture(); f.store.claimFiles(f.first, ['a.svg', 'b.svg'], 'Draw', 100);
    expect(() => f.store.claimFiles(f.second, ['a.svg'], 'Identify the existing owner')).toThrow(`Owner: ${f.first.agentId}`);
    errorCode(() => f.store.claimFiles(f.second, ['c.svg', 'b.svg'], 'Take both'), 'file_claimed'); expect(f.store.claims(f.swarm.id).map(claim => claim.path)).toEqual(['a.svg', 'b.svg']);
    errorCode(() => f.store.releaseFiles(f.second, ['a.svg']), 'not_claim_owner');
    f.store.publishFiles(f.first, [{ path: 'a.svg', baseRevision: 0, contentBase64: encode('one') }, { path: 'b.svg', baseRevision: 0, contentBase64: encode('two') }], 'Initial images');
    errorCode(() => f.store.publishFiles(f.first, [{ path: 'a.svg', baseRevision: 1, contentBase64: encode('changed') }, { path: 'b.svg', baseRevision: 0, contentBase64: encode('stale') }], 'Collision'), 'revision_conflict');
    expect(f.store.readFile(f.swarm.id, 'a.svg').revision).toBe(1);
    f.tick(100); expect(f.store.claims(f.swarm.id)).toEqual([]);
    errorCode(() => f.store.publishFiles(f.first, [{ path: 'a.svg', baseRevision: 1, contentBase64: encode('late') }], 'Expired'), 'claim_required');
    f.store.claimFiles(f.second, ['a.svg'], 'Review'); f.store.publishFiles(f.second, [{ path: 'a.svg', baseRevision: 1, contentBase64: encode('three') }], 'Improve');
    f.store.restoreFile(f.second, 'a.svg', 1, 'Restore original'); expect(f.store.readFile(f.swarm.id, 'a.svg').contentBase64).toBe(encode('one')); expect(f.store.fileHistory(f.swarm.id, 'a.svg').map(file => file.revision)).toEqual([1, 2, 3]);
  });
  test('preserves binary content, delete history and rejects traversal, ambiguous base64, path conflicts and late seeding', () => {
    const f = fixture(); const binary = Buffer.from([0, 255, 128, 10]).toString('base64'); f.store.claimFiles(f.first, ['binary.bin', 'nested/file.txt', 'nested'], 'Binary test');
    f.store.publishFiles(f.first, [{ path: 'binary.bin', baseRevision: 0, contentBase64: binary }], 'Binary'); expect(f.store.readFile(f.swarm.id, 'binary.bin').size).toBe(4);
    errorCode(() => f.store.publishFiles(f.first, [{ path: 'nested/file.txt', baseRevision: 0, contentBase64: 'YQ' }], 'Bad base64'), 'invalid_content');
    errorCode(() => f.store.publishFiles(f.first, [{ path: 'nested/file.txt', baseRevision: 0, contentBase64: '' }, { path: 'nested', baseRevision: 0, contentBase64: '' }], 'File directory collision'), 'path_conflict');
    errorCode(() => f.store.claimFiles(f.first, ['../escape'], 'Escape'), 'invalid_path');
    errorCode(() => f.store.seedFiles(f.swarm.id, [{ path: 'b.txt', baseRevision: 0, contentBase64: '' }]), 'run_started');
    f.store.publishFiles(f.first, [{ path: 'binary.bin', baseRevision: 1, contentBase64: null }], 'Delete'); expect(f.store.files(f.swarm.id)).toEqual([]); expect(f.store.fileAtRevision(f.swarm.id, 'binary.bin', 1).contentBase64).toBe(binary);
    errorCode(() => f.store.readFile(f.swarm.id, 'binary.bin'), 'file_not_found');
  });
});

describe('atomic cost liability', () => {
  test('distinguishes temporary contention from exhaustion and retains unknown liabilities', () => {
    const f = fixture(); const first = f.store.reserve(f.first, 60, 'Maximum 60 micros'); errorCode(() => f.store.reserve(f.second, 50, 'Maximum 50 micros'), 'budget_busy');
    f.store.markUncertain(first.id, 'Connection closed after request accepted'); expect(f.store.budget(f.swarm.id).uncertainMicros).toBe(60);
    errorCode(() => f.store.reserve(f.second, 50, 'Maximum 50 micros'), 'budget_exhausted');
    errorCode(() => f.store.settle(first.id, 61, usage), 'reservation_uncertain'); expect(f.store.budget(f.swarm.id).uncertainMicros).toBe(60);
    const second = f.store.reserve(f.second, 20, 'Maximum 20 micros');
    f.store.settle(second.id, 10, usage); f.store.settle(second.id, 10, { ...usage }); expect(f.store.budget(f.swarm.id).availableMicros).toBe(30); expect(f.store.getSwarm(f.swarm.id).agents[1]?.costMicros).toBe(10);
    errorCode(() => f.store.settle(second.id, 11, usage), 'settlement_conflict'); errorCode(() => f.store.markUncertain(second.id, 'Too late'), 'reservation_settled');
  });
  test('uncertain liability is immutable across close/reopen and rejected settlements leave every record unchanged', () => {
    const f = fixture(); const reservation = f.store.reserve(f.first, 60, 'Maximum 60 micros');
    f.store.markUncertain(reservation.id, 'Transport ended without final usage');
    const budgetBefore = f.store.budget(f.swarm.id);
    const reservationsBefore = f.store.reservations(f.swarm.id);
    const agentsBefore = f.store.getSwarm(f.swarm.id).agents;
    const eventsBefore = f.store.events(f.swarm.id);
    f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    const reopened = openSwarmStore(f.path); stores.push(reopened);
    for (const claimedCost of [0, 20, 60]) errorCode(() => reopened.settle(reservation.id, claimedCost, usage), 'reservation_uncertain');
    expect(reopened.budget(f.swarm.id)).toEqual(budgetBefore);
    expect(reopened.budget(f.swarm.id)).toMatchObject({ settledMicros: 0, uncertainMicros: 60, availableMicros: 40 });
    expect(reopened.reservations(f.swarm.id)).toEqual(reservationsBefore);
    expect(reopened.getSwarm(f.swarm.id).agents).toEqual(agentsBefore);
    expect(reopened.events(f.swarm.id)).toEqual(eventsBefore);
    errorCode(() => reopened.reserve(f.second, 41, 'Would fit only if uncertainty was refunded'), 'budget_exhausted');
  });
  test('settles a still-reserved response after cancellation while refusing further requests', () => {
    const f = fixture(); const reservation = f.store.reserve(f.first, 50, 'Maximum 50 micros'); f.store.stopSwarm(f.swarm.id, 'User stop'); f.store.finishSwarm(f.swarm.id, 'cancelled', 'Stopped');
    f.store.settle(reservation.id, 30, usage); expect(f.store.budget(f.swarm.id).availableMicros).toBe(70);
    errorCode(() => f.store.reserve(f.first, 1, 'Maximum'), 'run_not_running');
  });
  test('rejects fractional money, unpriced requests and overshoots without releasing liability', () => {
    const f = fixture();
    for (const invalid of [-1, 0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) errorCode(() => f.store.reserve(f.first, invalid, 'Rates'), 'invalid_number');
    errorCode(() => f.store.reserve(f.first, 10, ''), 'invalid_text');
    const reservation = f.store.reserve(f.first, 10, 'Rates'); errorCode(() => f.store.settle(reservation.id, 11, usage), 'reservation_overshoot');
    expect(f.store.budget(f.swarm.id).reservedMicros).toBe(10);
    errorCode(() => f.store.settle(reservation.id, 9, { ...usage, output: -1 }), 'invalid_usage'); expect(f.store.budget(f.swarm.id).reservedMicros).toBe(10);
  });
  test('30 simultaneous independent connections cannot over-reserve or share one claim', async () => {
    const f = fixture(30, 50); const moduleUrl = new URL('../modules/swarm/index.ts', import.meta.url).href;
    const workerSource = `const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.moduleUrl).then(({ openSwarmStore }) => {
        const store = openSwarmStore(workerData.path);
        parentPort.once('message', () => {
          let reservation = 'ok'; let claim = 'ok';
          try { store.reserve(workerData.actor, 10, 'Fixed maximum 10 micros'); } catch (error) { reservation = error.code; }
          try { store.claimFiles(workerData.actor, ['contended.svg'], 'One writer'); } catch (error) { claim = error.code; }
          store.close(); parentPort.postMessage({ reservation, claim }); parentPort.close();
        }); parentPort.postMessage('ready');
      }).catch(error => { throw error; });`;
    const workers = f.actors.map(actor => new Worker(workerSource, { eval: true, workerData: { path: f.path, actor, moduleUrl } }));
    try {
      const ready = workers.map(worker => new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject); }));
      await Promise.all(ready);
      const results = workers.map(worker => new Promise<{ reservation: string; claim: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
      workers.forEach(worker => worker.postMessage('start'));
      const outcomes = await Promise.all(results);
      expect(outcomes.filter(outcome => outcome.reservation === 'ok')).toHaveLength(5);
      expect(outcomes.filter(outcome => outcome.reservation === 'budget_busy')).toHaveLength(25);
      expect(outcomes.filter(outcome => outcome.claim === 'ok')).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome.claim === 'file_claimed')).toHaveLength(29);
      expect(f.store.budget(f.swarm.id).reservedMicros).toBe(50); expect(f.store.budget(f.swarm.id).availableMicros).toBe(0); expect(f.store.claims(f.swarm.id)).toHaveLength(1);
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  }, 30_000);
});
