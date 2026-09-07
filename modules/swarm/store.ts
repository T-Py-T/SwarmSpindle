import { Database } from 'bun:sqlite';
import { z } from 'zod';
import { SwarmError, normalizeWorkspacePath, type Actor, type AgentRecord, type FileChange, type FileVersion, type Json, type Reservation, type RunStatus, type SwarmRecord, type SwarmSpec, type SwarmStore, type TokenUsage, type WorkspaceFile } from './contracts.ts';
import { parseSwarmSpec } from './spec.ts';
import { budgetOf, stateSchema, sumSafe, usageSchema, workerSchema, type State, type StoredReservation } from './state.ts';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 100 * 1024 * 1024;
// Historical contents remain immutable, so deleted and restored revisions still consume this quota.
const MAX_HISTORY_BYTES = 100 * 1024 * 1024;
const terminalAgents = new Set(['done', 'bailed', 'failed', 'cancelled', 'stalled']);
const terminalRuns = new Set(['completed', 'bailed', 'failed', 'cancelled', 'budget_exhausted', 'interrupted']);

function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new SwarmError(code, message);
}

function text(input: string, maximum = 200_000): string {
  requireValue(typeof input === 'string' && input.trim().length > 0 && input.length <= maximum, 'invalid_text', 'Text must be nonempty and within its size limit.');
  return input.trim();
}

function integer(input: number, minimum = 0): number {
  requireValue(Number.isSafeInteger(input) && input >= minimum, 'invalid_number', 'Expected a safe integer within range.');
  return input;
}

function checkedPath(input: string): string {
  requireValue(typeof input === 'string', 'invalid_path', 'Expected a workspace path.');
  return normalizeWorkspacePath(input);
}

function decodeContent(content: string): number {
  requireValue(typeof content === 'string' && content.length <= Math.ceil(MAX_FILE_BYTES / 3) * 4, 'invalid_content', 'File exceeds the 10 MiB limit.');
  const bytes = Buffer.from(content, 'base64');
  requireValue(bytes.toString('base64') === content && bytes.length <= MAX_FILE_BYTES, 'invalid_content', 'File content must be canonical base64 within the size limit.');
  return bytes.length;
}

function actorIn(state: State, actor: Actor): AgentRecord {
  const agent = state.agents.find(candidate => candidate.id === actor.agentId);
  requireValue(actor.swarmId === state.id && agent, 'agent_not_found', 'Agent does not belong to this swarm.');
  return agent;
}

function activeActor(state: State, actor: Actor): AgentRecord {
  const agent = actorIn(state, actor);
  requireValue(state.status === 'running', 'run_not_running', 'The swarm is not running.');
  requireValue(!terminalAgents.has(agent.status), 'agent_terminal', 'The agent already ended.');
  return agent;
}

function threadIn(state: State, threadId: string) {
  const thread = state.threads.find(candidate => candidate.id === threadId);
  requireValue(thread, 'thread_not_found', 'Thread does not belong to this swarm.');
  return thread;
}

function latestFiles(state: State): WorkspaceFile[] {
  return [...new Map(state.versions.map(version => [version.path, version])).values()];
}

function currentRevision(state: State, path: string): number {
  return state.versions.findLast(version => version.path === path)?.revision ?? 0;
}

function publicReservation(reservation: StoredReservation): Reservation {
  const { usage: _, ...result } = reservation;
  return result;
}

function recordOf(state: State): SwarmRecord {
  const { id, spec, status, createdAt, startedAt, endedAt, reason, workerId, agents } = state;
  return { id, spec, status, createdAt, startedAt, endedAt, reason, workerId, agents, budget: budgetOf(state) };
}

