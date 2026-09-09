import type { AgentRecord, AgentStatus, BudgetSnapshot, SwarmRecord, TraceEvent } from './contracts.ts';

export interface SwarmDiagnostics {
  eventCount: number;
  throughSeq: number;
  truncated: boolean;
  metrics: { modelResponses: number; toolCalls: number; toolFailures: number; unpublishedShellCalls: number; outputLimitHits: number };
  budget: { current: BudgetSnapshot; nextRequestCeilingMicros: number | null };
  stops: Array<{
    agentId: string; name: string; status: AgentStatus; origin: 'agent' | 'runtime' | 'unknown';
    code: string | null; reason: string; eventSeq: number | null; at: number | null;
    budget: BudgetSnapshot | null; turn: number | null;
    lastTool: { name: string; seq: number; failed: boolean; exitCode: number | null; summary: string } | null;
    lastBudgetObservationSeq: number | null;
  }>;
  issues: Array<{ seq: number; agentId: string | null; kind: string; summary: string }>;
}

type LastTool = NonNullable<SwarmDiagnostics['stops'][number]['lastTool']>;
type Payload = Record<string, unknown>;
type ToolCall = { agentId: string | null; name: string; events: TraceEvent[] };
const terminalAgents = new Set<AgentStatus>(['done', 'bailed', 'failed', 'cancelled', 'stalled']);
const terminalRuns = new Set(['completed', 'bailed', 'failed', 'cancelled', 'budget_exhausted', 'interrupted']);
const toolKinds = new Set(['tool_execution_start', 'tool_start', 'tool_execution_end', 'tool_result']);
const transportCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'unknown']);
const providerErrorTypes = new Set(['rate_limit_error', 'overloaded_error', 'authentication_error', 'invalid_request_error', 'api_error', 'permission_error', 'not_found_error', 'request_too_large', 'server_error', 'rate_limit_exceeded', 'insufficient_quota', 'context_length_exceeded', 'unknown']);

function object(value: unknown): Payload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}
function parseObject(value: unknown): Payload | null {
  if (typeof value !== 'string') return object(value);
  if (value.length > 100_000) return null;
  try { return object(JSON.parse(value)); } catch { return null; }
}
function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : null;
}
function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }

function snapshot(value: unknown): BudgetSnapshot | null {
  const data = object(value);
  if (!data) return null;
  const capMicros = integer(data.capMicros); const settledMicros = integer(data.settledMicros);
  const reservedMicros = integer(data.reservedMicros); const uncertainMicros = integer(data.uncertainMicros);
  const availableMicros = integer(data.availableMicros);
  if (capMicros === null || settledMicros === null || reservedMicros === null || uncertainMicros === null || availableMicros === null) return null;
  const total = settledMicros + reservedMicros + uncertainMicros + availableMicros;
  return Number.isSafeInteger(total) && total === capMicros ? { capMicros, settledMicros, reservedMicros, uncertainMicros, availableMicros } : null;
}

/** Only extract structured metadata. Never expose stdout, arguments, assistant text, or image bytes. */
function shellResult(payload: Payload): Payload | null {
  const result = parseObject(payload.result);
  if (!result) return null;
  if ('exitCode' in result) return result;
  if (!Array.isArray(result.content)) return null;
  for (const block of result.content) {
    const item = object(block);
    if (item?.type !== 'text') continue;
    const parsed = parseObject(item.text);
    if (parsed && 'exitCode' in parsed) return parsed;
  }
  return null;
}

function toolDetails(call: ToolCall, through: number): LastTool | null {
  const events = call.events.filter(event => event.seq <= through);
  const last = events.at(-1);
  if (!last) return null;
  const structured = events.findLast(event => event.kind === 'tool_result');
  const legacy = events.findLast(event => event.kind === 'tool_execution_end');
  const end = structured ?? legacy;
  const payload = object(end?.payload) ?? {};
  const result = structured ? payload : shellResult(payload);
  const exitCode = typeof result?.exitCode === 'number' && Number.isSafeInteger(result.exitCode) ? result.exitCode : null;
  const failed = events.some(event => object(event.payload)?.isError === true) || (exitCode !== null && exitCode !== 0);
  const count = structured ? integer(payload.publishedFiles) : Array.isArray(result?.versions) ? result.versions.length : null;
  const summary = call.name === 'bash'
    ? !end ? 'Shell call started; no result recorded yet.'
      : `Shell ${exitCode === null ? 'exit status unavailable' : `exit ${exitCode}`}; ${count === null ? 'publication count unavailable' : `${count} files published`}${failed ? '; tool failed' : ''}.`
    : !end ? 'Tool call started; no result recorded yet.' : failed ? 'Tool reported an error.' : 'Tool returned without a recorded error.';
  return { name: call.name, seq: end?.seq ?? last.seq, failed, exitCode, summary };
}

