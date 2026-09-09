import type { AgentRecord, SwarmRecord } from '@simpleswarm/swarm';
import { describeArtifactReview, describeRun, summarizeRuns, type OutcomeFilter } from './overview-model.ts';

function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

const moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 });
const numberFormat = new Intl.NumberFormat('en-US');
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function money(micros: number): string { return escape(moneyFormat.format(micros / 1_000_000)); }
function count(value: number): string { return escape(numberFormat.format(value)); }

function timestamp(value: number | null, fallback: string): string {
  if (value === null) return escape(fallback);
  const date = new Date(value);
  return `<time datetime="${escape(date.toISOString())}" title="${escape(date.toLocaleString())}">${escape(dateFormat.format(date))}</time>`;
}

function costCells(settledMicros: number, reservedMicros: number, uncertainMicros: number): string {
  return `<div class="overview-cost overview-cost-verified"><dt>Verified spend</dt><dd>${money(settledMicros)}</dd></div>
    <div class="overview-cost"><dt>Reserved capacity</dt><dd>${money(reservedMicros)}</dd></div>
    <div class="overview-cost ${uncertainMicros > 0 ? 'overview-cost-unresolved' : ''}"><dt>Unresolved liability</dt><dd>${money(uncertainMicros)}</dd></div>`;
}

export function renderOverview(runs: SwarmRecord[], filter: OutcomeFilter): string {
  const summary = summarizeRuns(runs);
  const metrics: Array<{ outcome: Exclude<OutcomeFilter, 'all'>; label: string; detail: string }> = [
    { outcome: 'active', label: 'Active & queued', detail: 'Running, queued or stopping' },
    { outcome: 'review', label: 'Completion claims', detail: 'Inspect the separate artifact review' },
    { outcome: 'incomplete', label: 'Stopped incomplete', detail: 'Inspect the outcome and recorded reason' },
  ];
  return `<div class="overview-heading overview-home-heading"><div><div class="eyebrow">WORKSPACE OVERVIEW</div><h1>Your swarms</h1><p class="muted">See what is working, what needs review, and what stopped.</p></div>
    <button type="button" class="overview-all" data-outcome="all" aria-pressed="${filter === 'all'}">All swarms <strong>${count(summary.total)}</strong></button></div>
    <div class="overview-metrics" role="group" aria-label="Filter swarms by outcome">${metrics.map(metric => `<button type="button" class="overview-metric overview-metric-${metric.outcome}" data-outcome="${metric.outcome}" aria-pressed="${filter === metric.outcome}"><span class="overview-metric-label">${metric.label}</span><strong>${count(summary[metric.outcome])}</strong><span class="overview-metric-detail">${metric.detail}</span></button>`).join('')}</div>
    <section class="overview-spending" aria-label="Spending across all swarms"><div class="overview-spending-heading"><h2>Usage & held capacity</h2><span>USD-equivalent · all ${count(summary.total)} swarms</span></div><dl class="overview-costs">${costCells(summary.settledMicros, summary.reservedMicros, summary.uncertainMicros)}</dl><p>Reservations and unresolved liabilities are held capacity, not confirmed spending. These totals combine separate run ledgers; capacity cannot transfer between runs.</p></section>`;
}

const agentStatuses: Array<{ status: AgentRecord['status']; label: string }> = [
  { status: 'ready', label: 'Ready' }, { status: 'running', label: 'Running' },
  { status: 'waiting', label: 'Waiting' }, { status: 'done', label: 'Done reported' },
  { status: 'bailed', label: 'Bailed' }, { status: 'failed', label: 'Failed' },
  { status: 'cancelled', label: 'Cancelled' }, { status: 'stalled', label: 'Stalled' },
];

function agentActivity(agents: AgentRecord[]): string {
  const counts = new Map<AgentRecord['status'], number>();
  let tokens = 0;
  let toolCalls = 0;
  for (const agent of agents) {
    counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
    tokens += agent.usage.input + agent.usage.output + agent.usage.cacheRead + agent.usage.cacheWrite;
    toolCalls += agent.toolCalls;
  }
  return `<section class="overview-agent-activity" aria-label="Agent activity"><div class="overview-section-line"><h3>${count(agents.length)} agents</h3><span>${count(toolCalls)} tool calls · ${count(tokens)} tokens</span></div><ul class="overview-agent-counts">${agentStatuses.filter(item => counts.has(item.status)).map(item => `<li><strong>${count(counts.get(item.status)!)}</strong> ${item.label}</li>`).join('') || '<li>No agents recorded</li>'}</ul></section>`;
}

