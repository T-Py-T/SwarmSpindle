import { afterEach, describe, expect, test } from 'bun:test';
import { diagnoseSwarm, openSwarmStore, parseSwarmSpec, type Actor, type Json, type SwarmStore } from '../modules/swarm/index.ts';

const stores: SwarmStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

function fixture() {
  let now = 1000;
  const store = openSwarmStore(':memory:', { clock: () => now++ }); stores.push(store);
  const run = store.createSwarm(parseSwarmSpec({ task: 'Synthetic diagnostics evidence; no provider calls.', definitionOfDone: 'Inspect recorded failure context.', finalOutput: 'report.md',
    agentCount: 2, budgetMicros: 10_000_000, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' } }));
  store.registerWorker('diagnostics-worker', 123); store.claimNextSwarm('diagnostics-worker');
  const actors = run.agents.map(agent => ({ swarmId: run.id, agentId: agent.id }));
  const first = actors[0]; const second = actors[1];
  if (!first || !second) throw new Error('Expected two fixture peers.');
  for (const actor of actors) store.startAgent(actor, `fixture-${actor.agentId}`);
  const event = (actor: Actor | null, kind: string, payload: Json) => store.appendEvent(run.id, actor?.agentId ?? null, kind, payload);
  function legacyShell(actor: Actor, id: string, exitCode: number, published = 0) {
    event(actor, 'tool_execution_start', { toolName: 'bash', toolCallId: id, arguments: JSON.stringify({ command: 'Never expose this raw command.' }) });
    return event(actor, 'tool_execution_end', { toolName: 'bash', toolCallId: id, isError: false,
      result: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ exitCode, stdout: 'Do not expose raw stdout.', stderr: 'Private shell error text.',
        versions: Array.from({ length: published }, (_, index) => ({ path: `file-${index}.txt`, revision: 1 })) }) }] }) });
  }
  function finish() { store.finishSwarm(run.id, 'bailed', 'Synthetic terminal run.'); }
  function diagnose() { return diagnoseSwarm(store.getSwarm(run.id), store.events(run.id)); }
  return { store, run, first, second, event, legacyShell, finish, diagnose };
}

