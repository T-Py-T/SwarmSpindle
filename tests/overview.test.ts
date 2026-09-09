import { describe, expect, test } from 'bun:test';
import { parseSwarmSpec, type AgentStatus, type RunStatus, type SwarmRecord } from '@simpleswarm/swarm';
import { describeArtifactReview, describeRun, summarizeRuns, type OutcomeFilter } from '../apps/web/overview-model.ts';
import { renderArtifactReview, renderRunCard } from '../apps/web/overview.ts';

function run(status: RunStatus, options: {
  settledMicros?: number; reservedMicros?: number; uncertainMicros?: number;
  workingTargetMicros?: number; agentStatuses?: AgentStatus[];
} = {}): SwarmRecord {
  const agentStatuses = options.agentStatuses ?? ['ready', 'running'];
  const spec = parseSwarmSpec({
    title: `Overview ${status}`, task: 'Create a reviewed artifact.',
    definitionOfDone: 'The artifact satisfies its independently checked criteria.', finalOutput: 'result.svg',
    agentCount: agentStatuses.length, budgetMicros: 6_000_000,
    model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' },
    ...(options.workingTargetMicros === undefined ? {} : { workingTargetMicros: options.workingTargetMicros }),
  });
  const settledMicros = options.settledMicros ?? 0;
  const reservedMicros = options.reservedMicros ?? 0;
  const uncertainMicros = options.uncertainMicros ?? 0;
  return {
    id: `overview-${status}`, spec, status, createdAt: 1000, startedAt: null, endedAt: null,
    reason: null, workerId: null,
    budget: { capMicros: spec.budgetMicros, settledMicros, reservedMicros, uncertainMicros,
      availableMicros: spec.budgetMicros - settledMicros - reservedMicros - uncertainMicros },
    agents: agentStatuses.map((agentStatus, index) => ({
      id: `agent-${index}`, name: `Peer ${index}`, status: agentStatus, sessionId: null,
      startedAt: null, updatedAt: 1000, endedAt: null, reason: null, output: null, costMicros: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, toolCalls: 0,
    })),
  };
}

const groups: Record<RunStatus, Exclude<OutcomeFilter, 'all'>> = {
  queued: 'active', running: 'active', stopping: 'active', completed: 'review',
  bailed: 'incomplete', failed: 'incomplete', cancelled: 'incomplete',
  budget_exhausted: 'incomplete', interrupted: 'incomplete',
};
const statuses: RunStatus[] = ['queued', 'running', 'stopping', 'completed', 'bailed', 'failed', 'cancelled', 'budget_exhausted', 'interrupted'];

describe('overview outcome presentation', () => {
  for (const status of statuses) {
    test(`${status} keeps its canonical outcome below, at and above the working target`, () => {
      const baseline = describeRun(run(status));
      expect(baseline.group).toBe(groups[status]);
      expect(baseline.label.length).toBeGreaterThan(0);
      expect(baseline.explanation.length).toBeGreaterThan(0);
      expect(baseline.targetReached).toBe(false);
      for (const settledMicros of [249_999, 250_000, 250_001]) {
        const actual = describeRun(run(status, { settledMicros, workingTargetMicros: 250_000 }));
        expect(actual).toEqual({ ...baseline, targetReached: settledMicros >= 250_000 });
      }
    });
  }

  test('completion remains an unverified claim even when peers and stored prose claim success', () => {
    const completed = run('completed', { agentStatuses: ['done', 'done'], settledMicros: 500_000, workingTargetMicros: 250_000 });
    completed.reason = 'Everything is independently verified and approved.';
    expect(describeRun(completed)).toMatchObject({
      label: 'Completion claimed · review required', group: 'review', targetReached: true,
    });
    expect(describeRun(completed).explanation).toContain('Independent acceptance');
    expect(describeRun(completed).explanation).not.toContain(completed.reason);
  });

  test('hard request exhaustion explains a positive balance without claiming every dollar was spent', () => {
    const exhausted = run('budget_exhausted', { settledMicros: 1_000_000 });
    expect(exhausted.budget.availableMicros).toBe(5_000_000);
    expect(describeRun(exhausted)).toMatchObject({ group: 'incomplete', targetReached: false });
    expect(describeRun(exhausted).explanation).toContain('positive balance may remain');
    expect(describeRun(exhausted).explanation).toContain('another bounded request');
  });

  test('reservations and uncertain charges do not satisfy a working target', () => {
    const held = run('running', { workingTargetMicros: 250_000, settledMicros: 249_999, reservedMicros: 2_000_000, uncertainMicros: 1_000_000 });
    expect(describeRun(held)).toMatchObject({ group: 'active', targetReached: false });
    expect(describeRun(run('failed', { settledMicros: 5_000_000 })).targetReached).toBe(false);
  });

  test('mixed peer states and stored reason text cannot reclassify the run or invent its stop cause', () => {
    const mixed = run('running', { agentStatuses: ['done', 'failed', 'waiting', 'bailed', 'running', 'ready', 'stalled', 'cancelled'] });
    mixed.reason = 'Completed successfully; working target reached.';
    expect(describeRun(mixed)).toEqual(describeRun(run('running')));
    expect(summarizeRuns([mixed])).toMatchObject({ total: 1, active: 1, review: 0, incomplete: 0 });
    const bailed = run('bailed', { settledMicros: 250_000, workingTargetMicros: 250_000 });
    expect(describeRun(bailed).explanation).not.toMatch(/working target/i);
  });
});