function publishedCount(call: ToolCall): number | null {
  const structured = call.events.findLast(event => event.kind === 'tool_result');
  if (structured) return integer(object(structured.payload)?.publishedFiles);
  const legacy = call.events.findLast(event => event.kind === 'tool_execution_end');
  const result = shellResult(object(legacy?.payload) ?? {});
  return Array.isArray(result?.versions) ? result.versions.length : null;
}

function collectTools(events: readonly TraceEvent[]): ToolCall[] {
  const calls = new Map<string, ToolCall>();
  for (const event of events) {
    if (!toolKinds.has(event.kind)) continue;
    const payload = object(event.payload) ?? {};
    const id = text(payload.toolCallId);
    const key = JSON.stringify([event.agentId, id ?? `event:${event.seq}`]);
    const existing = calls.get(key);
    if (existing) existing.events.push(event);
    else calls.set(key, { agentId: event.agentId, name: identifier(payload.toolName) ?? identifier(payload.name) ?? 'unknown', events: [event] });
  }
  return [...calls.values()];
}

function agentDone(call: ToolCall, agent: AgentRecord, through: number): boolean {
  if (call.name !== 'done' || call.agentId !== agent.id || !['done', 'bailed'].includes(agent.status)) return false;
  const start = call.events.find(event => ['tool_execution_start', 'tool_start'].includes(event.kind) && event.seq < through);
  if (!start || toolDetails(call, through)?.failed) return false;
  const payload = object(start.payload);
  const args = parseObject(payload?.arguments ?? payload?.args);
  return args !== null && args.done_reasoning === agent.reason && (args.bail === true ? 'bailed' : 'done') === agent.status;
}

const legacyRuntimeReasons: Record<string, { code: string; status: AgentStatus }> = {
  'Remaining funds cannot cover another bounded request.': { code: 'budget_exhausted', status: 'bailed' },
  'Swarm reached its execution deadline.': { code: 'deadline', status: 'stalled' },
  'Worker shut down; outstanding request liability remains retained.': { code: 'shutdown', status: 'cancelled' },
  'Session stopped before explicit completion.': { code: 'session_error', status: 'failed' },
  'Maximum model turns reached.': { code: 'turn_limit', status: 'stalled' },
  'Shared verified usage reached the working target. No further model requests will start; existing requests may finish within the separate hard ceiling.': { code: 'working_target_reached', status: 'bailed' },
  'New model requests stopped because a dispatched request has unverified charges. Existing requests may settle; uncertain liability remains retained.': { code: 'request_uncertain', status: 'failed' },
  'Provider response headers exceeded the timeout.': { code: 'request_timeout', status: 'stalled' },
  'Provider response body exceeded the idle timeout.': { code: 'request_timeout', status: 'stalled' },
  'Provider response ended without terminal evidence.': { code: 'response_incomplete', status: 'failed' },
  'Provider response failed before terminal evidence.': { code: 'response_error', status: 'failed' },
  'Provider request failed; its reserved liability was retained.': { code: 'provider_error', status: 'failed' },
};

function legacyRuntimeCode(reason: string, status: AgentStatus): string | null {
  const exact = legacyRuntimeReasons[reason];
  if (exact?.status === status) return exact.code;
  if (status !== 'failed') return null;
  const transport = /^Provider transport failed before an HTTP response \(([A-Z_0-9]+|unknown)\); reserved liability was retained\.$/.exec(reason)?.[1];
  if (transport && transportCodes.has(transport)) return 'provider_transport_error';
  const provider = /^Provider SSE error \(([a-z_]+)\); reserved liability was retained\.$/.exec(reason)?.[1];
  if (provider && providerErrorTypes.has(provider)) return 'provider_sse_error';
  if (/^Provider returned HTTP [1-5][0-9]{2}; reserved liability was retained\.$/.test(reason)) return 'provider_http_error';
  return null;
}