describe('pure swarm diagnostics', () => {
  test('detects historical nonzero bash results even when the SDK reports isError false', () => {
    const f = fixture(); const failed = f.legacyShell(f.first, 'canvas-render', 1);
    f.legacyShell(f.second, 'read-only-probe', 0);
    f.store.endAgent(f.first, 'bailed', 'Remaining funds cannot cover another bounded request.'); f.finish();
    const result = f.diagnose();
    expect(result.metrics).toEqual({ modelResponses: 0, toolCalls: 2, toolFailures: 1, unpublishedShellCalls: 2, outputLimitHits: 0 });
    expect(result.stops[0]).toMatchObject({ origin: 'runtime', code: 'budget_exhausted', reason: 'Remaining funds cannot cover another bounded request.',
      lastTool: { name: 'bash', seq: failed.seq, failed: true, exitCode: 1 } });
    expect(result.issues.find(issue => issue.kind === 'tool_failure')?.summary).toContain('exit 1');
    expect(result.issues.find(issue => issue.kind === 'shell_no_publication')?.summary).toContain('intentional');
    expect(JSON.stringify(result)).not.toContain('Private shell error text.');
    expect(JSON.stringify(result)).not.toContain('Never expose this raw command.');
  });

  test('deduplicates new structured shell results and legacy lifecycle events for the same call', () => {
    const f = fixture();
    f.event(f.first, 'tool_execution_start', { toolName: 'bash', toolCallId: 'one' });
    const structured = f.event(f.first, 'tool_result', { toolName: 'bash', toolCallId: 'one', exitCode: 2, durationMs: 90, publishedFiles: 0 });
    f.event(f.first, 'tool_execution_end', { toolName: 'bash', toolCallId: 'one', isError: false, result: '{truncated' });
    f.legacyShell(f.second, 'one', 0, 1); // IDs are scoped to peers.
    f.store.endAgent(f.first, 'failed', 'Recorded failure.'); f.finish();
    const result = f.diagnose();
    expect(result.metrics).toMatchObject({ toolCalls: 2, toolFailures: 1, unpublishedShellCalls: 1 });
    expect(result.issues.filter(issue => issue.kind === 'tool_failure')).toHaveLength(1);
    expect(result.stops[0]?.lastTool).toMatchObject({ seq: structured.seq, exitCode: 2, failed: true });
  });

  test('distinguishes explicit agent bail from an identical runtime-looking reason', () => {
    const f = fixture(); const reason = 'Remaining funds cannot cover another bounded request.';
    f.event(f.first, 'tool_execution_start', { toolName: 'done', toolCallId: 'done-1', arguments: JSON.stringify({ done_reasoning: reason, bail: true }) });
    f.store.endAgent(f.first, 'bailed', reason);
    f.event(f.first, 'tool_execution_end', { toolName: 'done', toolCallId: 'done-1', isError: false, result: JSON.stringify({ content: [{ type: 'text', text: '{"status":"bailed"}' }] }) });
    f.store.endAgent(f.second, 'bailed', reason); f.finish();
    const result = f.diagnose();
    expect(result.stops[0]).toMatchObject({ origin: 'agent', code: 'bailed', reason });
    expect(result.stops[1]).toMatchObject({ origin: 'runtime', code: 'budget_exhausted', reason });
  });

  test('does not infer intent from assistant content, an unsuccessful done call, or an arbitrary reason', () => {
    const f = fixture(); const reason = 'The worker decided to stop.';
    f.event(f.first, 'assistant_message', { content: 'I am done. PRIVATE THINKING', stopReason: 'length' });
    f.event(f.first, 'tool_execution_start', { toolName: 'done', toolCallId: 'rejected', arguments: JSON.stringify({ done_reasoning: reason, bail: true }) });
    f.event(f.first, 'tool_execution_end', { toolName: 'done', toolCallId: 'rejected', isError: true, result: '{"content":[]}' });
    f.store.endAgent(f.first, 'bailed', reason); f.finish();
    const result = f.diagnose();
    expect(result.stops[0]).toMatchObject({ origin: 'unknown', code: null, reason });
    expect(result.metrics.outputLimitHits).toBe(0);
    expect(JSON.stringify(result)).not.toContain('PRIVATE THINKING');
  });

  test('replays the exact stop balance before another peer settles, retaining uncertain liability', () => {
    const f = fixture();
    const first = f.store.reserve(f.first, 4_000_000, 'Synthetic ceiling');
    const second = f.store.reserve(f.second, 3_000_000, 'Synthetic ceiling');
    const observed = f.event(f.first, 'budget_observed', { ...f.store.budget(f.run.id), nextRequestCeilingMicros: 5_102_400 });
    f.store.settle(first.id, 100_000, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
    const uncertain = f.store.reserve(f.first, 2_000_000, 'Synthetic uncertain ceiling');
    f.store.markUncertain(uncertain.id, 'Retained synthetic liability');
    f.store.endAgent(f.first, 'bailed', 'Stop with retained liability.');
    f.store.settle(second.id, 200_000, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }); f.finish();
    const result = f.diagnose();
    expect(result.stops[0]).toMatchObject({ lastBudgetObservationSeq: observed.seq, budget: { capMicros: 10_000_000, settledMicros: 100_000,
      reservedMicros: 3_000_000, uncertainMicros: 2_000_000, availableMicros: 4_900_000 } });
    expect(result.budget.current).toEqual({ capMicros: 10_000_000, settledMicros: 300_000, reservedMicros: 0, uncertainMicros: 2_000_000, availableMicros: 7_700_000 });
    expect(result.budget.nextRequestCeilingMicros).toBe(2_000_000);
  });

  test('uses explicit stop metadata even with missing history and preserves the actual agent reason', () => {
    const f = fixture(); const reason = 'Shared target reached with useful evidence retained.';
    const budget = f.store.budget(f.run.id);
    const explicit = f.event(f.first, 'agent_stop', { origin: 'runtime', code: 'working_target_reached', reason, status: 'bailed', turn: 7, budget: { ...budget } });
    f.store.endAgent(f.first, 'bailed', reason); f.finish();
    const result = diagnoseSwarm(f.store.getSwarm(f.run.id), f.store.events(f.run.id).filter(event => event.seq >= explicit.seq), { truncated: true });
    expect(result.truncated).toBe(true);
    expect(result.stops[0]).toMatchObject({ origin: 'runtime', code: 'working_target_reached', reason, turn: 7, eventSeq: explicit.seq, at: explicit.createdAt, budget });
    expect(result.stops[1]).toMatchObject({ origin: 'unknown', budget: null });
  });

  test('keeps explicit agent completion separate and excludes observations and tools recorded after the stop', () => {
    const f = fixture(); const reason = 'I inspected the retained artifact and completed my review.';
    const observed = f.event(f.first, 'budget_observed', { ...f.store.budget(f.run.id) });
    f.legacyShell(f.first, 'review', 0, 1);
    const stop = f.event(f.first, 'agent_stop', { origin: 'agent', code: 'done', reason, status: 'done', turn: 4, budget: { ...f.store.budget(f.run.id) } });
    f.store.endAgent(f.first, 'done', reason);
    f.event(f.first, 'budget_observed', { ...f.store.budget(f.run.id) });
    f.event(f.first, 'tool_result', { toolName: 'bash', toolCallId: 'after-stop', exitCode: 1, publishedFiles: 0 }); f.finish();
    expect(f.diagnose().stops[0]).toMatchObject({ origin: 'agent', code: 'done', reason, eventSeq: stop.seq, turn: 4,
      lastBudgetObservationSeq: observed.seq, lastTool: { name: 'bash', failed: false, exitCode: 0 } });
  });

  test('does not replace an explicit unknown stop turn with an earlier failed request turn', () => {
    const f = fixture();
    f.event(f.first, 'request_failed', { code: 'provider_error', turn: 3 });
    f.event(f.first, 'agent_stop', { origin: 'runtime', code: 'runtime_setup_failed', status: 'failed', reason: 'No known attempted turn.', turn: null, budget: { ...f.store.budget(f.run.id) } });
    f.store.endAgent(f.first, 'failed', 'No known attempted turn.'); f.finish();
    expect(f.diagnose().stops[0]?.turn).toBeNull();
  });

  test('marks an unreadable historical shell result as unavailable without inventing success or failure', () => {
    const f = fixture();
    f.event(f.first, 'tool_execution_start', { toolName: 'bash', toolCallId: 'truncated-shell' });
    f.event(f.first, 'tool_execution_end', { toolName: 'bash', toolCallId: 'truncated-shell', isError: false, result: '{"content":[' });
    f.store.endAgent(f.first, 'failed', 'Incomplete evidence.'); f.finish();
    const result = f.diagnose();
    expect(result.metrics).toMatchObject({ toolCalls: 1, toolFailures: 0, unpublishedShellCalls: 0 });
    expect(result.stops[0]?.lastTool).toMatchObject({ exitCode: null });
    expect(result.stops[0]?.lastTool?.summary).toContain('exit status unavailable');
  });

  test('keeps missing and truncated ledger context unknown instead of using the last budget observation', () => {
    const f = fixture();
    const reservation = f.store.reserve(f.first, 500_000, 'Synthetic reservation');
    f.event(f.first, 'budget_observed', { ...f.store.budget(f.run.id), nextRequestCeilingMicros: 5_102_400 });
    f.store.settle(reservation.id, 10_000, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
    f.store.endAgent(f.first, 'bailed', 'Remaining funds cannot cover another bounded request.'); f.finish();
    const run = f.store.getSwarm(f.run.id); const events = f.store.events(f.run.id);
    for (const result of [diagnoseSwarm(run, events.slice(1)), diagnoseSwarm(run, events, { truncated: true }), diagnoseSwarm(run, events.filter(event => event.kind !== 'budget_reserved'))]) {
      expect(result.truncated).toBe(true);
      expect(result.stops[0]).toMatchObject({ origin: 'unknown', budget: null });
      expect(result.issues.some(issue => issue.kind === 'trace_incomplete')).toBe(true);
    }
    const empty = diagnoseSwarm(run, []);
    expect(empty.stops[0]).toMatchObject({ origin: 'unknown', eventSeq: null, budget: null, lastTool: null, lastBudgetObservationSeq: null });
    expect(empty.budget.nextRequestCeilingMicros).toBeNull();
  });

  test('fails closed on malformed ledger amounts and malformed explicit snapshots', () => {
    const f = fixture();
    f.event(f.first, 'budget_settled', { reservationId: 'missing', actualMicros: 1 });
    f.event(f.first, 'agent_stop', { origin: 'runtime', code: 'provider_error', reason: 'Actual reason.', status: 'failed', budget: {
      capMicros: 10_000_000, settledMicros: 0, reservedMicros: -1, uncertainMicros: 0, availableMicros: 10_000_001,
    } });
    f.store.endAgent(f.first, 'failed', 'Actual reason.'); f.finish();
    expect(f.diagnose().stops[0]).toMatchObject({ origin: 'runtime', code: 'provider_error', reason: 'Actual reason.', budget: null });
  });

  test('reports safe request failure details and counts only verified output-limit responses', () => {
    const f = fixture();
    f.event(f.first, 'model_response', { turn: 1, stopReason: 'length' });
    f.event(f.first, 'assistant_message', { content: 'PRIVATE THINKING AND BASE64', stopReason: 'length' });
    f.event(f.first, 'model_response', { turn: 2, stopReason: 'toolUse' });
    const request = f.event(f.first, 'request_failed', { code: 'provider_error', phase: 'response_headers', httpStatus: 429, turn: 3,
      body: 'PRIVATE PROVIDER BODY', transportCode: 'PRIVATE_UNUSED_VALUE' });
    f.store.endAgent(f.first, 'failed', 'Provider request failed.'); f.finish();
    const result = f.diagnose();
    expect(result.metrics).toMatchObject({ modelResponses: 2, outputLimitHits: 1 });
    expect(result.stops[0]?.turn).toBe(3);
    expect(result.issues.find(issue => issue.seq === request.seq)?.summary).toBe('Request failed (provider_error); HTTP 429; phase response_headers; turn 3.');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  test('recognizes exact historical runtime transport and uncertainty stops without guessing a failed turn', () => {
    const f = fixture();
    f.event(f.first, 'model_response', { turn: 4, stopReason: 'toolUse' });
    f.store.endAgent(f.first, 'failed', 'Provider transport failed before an HTTP response (ECONNRESET); reserved liability was retained.');
    f.store.endAgent(f.second, 'failed', 'New model requests stopped because a dispatched request has unverified charges. Existing requests may settle; uncertain liability remains retained.'); f.finish();
    const result = f.diagnose();
    expect(result.stops[0]).toMatchObject({ origin: 'runtime', code: 'provider_transport_error', turn: null });
    expect(result.stops[1]).toMatchObject({ origin: 'runtime', code: 'request_uncertain', turn: null });
  });

  test('limits historical runtime pattern matches to known sanitized categories and matching statuses', () => {
    const f = fixture();
    f.store.endAgent(f.first, 'failed', 'Provider transport failed before an HTTP response (made_up); reserved liability was retained.');
    f.store.endAgent(f.second, 'bailed', 'Provider returned HTTP 429; reserved liability was retained.'); f.finish();
    expect(f.diagnose().stops.every(stop => stop.origin === 'unknown' && stop.code === null)).toBe(true);
  });

  test('includes bounded transport, provider, elapsed time, turn and reservation metadata', () => {
    const f = fixture();
    const reservationId = '12345678-1234-1234-1234-123456789abc';
    const event = f.event(f.first, 'request_failed', { code: 'provider_transport_error', phase: 'fetch_before_response', transportCode: 'ECONNRESET',
      providerErrorType: 'overloaded_error', elapsedMs: 1201, turn: 5, reservationId, body: 'SECRET_BODY', headers: 'SECRET_HEADERS' });
    const summary = f.diagnose().issues.find(issue => issue.seq === event.seq)?.summary;
    expect(summary).toContain('transport ECONNRESET'); expect(summary).toContain('provider type overloaded_error');
    expect(summary).toContain('elapsed 1201 ms'); expect(summary).toContain('turn 5'); expect(summary).toContain(`reservation ${reservationId}`);
    expect(summary).not.toContain('SECRET');
  });

  test('returns only the latest 100 issues in event order without mutating inputs or history', () => {
    const f = fixture();
    for (let index = 0; index < 110; index++) f.event(f.first, 'model_response', { turn: index + 1, stopReason: 'length' });
    f.finish();
    const run = f.store.getSwarm(f.run.id); const events = f.store.events(f.run.id);
    const before = JSON.stringify({ run, events, reservations: f.store.reservations(f.run.id) });
    const frozen = Object.freeze([...events].reverse());
    const result = diagnoseSwarm(run, frozen);
    expect(result.issues).toHaveLength(100);
    expect(result.metrics.outputLimitHits).toBe(110);
    expect(result.issues.every((issue, index) => index === 0 || issue.seq > (result.issues[index - 1]?.seq ?? 0))).toBe(true);
    result.budget.current.availableMicros = 0;
    expect(JSON.stringify({ run, events, reservations: f.store.reservations(f.run.id) })).toBe(before);
    expect(f.store.events(f.run.id)).toEqual(events);
  });

  test('ignores foreign-run events, deduplicates repeated pages, and omits active peers from stops', () => {
    const f = fixture(); const events = f.store.events(f.run.id);
    const source = events[0]; if (!source) throw new Error('Expected a creation event.');
    const result = diagnoseSwarm(f.store.getSwarm(f.run.id), [...events, ...events, { ...source, swarmId: 'other-run', seq: 900, kind: 'model_response', payload: { stopReason: 'length' } }]);
    expect(result.eventCount).toBe(events.length); expect(result.throughSeq).toBe(events.at(-1)?.seq ?? 0);
    expect(result.stops).toEqual([]); expect(result.truncated).toBe(false); expect(result.metrics.modelResponses).toBe(0);
  });
});