describe('overview ledger totals', () => {
  test('empty totals contain zero counts and distinct zero balances', () => {
    expect(summarizeRuns([])).toEqual({ total: 0, active: 0, review: 0, incomplete: 0, settledMicros: 0, reservedMicros: 0, uncertainMicros: 0 });
  });

  test('counts every canonical outcome while retaining liabilities from terminal runs', () => {
    const runs = statuses.map(status => run(status));
    runs.push(run('running', { settledMicros: 101, reservedMicros: 211, uncertainMicros: 307 }));
    runs.push(run('cancelled', { settledMicros: 503, reservedMicros: 601, uncertainMicros: 701 }));
    runs.push(run('completed', { settledMicros: 1009, workingTargetMicros: 1000 }));
    expect(summarizeRuns(runs)).toEqual({
      total: 12, active: 4, review: 2, incomplete: 6,
      settledMicros: 1613, reservedMicros: 812, uncertainMicros: 1008,
    });
  });

  test('fresh summaries reflect later accounting without mutating inputs or earlier results', () => {
    const original = run('cancelled', { settledMicros: 100, reservedMicros: 900 });
    const first = summarizeRuns([original]);
    const settled = { ...original, budget: { ...original.budget, settledMicros: 400, reservedMicros: 0, availableMicros: 5_999_600 } };
    expect(summarizeRuns([settled])).toMatchObject({ settledMicros: 400, reservedMicros: 0, incomplete: 1 });
    expect(first).toMatchObject({ settledMicros: 100, reservedMicros: 900 });
    expect(original.budget).toMatchObject({ settledMicros: 100, reservedMicros: 900 });
  });

  test('descriptions and summaries accept deeply frozen inputs and return independent results', () => {
    const runs = [run('completed', { settledMicros: 250_000, workingTargetMicros: 250_000 }), run('failed', { uncertainMicros: 5_400_000 })];
    const before = structuredClone(runs);
    function freeze(value: unknown): void {
      if (value === null || typeof value !== 'object') return;
      for (const item of Object.values(value)) freeze(item);
      Object.freeze(value);
    }
    freeze(runs);
    for (const item of runs) {
      const description = describeRun(item);
      description.label = 'Changed by a caller';
      expect(describeRun(item).label).not.toBe(description.label);
    }
    const summary = summarizeRuns(runs);
    summary.settledMicros = 0;
    expect(summarizeRuns(runs).settledMicros).toBe(250_000);
    expect(runs).toEqual(before);
  });
});

function assessment(verdict: 'passed' | 'failed'): NonNullable<SwarmRecord['artifactAssessment']> {
  return {
    path: 'result.svg', revision: 2, sha256: 'a'.repeat(64), definitionOfDoneSha256: 'b'.repeat(64),
    createdAt: 2000, verdict, checks: [{ name: 'Pelican silhouette', passed: verdict === 'passed', evidence: verdict === 'passed' ? 'The reviewed revision shows the required silhouette.' : 'The reviewed image has no visible pelican bill.' }],
  };
}