function validateState(input: unknown): State {
  const result = stateSchema.safeParse(input);
  requireValue(result.success, 'corrupt_state', 'Stored swarm state does not match the supported schema.');
  const state = result.data;
  const agents = new Set(state.agents.map(agent => agent.id));
  const threads = new Set(state.threads.map(thread => thread.id));
  requireValue(terminalRuns.has(state.status) === (state.endedAt !== null), 'corrupt_state', 'Stored swarm lifecycle timestamps are invalid.');
  requireValue(state.status !== 'queued' || (state.startedAt === null && state.workerId === null), 'corrupt_state', 'A queued swarm cannot already have a worker.');
  requireValue((state.status !== 'running' && state.status !== 'stopping') || (state.startedAt !== null && state.workerId !== null), 'corrupt_state', 'An active swarm must have a start time and worker.');
  requireValue(state.status !== 'completed' || state.agents.every(agent => agent.status === 'done'), 'corrupt_state', 'A completed swarm contains unfinished agents.');
  requireValue(agents.size === state.spec.agentCount && state.agents.length === agents.size, 'corrupt_state', 'Stored agent roster is invalid.');
  requireValue(new Set(state.agents.map(agent => agent.name.toLocaleLowerCase())).size === agents.size, 'corrupt_state', 'Stored agent names collide.');
  requireValue(state.threads.length === threads.size && state.threads.every(thread => thread.swarmId === state.id && thread.members.every(id => agents.has(id))), 'corrupt_state', 'Stored thread scope is invalid.');
  requireValue(state.messages.every((message, index) => message.id === index + 1 && message.swarmId === state.id && threads.has(message.threadId) && (message.authorId === 'operator' || agents.has(message.authorId))), 'corrupt_state', 'Stored messages are invalid.');
  requireValue(state.events.every((event, index) => event.seq === index + 1 && event.swarmId === state.id && (event.agentId === null || agents.has(event.agentId))), 'corrupt_state', 'Stored event sequence is invalid.');
  requireValue(new Set(state.reservations.map(entry => entry.id)).size === state.reservations.length && state.reservations.every(entry => entry.swarmId === state.id && agents.has(entry.agentId) && entry.ceilingMicros > 0 && (entry.status === 'settled' ? entry.actualMicros !== null && entry.actualMicros <= entry.ceilingMicros && entry.usage !== null : entry.actualMicros === null && entry.usage === null)), 'corrupt_state', 'Stored reservations are invalid.');
  requireValue(budgetOf(state).availableMicros >= 0, 'corrupt_state', 'Stored budget exceeds its cap.');
  requireValue(Object.entries(state.cursors).every(([id, cursor]) => agents.has(id) && cursor <= state.messages.length), 'corrupt_state', 'Stored inbox cursor is invalid.');
  for (const thread of state.threads) {
    requireValue(new Set(thread.members).size === thread.members.length && thread.messageCount === state.messages.filter(message => message.threadId === thread.id).length, 'corrupt_state', 'Stored thread membership or message count is invalid.');
  }
  for (const agent of state.agents) {
    requireValue(terminalAgents.has(agent.status) === (agent.endedAt !== null), 'corrupt_state', 'Stored agent lifecycle timestamps are invalid.');
    requireValue((agent.status !== 'running' && agent.status !== 'waiting') || (agent.startedAt !== null && agent.sessionId !== null), 'corrupt_state', 'An active agent must have a session.');
    const settlements = state.reservations.filter(entry => entry.agentId === agent.id && entry.status === 'settled');
    requireValue(agent.costMicros === sumSafe(settlements.map(entry => entry.actualMicros ?? 0)), 'corrupt_state', 'Stored agent accounting disagrees with its ledger.');
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      requireValue(agent.usage[key] === sumSafe(settlements.map(entry => entry.usage?.[key] ?? 0)), 'corrupt_state', 'Stored token usage disagrees with its ledger.');
    }
  }
  const revisions = new Map<string, number>();
  for (const version of state.versions) {
    checkedPath(version.path);
    requireValue(version.revision === (revisions.get(version.path) ?? 0) + 1 && (version.authorId === 'operator' || agents.has(version.authorId)), 'corrupt_state', 'Stored file revision or author is invalid.');
    revisions.set(version.path, version.revision);
    requireValue(decodeContent(version.contentBase64) === version.size && (!version.deleted || version.size === 0), 'corrupt_state', 'Stored file content is invalid.');
  }
  requireValue(new Set(state.claims.map(claim => claim.path)).size === state.claims.length && state.claims.every(claim => agents.has(claim.ownerId)), 'corrupt_state', 'Stored claims are invalid.');
  state.claims.forEach(claim => checkedPath(claim.path));
  return state;
}

