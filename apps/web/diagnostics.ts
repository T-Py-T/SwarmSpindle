import type { BudgetSnapshot, SwarmDiagnostics } from '@simpleswarm/swarm';

function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function money(micros: number): string { return `$${(micros / 1_000_000).toFixed(6)}`; }

function budgetValues(budget: BudgetSnapshot): string {
  return `<dl class="diagnostics-balances"><div><dt>Verified spend</dt><dd>${money(budget.settledMicros)}</dd></div><div><dt>Reserved</dt><dd>${money(budget.reservedMicros)}</dd></div><div><dt>Unresolved</dt><dd>${money(budget.uncertainMicros)}</dd></div><div><dt>Available</dt><dd>${money(budget.availableMicros)}</dd></div><div><dt>Hard ceiling</dt><dd>${money(budget.capMicros)}</dd></div></dl>`;
}

function renderStop(stop: SwarmDiagnostics['stops'][number]): string {
  const origin = { agent: 'Agent decision', runtime: 'Runtime stop', unknown: 'Origin not recorded' }[stop.origin];
  const hasRecordedStop = stop.eventSeq !== null;
  return `<article class="diagnostics-peer" data-diagnostic-agent="${escape(stop.agentId)}"><div class="diagnostics-peer-heading"><h3>${escape(stop.name)}</h3><span class="pill">${escape(stop.status.replaceAll('_', ' '))}</span></div>
    <p class="diagnostics-origin"><strong>${hasRecordedStop ? origin : 'No recorded stop'}</strong>${hasRecordedStop ? ` · event #${escape(stop.eventSeq)}` : ''}${stop.at === null ? '' : ` · <time datetime="${escape(new Date(stop.at).toISOString())}">${escape(new Date(stop.at).toLocaleString())}</time>`}</p>
    <p class="diagnostics-reason">${escape(stop.reason ?? (hasRecordedStop ? 'No reason was recorded with this stop.' : 'This peer has no recorded stop event. Its current status is shown above.'))}</p>
    ${!hasRecordedStop && stop.reason ? '<p class="diagnostics-note">This is the stored peer reason; no stop event is available to establish its origin or timing.</p>' : ''}
    <div class="diagnostics-stop-fields">${stop.code === null ? '' : `<span>Code <code>${escape(stop.code)}</code></span>`}${stop.turn === null ? '' : `<span>Recorded turn ${escape(stop.turn)}</span>`}<span>Last recorded budget observation ${stop.lastBudgetObservationSeq === null ? 'not available' : `#${escape(stop.lastBudgetObservationSeq)}`}</span></div>
    <section class="diagnostics-stop-budget" aria-label="Budget at stop"><h4>Budget at stop</h4>${stop.budget ? budgetValues(stop.budget) : '<p class="diagnostics-note">No budget snapshot was recorded at this stop. Current balances are not a substitute for that missing evidence.</p>'}</section>
    ${stop.lastTool ? `<section class="diagnostics-last-tool"><h4>Last recorded tool</h4><p><strong>${escape(stop.lastTool.name)}</strong> · event #${escape(stop.lastTool.seq)} · ${stop.lastTool.failed ? 'Failed' : 'No tool failure recorded'}${stop.lastTool.exitCode === null ? '' : ` · exit ${escape(stop.lastTool.exitCode)}`}</p><p class="diagnostics-tool-summary">${escape(stop.lastTool.summary)}</p></section>` : '<p class="diagnostics-note">No preceding tool result is recorded.</p>'}
  </article>`;
}

export function renderDiagnostics(diagnostics: SwarmDiagnostics): string {
  const metricLabels: Array<[keyof SwarmDiagnostics['metrics'], string]> = [
    ['modelResponses', 'Model responses'], ['toolCalls', 'Tool calls'], ['toolFailures', 'Tool failures'],
    ['unpublishedShellCalls', 'Unpublished shell calls'], ['outputLimitHits', 'Output limit hits'],
  ];
  return `<div class="diagnostics-view"><p class="diagnostics-intro">Recorded decisions, tool results and accounting snapshots explain how execution ended. These records do not verify that the requested output succeeded.</p>
    <dl class="diagnostics-metrics">${metricLabels.map(([key, label]) => `<div><dt>${label}</dt><dd>${escape(diagnostics.metrics[key])}</dd></div>`).join('')}</dl>
    <p class="diagnostics-note">${escape(diagnostics.eventCount)} recorded events examined · through event #${escape(diagnostics.throughSeq)}${diagnostics.truncated ? ' · Partial history: some evidence may be missing.' : ''}</p>
    <details class="diagnostics-current-budget"><summary>Current budget · USD-equivalent</summary>${budgetValues(diagnostics.budget.current)}<p class="diagnostics-note">Next request ceiling: ${diagnostics.budget.nextRequestCeilingMicros === null ? 'not available' : money(diagnostics.budget.nextRequestCeilingMicros)}. These are current balances; each recorded stop snapshot below may differ. Reserved and unresolved amounts are held liabilities, not verified spending.</p></details>
    <section class="diagnostics-peers" aria-label="Peer stop evidence">${diagnostics.stops.length ? diagnostics.stops.map(renderStop).join('') : '<p class="diagnostics-note">No recorded stop. No terminal peer stop evidence is available in the examined events.</p>'}</section>
    <section class="diagnostics-issues" aria-label="Recorded issues"><h3>Latest recorded issues (up to 100)</h3>${diagnostics.issues.length ? `<ul>${diagnostics.issues.map(issue => `<li><div><strong>${escape(issue.kind.replaceAll('_', ' '))}</strong> · event #${escape(issue.seq)}${issue.agentId === null ? ' · system' : ` · ${escape(diagnostics.stops.find(stop => stop.agentId === issue.agentId)?.name ?? issue.agentId)}`}</div><p>${escape(issue.summary)}</p></li>`).join('')}</ul>` : '<p class="diagnostics-note">No issues appear in the examined events. This does not establish that the output passed review.</p>'}</section>
  </div>`;
}