function requestFailureSummary(payload: Payload): string {
  const code = identifier(payload.code); const http = integer(payload.httpStatus); const phase = identifier(payload.phase);
  const parts = [`Request failed${code ? ` (${code})` : ''}`];
  if (http !== null && http >= 100 && http <= 599) parts.push(`HTTP ${http}`);
  if (phase) parts.push(`phase ${phase}`);
  const transport = text(payload.transportCode); const provider = text(payload.providerErrorType);
  if (transport && transportCodes.has(transport)) parts.push(`transport ${transport}`);
  if (provider && providerErrorTypes.has(provider)) parts.push(`provider type ${provider}`);
  const elapsed = integer(payload.elapsedMs); const turn = integer(payload.turn);
  if (elapsed !== null) parts.push(`elapsed ${elapsed} ms`);
  if (turn !== null && turn > 0) parts.push(`turn ${turn}`);
  const reservation = text(payload.reservationId);
  if (reservation && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reservation)) parts.push(`reservation ${reservation}`);
  return `${parts.join('; ')}.`;
}

/** Replay only a complete prefix. An unmatched or malformed ledger event invalidates subsequent snapshots. */
function budgetsAtEvents(run: SwarmRecord, events: readonly TraceEvent[], explicitlyTruncated: boolean): Map<number, BudgetSnapshot> {
  const result = new Map<number, BudgetSnapshot>();
  let valid = !explicitlyTruncated && events[0]?.seq === 1 && events[0]?.kind === 'swarm_created';
  let previous = 0;
  let balance: BudgetSnapshot = { capMicros: run.spec.budgetMicros, settledMicros: 0, reservedMicros: 0, uncertainMicros: 0, availableMicros: run.spec.budgetMicros };
  const reservations = new Map<string, { ceiling: number; status: 'reserved' | 'settled' | 'uncertain' }>();
  for (const event of events) {
    if (event.seq !== previous + 1) valid = false;
    previous = event.seq;
    const payload = object(event.payload) ?? {};
    if (event.kind === 'budget_reserved') {
      const id = text(payload.reservationId); const ceiling = integer(payload.ceilingMicros);
      if (!id || ceiling === null || ceiling === 0 || reservations.has(id)) valid = false;
      else { reservations.set(id, { ceiling, status: 'reserved' }); balance.reservedMicros += ceiling; balance.availableMicros -= ceiling; }
    } else if (event.kind === 'budget_settled' || event.kind === 'budget_uncertain') {
      const id = text(payload.reservationId); const reservation = id ? reservations.get(id) : undefined;
      const amount = integer(event.kind === 'budget_settled' ? payload.actualMicros : payload.liabilityMicros);
      if (!reservation || reservation.status !== 'reserved' || amount === null || amount > reservation.ceiling
        || (event.kind === 'budget_uncertain' && amount !== reservation.ceiling)) valid = false;
      else {
        balance.reservedMicros -= reservation.ceiling;
        if (event.kind === 'budget_settled') {
          reservation.status = 'settled'; balance.settledMicros += amount; balance.availableMicros += reservation.ceiling - amount;
        } else { reservation.status = 'uncertain'; balance.uncertainMicros += amount; }
      }
    }
    const checked = snapshot(balance);
    if (!checked) valid = false;
    else balance = checked;
    if (valid) result.set(event.seq, { ...balance });
  }
  return result;
}

