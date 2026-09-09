import { describe, expect, test } from 'bun:test';
import type { BudgetSnapshot, SwarmDiagnostics } from '@simpleswarm/swarm';
import { renderDiagnostics } from '../apps/web/diagnostics.ts';

function budget(settledMicros: number): BudgetSnapshot {
  return { capMicros: 50_000_000, settledMicros, reservedMicros: 5_000_000, uncertainMicros: 16_260_000, availableMicros: 28_740_000 - settledMicros };
}

function stop(origin: 'agent' | 'runtime' | 'unknown'): SwarmDiagnostics['stops'][number] {
  return { agentId: `peer-${origin}`, name: `${origin} peer`, status: 'bailed', origin, code: null,
    reason: 'A recorded explanation.', eventSeq: 18, at: 2000, budget: budget(100_000), turn: 3,
    lastBudgetObservationSeq: 15, lastTool: { name: 'shell', seq: 17, failed: false, exitCode: 0, summary: 'Command exited 0; changes were not published.' } };
}

function diagnostics(): SwarmDiagnostics {
  return { eventCount: 22, throughSeq: 26, truncated: false,
    metrics: { modelResponses: 3, toolCalls: 7, toolFailures: 2, unpublishedShellCalls: 1, outputLimitHits: 1 },
    budget: { current: budget(500_000), nextRequestCeilingMicros: 16_260_000 }, stops: [], issues: [] };
}

describe('run diagnostics presentation', () => {
  test('distinguishes recorded agent decisions from runtime enforcement and unknown origins', () => {
    const result = diagnostics();
    result.stops = [stop('agent'), { ...stop('runtime'), code: 'working_target_reached', reason: 'Working target reached before dispatch.' }, stop('unknown')];
    const html = renderDiagnostics(result);
    expect(html).toContain('Agent decision');
    expect(html).toContain('Runtime stop');
    expect(html).toContain('Origin not recorded');
    expect(html).toContain('working_target_reached');
    expect(html).toContain('Working target reached before dispatch.');
    expect(html).toContain('event #18');
    expect(html).toContain('Last recorded budget observation #15');
    expect(html).toContain('Recorded turn 3');
    expect(html).toContain('event #17');
    expect(html).toContain('exit 0');
    expect(html).toContain('1970-01-01T00:00:02.000Z');
  });

  test('renders the historical stop budget separately from current balances', () => {
    const result = diagnostics(); result.stops = [stop('runtime')];
    const html = renderDiagnostics(result);
    const historicalSection = html.split('aria-label="Budget at stop"')[1]!.split('</section>')[0]!;
    expect(historicalSection).toContain('$0.100000');
    expect(historicalSection).not.toContain('$0.500000');
    expect(html).toContain('$0.500000');
    expect(html).toContain('Next request ceiling: $16.260000');
    expect(html).toContain('Reserved and unresolved amounts are held liabilities, not verified spending');
  });

  test('missing stop snapshots and model ceiling remain explicitly unavailable', () => {
    const result = diagnostics();
    result.budget.nextRequestCeilingMicros = null;
    result.stops = [{ ...stop('unknown'), budget: null, lastTool: null, lastBudgetObservationSeq: null, turn: null, at: null }];
    const html = renderDiagnostics(result);
    expect(html).toContain('No budget snapshot was recorded at this stop');
    expect(html).toContain('Current balances are not a substitute');
    expect(html).toContain('Next request ceiling: not available');
    expect(html).toContain('Last recorded budget observation not available');
    expect(html).toContain('No preceding tool result is recorded');
    expect(html).not.toContain('Recorded turn null');
  });

  test('a run with no terminal peers says no stop is recorded without inventing success', () => {
    const html = renderDiagnostics(diagnostics());
    expect(html).toContain('No recorded stop.');
    expect(html).not.toContain('Runtime stop');
    expect(html).not.toContain('Agent decision');
    expect(html).toContain('This does not establish that the output passed review');
    expect(html).toContain('Model responses');
    expect(html).toContain('Unpublished shell calls');
    expect(html).toContain('Output limit hits');
  });

  test('legacy stored reasons without events are not presented as proven stop origins', () => {
    const result = diagnostics(); result.stops = [{ ...stop('unknown'), eventSeq: null, budget: null, reason: 'Legacy peer reason.' }];
    const html = renderDiagnostics(result);
    expect(html).toContain('<strong>No recorded stop</strong>');
    expect(html).toContain('Legacy peer reason.');
    expect(html).toContain('no stop event is available to establish its origin or timing');
    expect(html).not.toContain('event #null');
  });

  test('escapes every peer/tool/issue string and does not mutate the projection', () => {
    const hostile = '<script>alert("x")</script> & \'bad\'';
    const result = diagnostics();
    result.stops = [{ ...stop('runtime'), agentId: hostile, name: hostile, reason: hostile, code: hostile,
      lastTool: { name: hostile, seq: 17, failed: true, exitCode: 2, summary: hostile } }];
    result.issues = [{ seq: 20, agentId: hostile, kind: hostile, summary: hostile }];
    const before = structuredClone(result);
    const html = renderDiagnostics(result);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain(hostile);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;bad&#39;');
    expect(html).toContain('exit 2');
    expect(result).toEqual(before);
  });

  test('partial history and system issues retain their evidence boundaries', () => {
    const result = diagnostics(); result.truncated = true;
    result.issues = [{ seq: 26, agentId: null, kind: 'unresolved_usage', summary: 'Final usage was not verified after the connection closed.' }];
    const html = renderDiagnostics(result);
    expect(html).toContain('22 recorded events examined · through event #26');
    expect(html).toContain('Partial history: some evidence may be missing');
    expect(html).toContain('unresolved usage');
    expect(html).toContain('event #26 · system');
    expect(html).toContain('Final usage was not verified after the connection closed.');
  });
});