export function renderArtifactReview(run: SwarmRecord): string {
  const review = describeArtifactReview(run);
  const assessment = run.artifactAssessment;
  const heading = `<div class="overview-section-line"><h3>Artifact review</h3><span class="artifact-review-verdict artifact-review-${review.verdict}">${review.label}</span></div><p class="artifact-review-explanation">${review.explanation}</p>`;
  if (!assessment) return `<section class="artifact-review" aria-label="Artifact review" data-artifact-review="not_reviewed">${heading}</section>`;
  const failedChecks = assessment.checks.filter(check => !check.passed);
  return `<section class="artifact-review" aria-label="Artifact review" data-artifact-review="${review.verdict}">${heading}
    ${failedChecks.length > 0 ? `<p class="artifact-review-failures"><strong>Failed criteria:</strong> ${failedChecks.map(check => escape(check.name)).join(' · ')}</p>` : ''}
    <details class="artifact-review-details"${assessment.checks.length <= 3 ? ' open' : ''}><summary>Review evidence · ${count(assessment.checks.length - failedChecks.length)} passed · ${count(failedChecks.length)} failed</summary>
      <ul class="artifact-review-checks">${assessment.checks.map(check => `<li class="artifact-check-${check.passed ? 'passed' : 'failed'}"><div><span class="artifact-check-result">${check.passed ? 'Passed' : 'Failed'}</span><strong>${escape(check.name)}</strong></div><p>${escape(check.evidence)}</p></li>`).join('')}</ul>
      <dl class="artifact-review-identity"><div><dt>Reviewed path</dt><dd><code>${escape(assessment.path)}</code></dd></div><div><dt>Revision</dt><dd>${assessment.revision === 0 ? '0 · no published revision' : count(assessment.revision)}</dd></div><div><dt>Artifact SHA-256</dt><dd><code>${assessment.sha256 === null ? 'No artifact hash recorded' : escape(assessment.sha256)}</code></dd></div><div><dt>Definition of done SHA-256</dt><dd><code>${escape(assessment.definitionOfDoneSha256)}</code></dd></div><div><dt>Reviewed</dt><dd>${timestamp(assessment.createdAt, 'Not recorded')}</dd></div></dl>
    </details></section>`;
}

export function renderRunCard(run: SwarmRecord): string {
  const outcome = describeRun(run);
  return `<article class="row swarm-row overview-run" data-outcome-group="${outcome.group}">
    <div class="overview-run-heading"><div class="overview-run-identity"><button type="button" class="row-title" data-run="${escape(run.id)}">${escape(run.spec.title)} <span aria-hidden="true">↗</span></button><div class="overview-run-model">${escape(run.spec.model.id)} · ${escape(run.spec.model.thinking)}</div></div><span class="overview-outcome overview-outcome-${outcome.group}">${escape(outcome.label)}</span></div>
    <div class="overview-run-outcome"><p>${escape(outcome.explanation)}</p>${run.reason ? `<p class="overview-run-reason"><strong>Recorded reason</strong> ${escape(run.reason)}</p>` : ''}${outcome.targetReached ? '<span class="overview-target">Working target reached</span>' : ''}</div>
    <div class="overview-expected-output"><span>Expected output</span><code>${escape(run.spec.finalOutput)}</code></div>
    ${renderArtifactReview(run)}
    ${agentActivity(run.agents)}
    <div class="overview-run-budget"><dl class="overview-costs">${costCells(run.budget.settledMicros, run.budget.reservedMicros, run.budget.uncertainMicros)}</dl><p>USD-equivalent · Hard ceiling ${money(run.budget.capMicros)}${run.spec.workingTargetMicros === undefined ? '' : ` · Working target ${money(run.spec.workingTargetMicros)}`}</p></div>
    <div class="overview-run-footer"><dl class="overview-run-times"><div><dt>Created</dt><dd>${timestamp(run.createdAt, 'Not recorded')}</dd></div><div><dt>Started</dt><dd>${timestamp(run.startedAt, 'Not started')}</dd></div><div><dt>Ended</dt><dd>${timestamp(run.endedAt, 'Not ended')}</dd></div></dl></div>
  </article>`;
}