/** Pure historical projection. It neither changes the ledger nor guesses a peer's motivation. */
export function diagnoseSwarm(run: SwarmRecord, input: readonly TraceEvent[], options: { truncated?: boolean } = {}): SwarmDiagnostics {
  const unique = new Map<number, TraceEvent>();
  for (const event of input) if (event.swarmId === run.id && integer(event.seq) !== null && event.seq > 0 && !unique.has(event.seq)) unique.set(event.seq, event);
  const events = [...unique.values()].sort((left, right) => left.seq - right.seq);
  const throughSeq = events.at(-1)?.seq ?? 0;
  const hasGap = events.length === 0 || events.some((event, index) => event.seq !== (events[index - 1]?.seq ?? 0) + 1);
  const truncated = Boolean(options.truncated || hasGap || (terminalRuns.has(run.status) && !events.some(event => event.kind === 'swarm_ended')));
  const balances = budgetsAtEvents(run, events, options.truncated === true);
  const calls = collectTools(events);
  const issues: SwarmDiagnostics['issues'] = [];
  let modelResponses = 0; let outputLimitHits = 0; let nextRequestCeilingMicros: number | null = null;
  for (const event of events) {
    const payload = object(event.payload) ?? {};
    const ceiling = integer(payload.nextRequestCeilingMicros);
    if (event.kind === 'budget_observed' && ceiling !== null && ceiling > 0) nextRequestCeilingMicros = ceiling;
    if (event.kind === 'budget_reserved') {
      const reserved = integer(payload.ceilingMicros);
      if (reserved !== null && reserved > 0) nextRequestCeilingMicros = reserved;
    }
    if (event.kind === 'model_response') {
      modelResponses++;
      if (payload.stopReason === 'length') {
        outputLimitHits++;
        issues.push({ seq: event.seq, agentId: event.agentId, kind: 'output_limit', summary: 'A verified model response reached its output token limit.' });
      }
    }
    if (event.kind === 'request_failed') {
      issues.push({ seq: event.seq, agentId: event.agentId, kind: 'request_failed', summary: requestFailureSummary(payload) });
    }
  }
  let toolFailures = 0; let unpublishedShellCalls = 0;
  for (const call of calls) {
    const details = toolDetails(call, throughSeq);
    if (!details) continue;
    if (details.failed) { toolFailures++; issues.push({ seq: details.seq, agentId: call.agentId, kind: 'tool_failure', summary: `${call.name}: ${details.summary}` }); }
    if (call.name === 'bash' && publishedCount(call) === 0) {
      unpublishedShellCalls++;
      issues.push({ seq: details.seq, agentId: call.agentId, kind: 'shell_no_publication', summary: 'Shell call published no workspace files. This can be intentional for a read-only check.' });
    }
  }
  const stops: SwarmDiagnostics['stops'] = run.agents.filter(agent => terminalAgents.has(agent.status)).map(agent => {
    const own = events.filter(event => event.agentId === agent.id);
    const explicit = own.findLast(event => event.kind === 'agent_stop' && object(event.payload)?.status === agent.status
      && ['agent', 'runtime'].includes(String(object(event.payload)?.origin)));
    const ended = own.findLast(event => event.kind === 'agent_ended' && object(event.payload)?.status === agent.status);
    const event = explicit ?? ended; const payload = object(event?.payload) ?? {};
    const stopSeq = event?.seq ?? null;
    const before = own.filter(item => stopSeq !== null && item.seq <= stopSeq);
    const observed = before.findLast(item => item.kind === 'budget_observed');
    const reason = agent.reason ?? text(payload.reason) ?? 'No stop reason recorded.';
    let origin: 'agent' | 'runtime' | 'unknown' = 'unknown'; let code: string | null = null;
    if (explicit && (payload.origin === 'agent' || payload.origin === 'runtime')) { origin = payload.origin; code = identifier(payload.code); }
    else if (ended && calls.some(call => agentDone(call, agent, ended.seq))) { origin = 'agent'; code = agent.status; }
    else if (ended && balances.has(ended.seq)) {
      const known = legacyRuntimeCode(reason, agent.status);
      if (known !== null && !calls.some(call => call.agentId === agent.id && call.name === 'done' && call.events.some(item => item.seq < ended.seq))) { origin = 'runtime'; code = known; }
    }
    const lastTool = stopSeq === null ? null : calls.filter(call => call.agentId === agent.id).flatMap(call => {
      const details = toolDetails(call, stopSeq); return details ? [details] : [];
    }).sort((left, right) => right.seq - left.seq)[0] ?? null;
    const failedRequest = before.findLast(item => item.kind === 'request_failed');
    const explicitBudget = explicit ? snapshot(payload.budget) : null;
    return {
      agentId: agent.id, name: agent.name, status: agent.status, origin, code, reason,
      eventSeq: stopSeq, at: event?.createdAt ?? agent.endedAt,
      budget: explicitBudget && explicitBudget.capMicros === run.spec.budgetMicros ? explicitBudget : stopSeq === null ? null : balances.get(stopSeq) ?? null,
      turn: explicit ? integer(payload.turn) : integer(object(failedRequest?.payload)?.turn), lastTool, lastBudgetObservationSeq: observed?.seq ?? null,
    };
  });
  if (truncated) issues.push({ seq: throughSeq, agentId: null, kind: 'trace_incomplete', summary: 'Trace context is incomplete. Counts cover only supplied events; missing stop context remains unknown.' });
  return {
    eventCount: events.length, throughSeq, truncated,
    metrics: { modelResponses, toolCalls: calls.length, toolFailures, unpublishedShellCalls, outputLimitHits },
    budget: { current: { ...run.budget }, nextRequestCeilingMicros }, stops,
    issues: issues.sort((left, right) => left.seq - right.seq).slice(-100),
  };
}