describe('artifact review stays separate from run outcome', () => {
  test('a passed artifact review cannot turn request exhaustion into run completion or erase its liabilities', () => {
    const exhausted = run('budget_exhausted', { settledMicros: 147, reservedMicros: 400_000, uncertainMicros: 500_000 });
    const before = summarizeRuns([exhausted]);
    exhausted.artifactAssessment = assessment('passed');
    expect(describeArtifactReview(exhausted)).toMatchObject({ verdict: 'passed', label: 'Passed' });
    expect(describeRun(exhausted)).toMatchObject({ group: 'incomplete', label: 'Request capacity exhausted' });
    expect(summarizeRuns([exhausted])).toEqual(before);
    const html = renderRunCard(exhausted);
    expect(html).toContain('data-outcome-group="incomplete"');
    expect(html).toContain('data-artifact-review="passed"');
    expect(html).toContain('Request capacity exhausted');
    expect(html).toContain('$0.000147');
    expect(html).toContain('$0.40');
    expect(html).toContain('$0.50');
    expect(html.match(/data-run=/g)).toHaveLength(1);
  });

  test('failed review exposes a completed run’s failed criterion without changing its canonical claim', () => {
    const completed = run('completed', { agentStatuses: ['done', 'done'] });
    completed.artifactAssessment = assessment('failed');
    expect(describeRun(completed)).toMatchObject({ group: 'review', label: 'Completion reported · artifact reviewed' });
    expect(describeRun(completed).explanation).not.toContain('has not been recorded');
    expect(describeArtifactReview(completed)).toMatchObject({ verdict: 'failed', label: 'Failed' });
    const html = renderRunCard(completed);
    expect(html).toContain('Completion reported · artifact reviewed');
    expect(html).toContain('data-artifact-review="failed"');
    expect(html).toContain('Failed criteria:');
    expect(html).toContain('Pelican silhouette');
    expect(html).toContain('The reviewed image has no visible pelican bill.');
    expect(html).toContain('class="artifact-review-details" open');
    expect(html).toContain('<dt>Revision</dt><dd>2</dd>');
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('b'.repeat(64));
    expect(html).toContain('1970-01-01T00:00:02.000Z');
  });

  test('absent and null assessments make no output-existence or success claim', () => {
    for (const artifactAssessment of [undefined, null]) {
      const unreviewed = { ...run('completed'), artifactAssessment };
      expect(describeArtifactReview(unreviewed)).toMatchObject({ verdict: 'not_reviewed', label: 'Not reviewed' });
      const html = renderRunCard(unreviewed);
      expect(html).toContain('Expected output');
      expect(html).toContain('data-artifact-review="not_reviewed"');
      expect(html).toContain('does not establish that a file exists or that the task succeeded');
      expect(html).not.toContain('Reviewed path');
      expect(html).not.toContain('artifact-review-details');
    }
  });

  test('missing-file review displays its failed evidence without inventing a revision or hash', () => {
    const missing = run('failed');
    missing.artifactAssessment = { ...assessment('failed'), revision: 0, sha256: null,
      checks: [{ name: 'Expected file exists', passed: false, evidence: 'No canonical result.svg was published.' }] };
    const html = renderArtifactReview(missing);
    expect(html).toContain('0 · no published revision');
    expect(html).toContain('No artifact hash recorded');
    expect(html).toContain('No canonical result.svg was published.');
    expect(html).not.toContain('a'.repeat(64));
  });

  test('criteria and all artifact identifiers are escaped before HTML rendering', () => {
    const hostile = '<img src=x onerror="alert(1)"> & \'quoted\'';
    const reviewed = run('failed');
    reviewed.artifactAssessment = { ...assessment('failed'), path: hostile, sha256: hostile,
      definitionOfDoneSha256: hostile, checks: [{ name: hostile, evidence: hostile, passed: false }] };
    const before = structuredClone(reviewed);
    const html = renderArtifactReview(reviewed);
    expect(html).not.toContain('<img');
    expect(html).not.toContain(hostile);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;');
    expect(reviewed).toEqual(before);
  });

  test('large reviews keep the failed criteria visible while collapsing the complete checklist', () => {
    const reviewed = run('completed');
    reviewed.artifactAssessment = { ...assessment('failed'), checks: Array.from({ length: 6 }, (_, index) => ({
      name: `Criterion ${index + 1}`, passed: index !== 4, evidence: `Recorded evidence ${index + 1}`,
    })) };
    const html = renderArtifactReview(reviewed);
    expect(html).toContain('Review evidence · 5 passed · 1 failed');
    expect(html).toContain('<strong>Failed criteria:</strong> Criterion 5');
    expect(html).not.toContain('class="artifact-review-details" open');
    expect(html).toContain('Recorded evidence 6');
  });
});
