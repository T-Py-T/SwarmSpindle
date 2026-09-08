export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Thinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type RunStatus = 'queued' | 'running' | 'stopping' | 'completed' | 'bailed' | 'failed' | 'cancelled' | 'budget_exhausted' | 'interrupted';
export type AgentStatus = 'ready' | 'running' | 'waiting' | 'done' | 'bailed' | 'failed' | 'cancelled' | 'stalled';
export interface ModelBinding { provider: 'anthropic' | 'openai-codex'; id: string; thinking: Thinking }
export interface SwarmSpec {
  title: string;
  task: string;
  definitionOfDone: string;
  finalOutput: string;
  agentCount: number;
  model: ModelBinding;
  budgetMicros: number;
  workingTargetMicros?: number;
  maxOutputTokens: number;
  maxTurnsPerAgent: number;
  maxRunMs: number;
  idleTimeoutMs: number;
}
export interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface AgentRecord {
  id: string; name: string; status: AgentStatus; sessionId: string | null;
  startedAt: number | null; updatedAt: number; endedAt: number | null;
  reason: string | null; output: string | null; costMicros: number;
  usage: TokenUsage; toolCalls: number;
}
export interface BudgetSnapshot {
  capMicros: number; settledMicros: number; reservedMicros: number;
  uncertainMicros: number; availableMicros: number;
}
export interface SwarmRecord {
  id: string; spec: SwarmSpec; status: RunStatus; createdAt: number;
  startedAt: number | null; endedAt: number | null; reason: string | null;
  workerId: string | null; agents: AgentRecord[]; budget: BudgetSnapshot;
}
export interface ThreadRecord { id: string; swarmId: string; title: string; createdAt: number; updatedAt: number; members: string[]; messageCount: number }
export interface BoardMessage { id: number; swarmId: string; threadId: string; authorId: string; body: string; createdAt: number }
/** Search cursors are global; BoardMessage.id remains local to its swarm. */
export interface MessageSearchHit extends BoardMessage { searchId: number; swarmTitle: string; threadTitle: string; authorName: string }
export interface MessageSearchOptions { query: string; swarmId?: string; authorId?: string; after?: number; limit?: number; through?: number }
export interface MessageSearchPage { messages: MessageSearchHit[]; next: number | null; through: number }
export interface MessageContext { thread: ThreadRecord; messages: BoardMessage[]; targetId: number }
export interface TraceEvent { seq: number; swarmId: string; agentId: string | null; kind: string; createdAt: number; payload: Json }
export interface Actor { swarmId: string; agentId: string }
export interface FileClaim { path: string; ownerId: string; reason: string; expiresAt: number }
export interface FileVersion { path: string; revision: number; authorId: string; createdAt: number; reason: string; deleted: boolean; size: number }
export interface WorkspaceFile extends FileVersion { contentBase64: string }
export interface FileChange { path: string; baseRevision: number; contentBase64: string | null }
export interface Reservation { id: string; swarmId: string; agentId: string; ceilingMicros: number; status: 'reserved' | 'settled' | 'uncertain'; actualMicros: number | null; createdAt: number; pricingEvidence: string }
export interface WorkerRecord { id: string; pid: number; startedAt: number; heartbeatAt: number; status: 'online' | 'offline' }

/** Single owner of swarm state. All mutation methods are transactional. */
export interface SwarmStore {
  close(): void;
  createSwarm(spec: SwarmSpec, initialFiles?: FileChange[]): SwarmRecord;
  listSwarms(): SwarmRecord[];
  getSwarm(swarmId: string): SwarmRecord;
  claimNextSwarm(workerId: string): SwarmRecord | null;
  stopSwarm(swarmId: string, reason: string): SwarmRecord;
  finishSwarm(swarmId: string, status: Exclude<RunStatus, 'queued' | 'running' | 'stopping'>, reason: string): SwarmRecord;
  registerWorker(workerId: string, pid: number): WorkerRecord;
  heartbeatWorker(workerId: string): void;
  listWorkers(): WorkerRecord[];
  offlineWorker(workerId: string): void;
  startAgent(actor: Actor, sessionId: string): void;
  renameAgent(actor: Actor, name: string): AgentRecord;
  setAgentStatus(actor: Actor, status: 'running' | 'waiting'): void;
  endAgent(actor: Actor, status: 'done' | 'bailed' | 'failed' | 'cancelled' | 'stalled', reason: string, output?: string): void;
  appendEvent(swarmId: string, agentId: string | null, kind: string, payload: Json): TraceEvent;
  events(swarmId: string, after?: number, limit?: number): TraceEvent[];
  createThread(actor: Actor, title: string): ThreadRecord;
  joinThread(actor: Actor, threadId: string): ThreadRecord;
  threads(swarmId: string): ThreadRecord[];
  post(actor: Actor, threadId: string, body: string): BoardMessage;
  postOperator(swarmId: string, threadId: string, body: string): BoardMessage;
  messages(swarmId: string, threadId: string, after?: number): BoardMessage[];
  /** Literal full-body substring search. ASCII case folding; Unicode is otherwise case-sensitive. Pages cap body bytes at 1 MiB, allowing at least one message. */
  searchMessages(options: MessageSearchOptions): MessageSearchPage;
  messageContext(swarmId: string, messageId: number): MessageContext;
  inbox(actor: Actor): BoardMessage[];
  claims(swarmId: string): FileClaim[];
  claimFiles(actor: Actor, paths: string[], reason: string, ttlMs?: number): FileClaim[];
  releaseFiles(actor: Actor, paths: string[]): void;
  files(swarmId: string): WorkspaceFile[];
  readFile(swarmId: string, path: string): WorkspaceFile;
  publishFiles(actor: Actor, changes: FileChange[], reason: string): FileVersion[];
  seedFiles(swarmId: string, changes: FileChange[]): void;
  fileHistory(swarmId: string, path: string): FileVersion[];
  fileAtRevision(swarmId: string, path: string, revision: number): WorkspaceFile;
  restoreFile(actor: Actor, path: string, revision: number, reason: string): FileVersion;
  budget(swarmId: string): BudgetSnapshot;
  reserve(actor: Actor, ceilingMicros: number, pricingEvidence: string): Reservation;
  settle(reservationId: string, actualMicros: number, usage: TokenUsage): void;
  markUncertain(reservationId: string, reason: string): void;
  reservations(swarmId: string): Reservation[];
}

export class SwarmError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'SwarmError'; }
}

/** Canonical paths are relative POSIX file paths, never directories or host paths. */
export function normalizeWorkspacePath(path: string): string {
  if (path.length === 0 || path.length > 512 || path.startsWith('/') || path.includes('\\') || /[\x00-\x1f]/.test(path)) {
    throw new SwarmError('invalid_path', 'Use a relative workspace file path.');
  }
  const parts = path.split('/');
  if (parts.some(part => part === '..' || part === '' || part === '.')) {
    throw new SwarmError('invalid_path', 'Paths must not contain dot segments or empty components.');
  }
  if (parts[0] === '.git' || parts[0] === '.swarm') throw new SwarmError('invalid_path', 'Reserved workspace path.');
  return path;
}