export interface StoreOptions {
  clock?: () => number;
  /** Optional stricter retained-content quota; it cannot exceed the 100 MiB safety limit. */
  historyByteLimit?: number;
}

export function openSwarmStore(path: string, options: StoreOptions = {}): SwarmStore {
  const historyByteLimit = options.historyByteLimit ?? MAX_HISTORY_BYTES;
  requireValue(Number.isSafeInteger(historyByteLimit) && historyByteLimit > 0 && historyByteLimit <= MAX_HISTORY_BYTES, 'invalid_history_limit', 'File history limit must be a positive integer no greater than 100 MiB.');
  return new SqliteSwarmStore(path, options.clock ?? Date.now, historyByteLimit);
}

class SqliteSwarmStore implements SwarmStore {
  private readonly database: Database;
  constructor(path: string, private readonly clock: () => number, private readonly historyByteLimit: number) {
    this.database = new Database(path, { create: true, strict: true });
    this.database.exec('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    this.database.exec('CREATE TABLE IF NOT EXISTS swarms (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reservation_owners (id TEXT PRIMARY KEY, swarm_id TEXT NOT NULL);');
  }
  close(): void { this.database.close(); }
  private now(): number { return integer(this.clock()); }
  private load(id: string): State {
    const row = this.database.query<{ body: string }, [string]>('SELECT body FROM swarms WHERE id = ?').get(id);
    requireValue(row, 'swarm_not_found', 'Swarm does not exist.');
    let parsed: unknown;
    try { parsed = JSON.parse(row.body); } catch { throw new SwarmError('corrupt_state', 'Stored swarm JSON is invalid.'); }
    const state = validateState(parsed);
    requireValue(state.id === id, 'corrupt_state', 'Stored swarm identity is invalid.');
    return state;
  }
  private save(state: State): void {
    validateState(state);
    this.database.query('INSERT INTO swarms (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body').run(state.id, JSON.stringify(state));
  }
  private mutate<T>(id: string, operation: (state: State) => T): T {
    return this.database.transaction(() => {
      const state = this.load(id);
      const result = operation(state);
      this.save(state);
      return result;
    }).immediate();
  }
  private event(state: State, agentId: string | null, kind: string, payload: Json) {
    if (agentId !== null) actorIn(state, { swarmId: state.id, agentId });
    const validPayload = z.json().safeParse(payload);
    requireValue(validPayload.success && JSON.stringify(payload).length <= 1_000_000, 'invalid_event', 'Event payload must be bounded JSON.');
    const event = { seq: state.events.length + 1, swarmId: state.id, agentId, kind: text(kind, 200), createdAt: this.now(), payload: validPayload.data };
    state.events.push(event);
    return event;
  }
  createSwarm(input: SwarmSpec, initialFiles: FileChange[] = []): SwarmRecord {
    const spec = parseSwarmSpec(input);
    const id = crypto.randomUUID();
    const createdAt = this.now();
    const agents: AgentRecord[] = Array.from({ length: spec.agentCount }, (_, index) => ({ id: `${id}:agent-${index + 1}`, name: `agent-${index + 1}`, status: 'ready', sessionId: null, startedAt: null, updatedAt: createdAt, endedAt: null, reason: null, output: null, costMicros: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, toolCalls: 0 }));
    const state: State = { version: 1, id, spec, status: 'queued', createdAt, startedAt: null, endedAt: null, reason: null, workerId: null, agents, threads: [{ id: `${id}:general`, swarmId: id, title: 'general', createdAt, updatedAt: createdAt, members: agents.map(agent => agent.id), messageCount: 0 }], messages: [], cursors: {}, claims: [], versions: [], reservations: [], events: [] };
    this.event(state, null, 'swarm_created', { spec: { ...spec, model: { ...spec.model } } });
    if (initialFiles.length) this.publish(state, 'operator', initialFiles, 'Operator seed');
    this.database.transaction(() => this.save(state)).immediate();
    return recordOf(state);
  }
  listSwarms(): SwarmRecord[] {
    return this.database.query<{ id: string }, []>('SELECT id FROM swarms ORDER BY rowid DESC').all().map(row => this.getSwarm(row.id));
  }
  getSwarm(id: string): SwarmRecord { return recordOf(this.load(id)); }
  claimNextSwarm(workerId: string): SwarmRecord | null {
    return this.database.transaction(() => {
      const worker = this.worker(workerId);
      requireValue(worker.status === 'online', 'worker_offline', 'Worker must be online to claim a swarm.');
      for (const row of this.database.query<{ id: string }, []>('SELECT id FROM swarms ORDER BY rowid').all()) {
        const state = this.load(row.id);
        if (state.status !== 'queued') continue;
        state.status = 'running'; state.workerId = workerId; state.startedAt = this.now();
        this.event(state, null, 'swarm_started', { workerId });
        this.save(state);
        return recordOf(state);
      }
      return null;
    }).immediate();
  }
  stopSwarm(id: string, reason: string): SwarmRecord {
    return this.mutate(id, state => {
      requireValue(!terminalRuns.has(state.status), 'run_terminal', 'Swarm already ended.');
      if (state.status === 'stopping') return recordOf(state);
      state.reason = text(reason);
      if (state.status === 'queued') this.finish(state, 'cancelled', reason);
      else { state.status = 'stopping'; this.event(state, null, 'swarm_stopping', { reason: state.reason }); }
      return recordOf(state);
    });
  }
  private finish(state: State, status: Exclude<RunStatus, 'queued' | 'running' | 'stopping'>, reason: string): void {
    requireValue(terminalRuns.has(status), 'invalid_status', 'Expected a terminal swarm status.');
    requireValue(!terminalRuns.has(state.status), 'run_terminal', 'Swarm already ended.');
    requireValue(status !== 'completed' || state.agents.every(agent => agent.status === 'done'), 'agents_unfinished', 'Completion requires every agent to be done.');
    requireValue(status !== 'completed' || state.status === 'running', 'run_not_running', 'A stopping swarm cannot complete successfully.');
    state.status = status; state.reason = text(reason); state.endedAt = this.now();
    for (const agent of state.agents) {
      if (terminalAgents.has(agent.status)) continue;
      agent.status = status === 'cancelled' ? 'cancelled' : 'failed'; agent.reason = state.reason; agent.endedAt = state.endedAt; agent.updatedAt = state.endedAt;
      this.event(state, agent.id, 'agent_ended', { status: agent.status, reason: state.reason });
    }
    state.claims = [];
    this.event(state, null, 'swarm_ended', { status, reason: state.reason });
  }
  finishSwarm(id: string, status: Exclude<RunStatus, 'queued' | 'running' | 'stopping'>, reason: string): SwarmRecord {
    return this.mutate(id, state => { this.finish(state, status, reason); return recordOf(state); });
  }
  private worker(id: string) {
    const row = this.database.query<{ body: string }, [string]>('SELECT body FROM workers WHERE id = ?').get(id);
    requireValue(row, 'worker_not_found', 'Worker is not registered.');
    const result = workerSchema.safeParse(JSON.parse(row.body));
    requireValue(result.success && result.data.id === id, 'corrupt_state', 'Stored worker is invalid.');
    return result.data;
  }
  registerWorker(id: string, pid: number) {
    const now = this.now();
    const worker = workerSchema.parse({ id: text(id, 200), pid: integer(pid, 1), startedAt: now, heartbeatAt: now, status: 'online' });
    this.database.transaction(() => {
      this.database.query('INSERT INTO workers (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body').run(id, JSON.stringify(worker));
    }).immediate();
    return worker;
  }
  heartbeatWorker(id: string): void {
    this.database.transaction(() => {
      const worker = this.worker(id);
      requireValue(worker.status === 'online', 'worker_offline', 'An offline worker cannot heartbeat.');
      worker.heartbeatAt = this.now();
      this.database.query('UPDATE workers SET body = ? WHERE id = ?').run(JSON.stringify(worker), id);
    }).immediate();
  }
  listWorkers() { return this.database.query<{ id: string }, []>('SELECT id FROM workers ORDER BY rowid').all().map(row => this.worker(row.id)); }
  offlineWorker(id: string): void {
    this.database.transaction(() => {
      const worker = this.worker(id); worker.status = 'offline';
      this.database.query('UPDATE workers SET body = ? WHERE id = ?').run(JSON.stringify(worker), id);
    }).immediate();
  }
  startAgent(actor: Actor, sessionId: string): void {
    this.mutate(actor.swarmId, state => {
      const agent = activeActor(state, actor);
      requireValue(agent.status === 'ready', 'agent_started', 'Agent has already started.');
      agent.status = 'running'; agent.sessionId = text(sessionId, 500); agent.startedAt = this.now(); agent.updatedAt = agent.startedAt;
      this.event(state, agent.id, 'agent_started', { sessionId: agent.sessionId });
    });
  }
  renameAgent(actor: Actor, name: string): AgentRecord {
    return this.mutate(actor.swarmId, state => {
      const agent = activeActor(state, actor); const next = text(name, 80);
      requireValue(!state.agents.some(candidate => candidate.id !== agent.id && candidate.name.toLocaleLowerCase() === next.toLocaleLowerCase()), 'name_taken', 'Agent names must be unique.');
      agent.name = next; agent.updatedAt = this.now(); this.event(state, agent.id, 'agent_renamed', { name: next }); return agent;
    });
  }
  setAgentStatus(actor: Actor, status: 'running' | 'waiting'): void {
    this.mutate(actor.swarmId, state => {
      const agent = activeActor(state, actor);
      requireValue((status === 'running' || status === 'waiting') && agent.status !== 'ready', 'invalid_status', 'Start the agent before changing its status.');
      agent.status = status; agent.updatedAt = this.now(); this.event(state, agent.id, 'agent_status', { status });
    });
  }
  endAgent(actor: Actor, status: 'done' | 'bailed' | 'failed' | 'cancelled' | 'stalled', reason: string, output?: string): void {
    this.mutate(actor.swarmId, state => {
      const agent = actorIn(state, actor);
      requireValue(!terminalRuns.has(state.status) && !terminalAgents.has(agent.status), 'agent_terminal', 'Agent or swarm already ended.');
      requireValue(terminalAgents.has(status), 'invalid_status', 'Expected a terminal agent status.');
      requireValue(state.status === 'running' || state.status === 'stopping', 'run_not_running', 'The swarm has not started.');
      requireValue(state.status !== 'stopping' || status !== 'done', 'run_stopping', 'A cancelled agent cannot report successful completion.');
      requireValue(status !== 'done' || agent.startedAt !== null, 'agent_not_started', 'An agent must start before reporting success.');
      requireValue(output === undefined || (typeof output === 'string' && output.length <= 200_000), 'invalid_output', 'Output exceeds the size limit.');
      agent.status = status; agent.reason = text(reason); agent.output = output ?? null; agent.endedAt = this.now(); agent.updatedAt = agent.endedAt;
      state.claims = state.claims.filter(claim => claim.ownerId !== agent.id);
      this.event(state, agent.id, 'agent_ended', { status, reason: agent.reason, output: agent.output });
    });
  }
  appendEvent(id: string, agentId: string | null, kind: string, payload: Json) {
    return this.mutate(id, state => {
      if (agentId !== null && (kind === 'tool_start' || kind === 'tool_execution_start')) {
        const agent = actorIn(state, { swarmId: id, agentId }); agent.toolCalls = sumSafe([agent.toolCalls, 1]); agent.updatedAt = this.now();
      }
      return this.event(state, agentId, kind, payload);
    });
  }
  events(id: string, after = 0, limit = 1000) { integer(after); integer(limit, 1); requireValue(limit <= 10000, 'invalid_limit', 'Event limit cannot exceed 10000.'); return this.load(id).events.filter(event => event.seq > after).slice(0, limit); }
  createThread(actor: Actor, title: string) {
    return this.mutate(actor.swarmId, state => {
      activeActor(state, actor); const now = this.now();
      const thread = { id: crypto.randomUUID(), swarmId: state.id, title: text(title, 200), createdAt: now, updatedAt: now, members: [actor.agentId], messageCount: 0 };
      state.threads.push(thread); this.event(state, actor.agentId, 'thread_created', { threadId: thread.id, title: thread.title }); return thread;
    });
  }
  joinThread(actor: Actor, threadId: string) {
    return this.mutate(actor.swarmId, state => {
      activeActor(state, actor); const thread = threadIn(state, threadId);
      if (!thread.members.includes(actor.agentId)) { thread.members.push(actor.agentId); thread.updatedAt = this.now(); this.event(state, actor.agentId, 'thread_joined', { threadId }); }
      return thread;
    });
  }
  threads(id: string) { return this.load(id).threads; }
  private postMessage(state: State, authorId: string, threadId: string, body: string) {
    const thread = threadIn(state, threadId);
    const message = { id: state.messages.length + 1, swarmId: state.id, threadId, authorId, body: text(body), createdAt: this.now() };
    state.messages.push(message); thread.messageCount += 1; thread.updatedAt = message.createdAt;
    this.event(state, authorId === 'operator' ? null : authorId, 'message_posted', { threadId, messageId: message.id, body: message.body, authorId }); return message;
  }
  post(actor: Actor, threadId: string, body: string) {
    return this.mutate(actor.swarmId, state => {
      activeActor(state, actor); requireValue(threadIn(state, threadId).members.includes(actor.agentId), 'not_member', 'Join the thread before posting.'); return this.postMessage(state, actor.agentId, threadId, body);
    });
  }
  postOperator(id: string, threadId: string, body: string) {
    return this.mutate(id, state => { requireValue(!terminalRuns.has(state.status), 'run_terminal', 'Swarm already ended.'); return this.postMessage(state, 'operator', threadId, body); });
  }
  messages(id: string, threadId: string, after = 0) { const state = this.load(id); threadIn(state, threadId); integer(after); return state.messages.filter(message => message.threadId === threadId && message.id > after); }
  inbox(actor: Actor) {
    return this.mutate(actor.swarmId, state => {
      actorIn(state, actor);
      const joined = new Set(state.threads.filter(thread => thread.members.includes(actor.agentId)).map(thread => thread.id));
      const messages = state.messages.filter(message => message.id > (state.cursors[actor.agentId] ?? 0) && message.authorId !== actor.agentId && joined.has(message.threadId));
      state.cursors[actor.agentId] = state.messages.length;
      return messages;
    });
  }
  claims(id: string) { const now = this.now(); return this.load(id).claims.filter(claim => claim.expiresAt > now); }
  claimFiles(actor: Actor, paths: string[], reason: string, ttlMs = 120_000) {
    return this.mutate(actor.swarmId, state => {
      activeActor(state, actor); integer(ttlMs, 1); requireValue(ttlMs <= 3_600_000, 'invalid_ttl', 'Claims may last at most one hour.');
      requireValue(paths.length > 0 && paths.length <= 1000, 'invalid_changes', 'Claim between 1 and 1000 paths.');
      const unique = [...new Set(paths.map(checkedPath))]; const now = this.now(); const claimReason = text(reason, 2000);
      state.claims = state.claims.filter(claim => claim.expiresAt > now);
      for (const path of unique) {
        const owner = state.claims.find(claim => claim.ownerId !== actor.agentId && (claim.path === path || claim.path.startsWith(`${path}/`) || path.startsWith(`${claim.path}/`)));
        requireValue(!owner, 'file_claimed', `Another agent owns ${path}. Owner: ${owner?.ownerId}; claimed path: ${owner?.path}; lease expires at ${owner?.expiresAt}. Coordinate with this peer before retrying.`);
      }
      const acquired = unique.map(path => ({ path, ownerId: actor.agentId, reason: claimReason, expiresAt: integer(now + ttlMs) }));
      state.claims = [...state.claims.filter(claim => !unique.includes(claim.path)), ...acquired];
      this.event(state, actor.agentId, 'files_claimed', { paths: unique, reason: claimReason, expiresAt: now + ttlMs }); return acquired;
    });
  }
  releaseFiles(actor: Actor, paths: string[]): void {
    this.mutate(actor.swarmId, state => {
      actorIn(state, actor); const unique = [...new Set(paths.map(checkedPath))]; const now = this.now();
      for (const path of unique) requireValue(!state.claims.some(claim => claim.path === path && claim.expiresAt > now && claim.ownerId !== actor.agentId), 'not_claim_owner', 'Cannot release another agent’s claim.');
      state.claims = state.claims.filter(claim => claim.ownerId !== actor.agentId || !unique.includes(claim.path)); this.event(state, actor.agentId, 'files_released', { paths: unique });
    });
  }
  files(id: string) { return latestFiles(this.load(id)).filter(file => !file.deleted); }
  readFile(id: string, path: string) { checkedPath(path); const file = this.load(id).versions.findLast(version => version.path === path); requireValue(file && !file.deleted, 'file_not_found', 'File does not exist.'); return file; }
  private publish(state: State, authorId: string, changes: FileChange[], reason: string): FileVersion[] {
    requireValue(changes.length > 0 && changes.length <= 1000, 'invalid_changes', 'Publish between 1 and 1000 paths.');
    const paths = changes.map(change => checkedPath(change.path));
    requireValue(new Set(paths).size === paths.length, 'duplicate_path', 'A changeset cannot repeat a path.');
    const now = this.now(); const publishReason = text(reason, 2000);
    const versions = changes.map(change => {
      integer(change.baseRevision);
      requireValue(change.contentBase64 === null || typeof change.contentBase64 === 'string', 'invalid_content', 'File content must be canonical base64 or null for deletion.');
      requireValue(currentRevision(state, change.path) === change.baseRevision, 'revision_conflict', `Base revision changed for ${change.path}.`);
      if (authorId !== 'operator') requireValue(state.claims.some(claim => claim.path === change.path && claim.ownerId === authorId && claim.expiresAt > now), 'claim_required', `A live owned claim is required for ${change.path}.`);
      const contentBase64 = change.contentBase64 ?? '';
      const size = decodeContent(contentBase64);
      return { path: change.path, revision: change.baseRevision + 1, authorId, createdAt: now, reason: publishReason, deleted: change.contentBase64 === null, size, contentBase64 };
    });
    const resultingFiles = [...new Map([...latestFiles(state), ...versions].map(file => [file.path, file])).values()].filter(file => !file.deleted);
    const retainedBytes = sumSafe(state.versions.map(version => version.size));
    const addedBytes = sumSafe(versions.map(version => version.size));
    requireValue(sumSafe([retainedBytes, addedBytes]) <= this.historyByteLimit, 'history_too_large', `Retained file contents exceed the ${this.historyByteLimit}-byte history limit. Earlier versions are preserved; export this swarm before starting a new one.`);
    requireValue(sumSafe(resultingFiles.map(file => file.size)) <= MAX_WORKSPACE_BYTES, 'workspace_too_large', 'Workspace exceeds 100 MiB.');
    const resultingPaths = new Set(resultingFiles.map(file => file.path));
    for (const path of resultingPaths) {
      const components = path.split('/'); components.pop();
      while (components.length) { requireValue(!resultingPaths.has(components.join('/')), 'path_conflict', 'A file cannot also be a directory.'); components.pop(); }
    }
    state.versions.push(...versions);
    this.event(state, authorId === 'operator' ? null : authorId, 'files_published', { reason: publishReason, versions: versions.map(({ contentBase64: _, ...version }) => version) });
    return versions.map(({ contentBase64: _, ...version }) => version);
  }
  publishFiles(actor: Actor, changes: FileChange[], reason: string) { return this.mutate(actor.swarmId, state => { activeActor(state, actor); return this.publish(state, actor.agentId, changes, reason); }); }
  seedFiles(id: string, changes: FileChange[]): void { this.mutate(id, state => { requireValue(state.status === 'queued', 'run_started', 'Operator files can only be seeded before the run.'); this.publish(state, 'operator', changes, 'Operator seed'); }); }
  fileHistory(id: string, path: string) { checkedPath(path); return this.load(id).versions.filter(version => version.path === path).map(({ contentBase64: _, ...version }) => version); }
  fileAtRevision(id: string, path: string, revision: number) { checkedPath(path); integer(revision, 1); const file = this.load(id).versions.find(version => version.path === path && version.revision === revision); requireValue(file, 'revision_not_found', 'File revision does not exist.'); return file; }
  restoreFile(actor: Actor, path: string, revision: number, reason: string): FileVersion {
    return this.mutate(actor.swarmId, state => {
      activeActor(state, actor); checkedPath(path); integer(revision, 1);
      const file = state.versions.find(version => version.path === path && version.revision === revision);
      requireValue(file, 'revision_not_found', 'File revision does not exist.');
      const restored = this.publish(state, actor.agentId, [{ path, baseRevision: currentRevision(state, path), contentBase64: file.deleted ? null : file.contentBase64 }], reason)[0];
      requireValue(restored, 'invalid_changes', 'Restore produced no version.'); return restored;
    });
  }
  budget(id: string) { return budgetOf(this.load(id)); }
  reserve(actor: Actor, ceilingMicros: number, pricingEvidence: string): Reservation {
    return this.mutate(actor.swarmId, state => {
      activeActor(state, actor); integer(ceilingMicros, 1); const evidence = text(pricingEvidence, 20000); const budget = budgetOf(state);
      if (ceilingMicros > budget.availableMicros) {
        const permanentRemaining = state.spec.budgetMicros - sumSafe([budget.settledMicros, budget.uncertainMicros]);
        throw new SwarmError(ceilingMicros <= permanentRemaining && budget.reservedMicros > 0 ? 'budget_busy' : 'budget_exhausted', 'The request cannot be reserved within the remaining cap.');
      }
      const reservation: StoredReservation = { id: crypto.randomUUID(), swarmId: state.id, agentId: actor.agentId, ceilingMicros, status: 'reserved', actualMicros: null, createdAt: this.now(), pricingEvidence: evidence, usage: null };
      state.reservations.push(reservation);
      this.database.query('INSERT INTO reservation_owners (id, swarm_id) VALUES (?, ?)').run(reservation.id, state.id);
      this.event(state, actor.agentId, 'budget_reserved', { reservationId: reservation.id, ceilingMicros, pricingEvidence: evidence }); return publicReservation(reservation);
    });
  }
  private mutateReservation<T>(id: string, operation: (state: State, reservation: StoredReservation) => T): T {
    const owner = this.database.query<{ swarm_id: string }, [string]>('SELECT swarm_id FROM reservation_owners WHERE id = ?').get(id);
    requireValue(owner, 'reservation_not_found', 'Reservation does not exist.');
    return this.mutate(owner.swarm_id, state => { const reservation = state.reservations.find(entry => entry.id === id); requireValue(reservation, 'corrupt_state', 'Reservation index is invalid.'); return operation(state, reservation); });
  }
  settle(id: string, actualMicros: number, usage: TokenUsage): void {
    integer(actualMicros); const parsedUsage = usageSchema.safeParse(usage); requireValue(parsedUsage.success, 'invalid_usage', 'Usage must contain nonnegative safe integers.');
    this.mutateReservation(id, (state, reservation) => {
      if (reservation.status === 'settled') {
        requireValue(reservation.actualMicros === actualMicros && JSON.stringify(reservation.usage) === JSON.stringify(parsedUsage.data), 'settlement_conflict', 'Settlement differs from the recorded outcome.'); return;
      }
      requireValue(reservation.status === 'reserved', 'reservation_uncertain', 'An uncertain reservation cannot be settled; its full liability remains retained.');
      requireValue(actualMicros <= reservation.ceilingMicros, 'reservation_overshoot', 'Actual cost exceeds the reserved ceiling; liability is retained.');
      reservation.status = 'settled'; reservation.actualMicros = actualMicros; reservation.usage = parsedUsage.data;
      const agent = actorIn(state, { swarmId: state.id, agentId: reservation.agentId }); agent.costMicros = sumSafe([agent.costMicros, actualMicros]);
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) agent.usage[key] = sumSafe([agent.usage[key], parsedUsage.data[key]]);
      agent.updatedAt = this.now(); this.event(state, agent.id, 'budget_settled', { reservationId: id, actualMicros, usage: parsedUsage.data });
    });
  }
  markUncertain(id: string, reason: string): void {
    const uncertaintyReason = text(reason);
    this.mutateReservation(id, (state, reservation) => {
      requireValue(reservation.status !== 'settled', 'reservation_settled', 'A settled reservation cannot become uncertain.');
      if (reservation.status === 'uncertain') return;
      reservation.status = 'uncertain'; this.event(state, reservation.agentId, 'budget_uncertain', { reservationId: id, reason: uncertaintyReason, liabilityMicros: reservation.ceilingMicros });
    });
  }
  reservations(id: string) { return this.load(id).reservations.map(publicReservation); }
}
