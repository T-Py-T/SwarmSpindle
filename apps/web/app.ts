import { createMessageSearch } from './message-search.ts';
import type { AgentRecord, BoardMessage, FileClaim, FileVersion, SwarmRecord, ThreadRecord, TraceEvent } from '@simpleswarm/swarm';

type View = 'swarms' | 'threads' | 'agents';
interface Detail { run: SwarmRecord; threads: ThreadRecord[]; claims: FileClaim[]; files: FileVersion[] }
interface ThreadSummary extends ThreadRecord { lastMessage: Pick<BoardMessage, 'id' | 'authorId' | 'createdAt' | 'body'> | null }
interface ThreadPage { threads: ThreadSummary[]; next: number | null }
interface MessagePage { messages: BoardMessage[]; next: number | null }
interface Conversation { swarmId: string; threadId: string; cursor: number; count: number; loading: boolean; pending: boolean }
interface TraceView { swarmId: string; agentId: string | null; version: number; container: HTMLElement; count: HTMLElement; rows: Map<number, HTMLDetailsElement> }
const $ = <T extends HTMLElement>(id: string): T => { const element = document.getElementById(id); if (!element) throw new Error(`Missing ${id}`); return element as T; };
const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content;
const previewOrigin = document.querySelector<HTMLMetaElement>('meta[name="preview-origin"]')!.content;
const state: { view: View; runs: SwarmRecord[]; selected: string | null; detail: Detail | null; events: TraceEvent[]; source: EventSource | null; dialog: { kind: string; id?: string } | null; threads: ThreadSummary[] } = { view: 'swarms', runs: [], selected: new URL(location.href).searchParams.get('swarm'), detail: null, events: [], source: null, dialog: null, threads: [] };
const terminals = new Set(['completed', 'bailed', 'failed', 'cancelled', 'budget_exhausted', 'interrupted']);
const palette = [['#e0e7da','#46654a'],['#e8dfd0','#8e6037'],['#dde3e8','#4c657f'],['#eadcdd','#90565f'],['#e4dfea','#735e8a'],['#dce8e3','#427766']];
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshing = false;
let selectionVersion = 0;
let threadRequestVersion = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let conversation: Conversation | null = null;
let traceView: TraceView | null = null;
const traceLimit = 10_000;
let traceFrame: number | undefined;
let pendingTraceEvents: Array<{ event: TraceEvent; version: number }> = [];
const drafts = new Map<string, string>();
const initialLocation = new URL(location.href);
const messageSearch = createMessageSearch($('message-search'), {
  api, selected: () => state.selected,
  openThread: async (swarmId, threadId) => {
    if (state.selected !== swarmId) await selectRun(swarmId);
    if (state.selected !== swarmId || state.detail?.run.id !== swarmId) return;
    state.view = 'threads'; render(); await showDetail('thread', threadId);
  },
});

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { signal: AbortSignal.timeout(8000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Swarm-CSRF': csrf }, body: JSON.stringify(body) }) });
  if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error ?? `Request failed (${response.status}).`); }
  return response.json() as Promise<T>;
}
function escape(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]!); }
function dollars(micros: number): string { return `$${(micros / 1_000_000).toFixed(2)}`; }
function count(number: number): string { return Intl.NumberFormat('en-US', { notation: number > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number); }
function duration(run: SwarmRecord): string { const seconds = Math.max(0, Math.floor(((run.endedAt ?? Date.now()) - (run.startedAt ?? run.createdAt)) / 1000)); return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
function status(value: string): string { return `<span class="status ${escape(value)}">${escape(value.replaceAll('_', ' '))}</span>`; }
function agent(id: string): AgentRecord | undefined { return state.detail?.run.agents.find(item => item.id === id); }
function badge(id: string): string { const item = agent(id); const n = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0); const colors = palette[n % palette.length]!; return `<span class="badge" style="--badge-bg:${colors[0]};--badge-fg:${colors[1]}" title="${escape(item?.name ?? id)}">${escape(item?.name ?? (id === 'operator' ? 'operator' : id))}</span>`; }
function notice(message: string): void { $('notice').hidden = !message; $('notice').textContent = message; }
function totals(run: SwarmRecord) { return run.agents.reduce((sum, item) => ({ tokens: sum.tokens + item.usage.input + item.usage.output + item.usage.cacheRead + item.usage.cacheWrite, calls: sum.calls + item.toolCalls }), { tokens: 0, calls: 0 }); }
function budget(run: SwarmRecord): string {
  const b = run.budget; const percent = (value: number) => Math.min(100, value / b.capMicros * 100);
  return `<div class="budget-track" aria-label="Shared budget liability"><span class="spent" style="width:${percent(b.settledMicros)}%"></span><span class="reserved" style="width:${percent(b.reservedMicros)}%"></span><span class="uncertain" style="width:${percent(b.uncertainMicros)}%"></span></div><div class="budget-labels"><span>settled ${dollars(b.settledMicros)} · reserved ${dollars(b.reservedMicros)} · uncertain ${dollars(b.uncertainMicros)}</span><span>${dollars(b.availableMicros)} available / ${dollars(b.capMicros)} cap · USD-equivalent</span></div>${b.uncertainMicros > 0 ? `<p class="budget-explanation">${dollars(b.uncertainMicros)} is held for requests without verified final usage; it is not confirmed spending. ${run.status === 'budget_exhausted' ? 'This run stopped because available capacity could not cover another bounded request.' : 'Further requests are blocked when unresolved charges remain.'} The cap includes verified usage, active reservations and these unresolved charges.</p>` : ''}`;
}

function render(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.classList.toggle('selected', button.dataset.view === state.view));
  const run = state.detail?.run;
  $('message-search').hidden = state.view !== 'threads';
  $('board-conversation').hidden = state.view !== 'threads' || !conversation;
  $('board-layout').classList.toggle('with-conversation', state.view === 'threads' && Boolean(conversation));
  if (state.view !== 'swarms' && run) {
    const total = totals(run);
    $('summary').innerHTML = `<div class="summary-top"><div><div class="eyebrow">${escape(run.id)} · ${duration(run)} · ${run.agents.length} agents</div><h1>${escape(run.spec.title)}</h1>${status(run.status)} <span class="pill">${escape(run.spec.model.id)} / ${escape(run.spec.model.thinking)}</span><div class="summary-actions"><button data-action="goal">STARTING GOAL</button><button data-action="files">FILES & CLAIMS</button><button data-action="trace">RAW TRACE</button>${terminals.has(run.status) ? '' : '<button data-action="stop" class="danger">STOP SWARM</button>'}</div>${run.reason ? `<p class="muted">${escape(run.reason)}</p>` : ''}</div><div class="stats"><div class="price">${dollars(run.budget.settledMicros)}</div><div class="muted">verified usage · USD-equivalent</div><div class="muted">${count(total.tokens)} tokens | ${count(total.calls)} calls</div></div></div>${budget(run)}${run.spec.workingTargetMicros === undefined ? '' : `<p class="budget-explanation">Working target ${dollars(run.spec.workingTargetMicros)} · ${dollars(Math.max(0, run.spec.workingTargetMicros - run.budget.settledMicros))} remaining against verified usage. Existing requests may finish above this target; the separate hard ceiling stays enforced.</p>`}`;
  } else $('summary').innerHTML = `<div class="eyebrow">SHARED GOALS / INDEPENDENT PEERS</div><h1>Your swarms</h1><span class="muted">${state.runs.length} missions · ${state.runs.filter(run => !terminals.has(run.status)).length} active or queued</span>`;
  $('sort-label').hidden = state.view !== 'threads'; $('filter-label').hidden = state.view !== 'threads';
  renderRows(); renderTimeline();
  $('footer-status').textContent = run ? `${run.spec.model.id} / ${run.spec.model.thinking} · ${run.status} · ${duration(run)}` : 'No swarm selected';
}
function renderRows(): void {
  const query = $<HTMLInputElement>('search').value.toLowerCase();
  let rows: string[] = [];
  if (state.view === 'swarms') rows = state.runs.filter(run => `${run.spec.title} ${run.spec.task} ${run.spec.model.id} ${run.status}`.toLowerCase().includes(query)).map(run => `<article class="row swarm-row"><div><button class="row-title" data-run="${escape(run.id)}">${escape(run.spec.title)} ↗</button><div class="preview-text">${escape(run.spec.task)}</div></div><div class="model-cell">${escape(run.spec.model.id)}<div class="row-meta">${run.agents.length} agents · ${escape(run.spec.model.thinking)}</div></div><div class="row-meta">${status(run.status)}<br>${duration(run)}</div><div class="row-right">${dollars(run.budget.settledMicros)}<div class="row-meta">/ ${dollars(run.budget.capMicros)}</div></div></article>`);
  if (state.view === 'threads' && state.detail) {
    const filter = $<HTMLSelectElement>('filter').value; const sort = $<HTMLSelectElement>('sort').value;
    const threads = state.threads.filter(thread => {
      const dormant = Date.now() - thread.updatedAt > 60_000;
      return filter === 'all' || (filter === 'dormant') === dormant;
    }).sort((a, b) => sort === 'created' ? b.createdAt-a.createdAt : sort === 'volume' ? b.messageCount-a.messageCount : sort === 'members' ? b.members.length-a.members.length : b.updatedAt-a.updatedAt);
    rows = threads.map(thread => `<article class="row thread-row ${Date.now()-thread.updatedAt > 60_000 ? 'dormant' : ''}"><div><button class="row-title" data-thread="${escape(thread.id)}">${escape(thread.title)}</button><div class="preview-text">${thread.lastMessage ? `${escape(agent(thread.lastMessage.authorId)?.name ?? thread.lastMessage.authorId)}: ${escape(thread.lastMessage.body)}` : 'No messages yet.'}</div><div class="row-meta">${thread.messageCount} messages · updated ${new Date(thread.updatedAt).toLocaleTimeString()}</div></div><div class="badges">${thread.members.slice(0,7).map(badge).join('')}${thread.members.length > 7 ? `<span class="badge">+${thread.members.length-7}</span>` : ''}</div><div class="row-right">${thread.members.length}<div class="row-meta">members</div></div></article>`);
  }
  if (state.view === 'agents' && state.detail) rows = state.detail.run.agents.filter(item => `${item.name} ${item.status} ${item.reason ?? ''}`.toLowerCase().includes(query)).map(item => `<article class="row agent-row"><div><button class="row-title" data-agent="${escape(item.id)}">${badge(item.id)}</button><div class="preview-text">${escape(item.reason ?? (item.sessionId ? 'Pi session connected' : 'Waiting for worker'))}</div></div><div>${status(item.status)}</div><div class="row-meta">${count(item.usage.input+item.usage.output+item.usage.cacheRead+item.usage.cacheWrite)} tokens<br>${count(item.toolCalls)} calls</div><div class="row-right">${dollars(item.costMicros)}</div></article>`);
  $('content').innerHTML = rows.length ? `<div class="rows">${rows.join('')}</div>` : `<div class="empty"><strong>${state.view !== 'swarms' && !state.detail ? 'Select a swarm first' : query ? 'No signals match your search' : 'Nothing here yet'}</strong>${state.view === 'swarms' ? 'Start a swarm to give independent peers a shared mission.' : 'Choose a mission from SWARMS to explore its collaboration.'}</div>`;
}
function renderTimeline(): void {
  if (state.view === 'swarms' || !state.detail) { $('timeline').innerHTML = ''; return; }
  const run = state.detail.run; const start = run.startedAt ?? run.createdAt; const end = Math.max(start+1,run.endedAt ?? Date.now());
  const bins = Array.from({length:80},()=>0);
  for (const event of state.events) { const i = Math.max(0,Math.min(79,Math.floor((event.createdAt-start)/(end-start)*80))); bins[i]!++; }
  const max = Math.max(1,...bins);
  $('timeline').innerHTML = `<div class="eyebrow">EVENT ACTIVITY</div><div class="histogram">${bins.map((n,i)=>`<span style="height:${Math.max(2,n/max*100)}%" title="${n} recorded events · ${Math.round((end-start)/1000*i/80)}s"></span>`).join('')}</div><div class="timeline-legend"><span>start</span><span>${state.events.length} loaded events · message & tool activity</span><span>${duration(run)}</span></div>`;
}

async function refreshThreads(): Promise<void> {
  const selected = state.selected;
  if (!selected || state.view !== 'threads') return;
  const version = selectionVersion;
  const request = ++threadRequestVersion;
  const query = $<HTMLInputElement>('search').value.trim();
  const threads: ThreadSummary[] = [];
  let after: number | null = 0;
  do {
    const page: ThreadPage = await api(`/api/swarms/${encodeURIComponent(selected)}/threads?query=${encodeURIComponent(query)}&after=${after}`);
    if (state.selected !== selected || selectionVersion !== version || threadRequestVersion !== request) return;
    threads.push(...page.threads);
    after = page.next;
  } while (after !== null);
  state.threads = threads;
  renderRows();
}

function saveDraft(): void {
  if (conversation) drafts.set(`${conversation.swarmId}\0${conversation.threadId}`, $<HTMLTextAreaElement>('operator-message').value);
}

function appendConversationMessages(current: Conversation, messages: BoardMessage[]): void {
  const dialog = $('board-scroll');
  dialog.style.overflowAnchor = 'none';
  const scrollTop = dialog.scrollTop;
  const container = $('conversation-messages');
  for (const item of messages) {
    if (item.id <= current.cursor) continue;
    container.insertAdjacentHTML('beforeend', `<article class="message" data-message-id="${item.id}"><div class="message-head">${badge(item.authorId)}<time>${new Date(item.createdAt).toLocaleString()}</time></div><div class="prose">${escape(item.body)}</div></article>`);
    current.cursor = item.id;
    current.count += 1;
  }
  $('conversation-count').textContent = `CONVERSATION · ${current.count} messages`;
  dialog.scrollTop = scrollTop;
}

async function refreshConversation(current = conversation): Promise<void> {
  if (!current || conversation !== current) return;
  if (current.loading) { current.pending = true; return; }
  current.loading = true;
  try {
    let more: boolean;
    do {
      current.pending = false;
      const page = await api<MessagePage>(`/api/swarms/${encodeURIComponent(current.swarmId)}/message-page?thread=${encodeURIComponent(current.threadId)}&after=${current.cursor}`);
      if (conversation !== current || state.selected !== current.swarmId || state.view !== 'threads') return;
      appendConversationMessages(current, page.messages);
      more = page.next !== null || current.pending;
    } while (more);
  } finally { current.loading = false; }
}

function createTraceRow(event: TraceEvent): HTMLDetailsElement {
  const row = document.createElement('details');
  row.className = 'trace-event'; row.dataset.traceSeq = String(event.seq);
  const summary = document.createElement('summary');
  summary.textContent = `${new Date(event.createdAt).toLocaleTimeString()} · #${event.seq} · ${agent(event.agentId ?? '')?.name ?? 'system'} · ${event.kind}`;
  row.append(summary);
  row.addEventListener('toggle', () => {
    if (!row.open || row.querySelector('pre')) return;
    const payload = document.createElement('pre');
    payload.textContent = JSON.stringify(event.payload, null, 2);
    row.append(payload);
  });
  return row;
}

function updateTraceView(events: readonly TraceEvent[] = []): void {
  const current = traceView;
  const dialog = $<HTMLDialogElement>('detail');
  if (!current || !dialog.open || current.swarmId !== state.selected || current.version !== selectionVersion || !current.container.isConnected || (state.dialog?.kind !== 'agent' && state.dialog?.kind !== 'trace')) return;
  if ((state.dialog.kind === 'agent' ? state.dialog.id : null) !== current.agentId) return;
  dialog.style.overflowAnchor = 'none';
  const scrollTop = dialog.scrollTop;
  const dialogTop = dialog.getBoundingClientRect().top;
  const focused = document.activeElement;
  const oldest = state.events[0]?.seq ?? Number.POSITIVE_INFINITY;
  let removedAbove = 0;
  let focusRemoved = false;
  for (const [seq, row] of current.rows) {
    if (seq >= oldest) break;
    const bounds = row.getBoundingClientRect();
    removedAbove += Math.min(bounds.height, Math.max(0, dialogTop - bounds.top));
    if (focused && row.contains(focused)) focusRemoved = true;
    row.remove(); current.rows.delete(seq);
  }
  for (const event of events) {
    if (event.swarmId !== current.swarmId || event.seq < oldest || current.rows.has(event.seq) || (current.agentId !== null && event.agentId !== current.agentId)) continue;
    const row = createTraceRow(event);
    current.container.append(row); current.rows.set(event.seq, row);
  }
  current.count.textContent = `${current.rows.size} loaded events · live updates · latest ${traceLimit.toLocaleString()} swarm events retained`;
  if (focusRemoved) current.container.querySelector('summary')?.focus({ preventScroll: true });
  dialog.scrollTop = Math.max(0, scrollTop - removedAbove);
}

function scheduleTraceEvent(event: TraceEvent): void {
  if (!traceView) return;
  pendingTraceEvents.push({ event, version: selectionVersion });
  if (pendingTraceEvents.length > traceLimit) pendingTraceEvents.splice(0, pendingTraceEvents.length - traceLimit);
  if (traceFrame !== undefined) return;
  traceFrame = requestAnimationFrame(() => {
    traceFrame = undefined;
    const events = pendingTraceEvents.filter(entry => entry.version === selectionVersion).map(entry => entry.event); pendingTraceEvents = [];
    updateTraceView(events);
  });
}

async function refresh(): Promise<void> {
  if (refreshing) return; refreshing = true;
  const selected = state.selected;
  const version = selectionVersion;
  try {
    const [runs, workers] = await Promise.all([api<SwarmRecord[]>('/api/swarms'), api<Array<{status:string;heartbeatAt:number}>>('/api/workers')]);
    state.runs = runs;
    const online = workers.filter(worker => worker.status === 'online' && Date.now()-worker.heartbeatAt < 10_000).length;
    $('worker-state').textContent = online ? `${online} worker${online===1?'':'s'} online` : 'worker offline · queue preserved';
    if (selected) {
      const detail = await api<Detail>(`/api/swarms/${encodeURIComponent(selected)}`);
      if (state.selected !== selected || selectionVersion !== version) return;
      state.detail = detail;
    }
    if (state.source?.readyState === EventSource.OPEN) $('connection').textContent = '● connected';
    else if (state.selected && state.source?.readyState === EventSource.CLOSED) connectEvents(state.selected);
    render();
    updateTraceView();
    const current = conversation;
    if (current && state.detail?.run.id === current.swarmId) {
      $('message-form').hidden = terminals.has(state.detail.run.status);
      if ((state.detail.threads.find(thread => thread.id === current.threadId)?.messageCount ?? 0) > current.count) await refreshConversation(current);
    }
    await refreshThreads();
  } catch (error) {
    if (state.selected === selected && selectionVersion === version) { notice(message(error)); $('connection').textContent = 'disconnected'; }
  }
  finally { refreshing = false; }
}
function scheduleRefresh(): void { if (!refreshTimer) refreshTimer = setTimeout(()=>{refreshTimer=undefined;void refresh();},250); }
async function selectRun(id: string): Promise<void> {
  const version = ++selectionVersion;
  threadRequestVersion += 1;
  saveDraft(); conversation=null; traceView=null; state.dialog=null; messageSearch.reset();
  $<HTMLDialogElement>('detail').close();
  state.source?.close(); state.source=null; state.selected=id; state.view='threads'; state.events=[]; state.detail=null; state.threads=[];
  $<HTMLInputElement>('search').value='';
  history.replaceState(null,'',`/?swarm=${encodeURIComponent(id)}`);
  const [detail, events] = await Promise.all([api<Detail>(`/api/swarms/${encodeURIComponent(id)}`), api<TraceEvent[]>(`/api/swarms/${encodeURIComponent(id)}/trace`)]);
  if (state.selected !== id || selectionVersion !== version) return;
  state.detail=detail; state.events=events;
  connectEvents(id);
  render();
  await refreshThreads();
}
function connectEvents(id: string): void {
  state.source?.close();
  const source = new EventSource(`/api/swarms/${encodeURIComponent(id)}/events?after=${state.events.at(-1)?.seq ?? 0}`); state.source=source;
  source.addEventListener('trace', event => {
    const trace = JSON.parse((event as MessageEvent<string>).data) as TraceEvent;
    if (state.source !== source || trace.swarmId !== state.selected) return;
    if (!state.events.some(item => item.seq === trace.seq)) state.events.push(trace);
    if (state.events.length > traceLimit) state.events.splice(0,state.events.length-traceLimit);
    scheduleTraceEvent(trace);
    scheduleRefresh();
  });
  source.onopen=()=>{if(state.source===source) $('connection').textContent='● connected';};
  source.onerror=()=>{if(state.source===source) $('connection').textContent='reconnecting…';};
}
window.addEventListener('online',()=>{if(state.selected) connectEvents(state.selected);void refresh();});
async function showDetail(kind: string, id?: string): Promise<void> {
  if (!state.detail) return;
  if (kind === 'thread' && !state.detail.threads.some(thread => thread.id === id) && !state.threads.some(thread => thread.id === id)) throw new Error('This thread does not belong to the selected swarm.');
  if (kind === 'thread' && conversation?.swarmId === state.selected && conversation.threadId === id) { await refreshConversation(); return; }
  if ((kind === 'trace' || kind === 'agent') && traceView?.swarmId === state.selected && traceView.agentId === (kind === 'agent' ? id : null) && traceView.version === selectionVersion) { updateTraceView(state.events); return; }
  saveDraft(); conversation = null; traceView = null; $('board-conversation').hidden = true; $('board-layout').classList.remove('with-conversation');
  state.dialog={kind,id}; const run=state.detail.run;
  const title=$('detail-title'); const body=$('detail-body'); $('message-form').hidden=true;
  if(kind==='goal') { title.textContent='Starting goal'; body.innerHTML=goal(run); }
  if(kind==='thread' && id) {
    const thread=state.detail.threads.find(item=>item.id===id) ?? state.threads.find(item=>item.id===id); $('board-title').textContent=thread?.title ?? 'Thread';
    $('board-body').innerHTML=`${goal(run, false)}<h3 id="conversation-count">CONVERSATION · 0 messages</h3><button data-action="refresh-thread">REFRESH CONVERSATION</button><div id="conversation-messages" aria-live="polite"></div>`;
    conversation = { swarmId: run.id, threadId: id, cursor: 0, count: 0, loading: false, pending: false };
    $<HTMLTextAreaElement>('operator-message').value = drafts.get(`${run.id}\0${id}`) ?? '';
    $('message-form').hidden=terminals.has(run.status);
    $('board-scroll').append($('message-form'));
    $<HTMLDialogElement>('detail').close();
    state.dialog = null;
    $('board-conversation').hidden = false; $('board-layout').classList.add('with-conversation');
    history.replaceState(null, '', `/?swarm=${encodeURIComponent(run.id)}&thread=${encodeURIComponent(id)}`);
    await refreshConversation();
    return;
  }
  if(kind==='agent' || kind==='trace') {
    const item=id ? agent(id) : undefined; title.textContent=item ? `${item.name} / agent trace` : 'Raw swarm trace';
    body.innerHTML=`${item ? `<div class="agent-summary">${status(item.status)}<span>${dollars(item.costMicros)} USD-equivalent</span><span>${item.toolCalls} calls</span></div><div class="muted prose">${escape(item.reason ?? '')}\nSession: ${escape(item.sessionId ?? 'not started')}</div>`:''}<div class="trace-toolbar"><span class="muted" id="trace-count" aria-live="polite"></span><button data-action="refresh-trace">REFRESH TRACE</button><button data-action="expand-trace">SHOW ALL DETAILS</button></div><div id="trace-events"></div>`;
    traceView = { swarmId: run.id, agentId: kind === 'agent' ? id ?? null : null, version: selectionVersion, container: $('trace-events'), count: $('trace-count'), rows: new Map() };
    if(!$<HTMLDialogElement>('detail').open) $<HTMLDialogElement>('detail').showModal();
    updateTraceView(state.events);
    return;
  }
  if(kind==='files') {
    title.textContent='Workspace files & claims';
    body.innerHTML=`<h3>EXCLUSIVE CLAIMS</h3>${state.detail.claims.length ? state.detail.claims.map(claim=>`<p>${badge(claim.ownerId)} <code>${escape(claim.path)}</code> <span class="muted">${escape(claim.reason)}</span></p>`).join(''):'<p class="muted">No files currently claimed.</p>'}<h3>CANONICAL FILES</h3>${state.detail.files.map(file=>`<div class="file-row"><code>${escape(file.path)}</code><span class="muted">r${file.revision} · ${count(file.size)} bytes</span><button data-preview="${escape(file.path)}">PREVIEW</button><button data-history="${escape(file.path)}">HISTORY</button><a href="/api/swarms/${encodeURIComponent(run.id)}/file?path=${encodeURIComponent(file.path)}" download>DOWNLOAD</a></div>`).join('') || '<p class="muted">No files published yet.</p>'}<div id="file-preview"></div>`;
  }
  if(!$<HTMLDialogElement>('detail').open) $<HTMLDialogElement>('detail').showModal();
}
function goal(run: SwarmRecord, open = true): string { return `<details class="goal-block" ${open ? 'open' : ''}><summary>STARTING GOAL · ${escape(run.spec.finalOutput)}</summary><h3>TASK</h3><div class="prose">${escape(run.spec.task)}</div><h3>DEFINITION OF DONE</h3><div class="prose">${escape(run.spec.definitionOfDone)}</div></details>`; }
function message(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong.'; }
async function handleClick(event: MouseEvent): Promise<void> {
  const button=(event.target as HTMLElement).closest<HTMLElement>('[data-view],[data-run],[data-thread],[data-agent],[data-action],[data-preview],[data-history]'); if(!button) return;
  if(button.dataset.view) { state.view=button.dataset.view as View; render(); if(state.view==='threads') await refreshThreads(); }
  if(button.dataset.run) await selectRun(button.dataset.run);
  if(button.dataset.thread) await showDetail('thread',button.dataset.thread);
  if(button.dataset.agent) await showDetail('agent',button.dataset.agent);
  const action=button.dataset.action;
  if(action && ['goal','files','trace'].includes(action)) await showDetail(action);
  if(action==='refresh-thread' && conversation) await refreshConversation();
  if(action==='refresh-trace' && state.dialog) await showDetail(state.dialog.kind,state.dialog.id);
  if(action==='expand-trace') $('detail-body').querySelectorAll('details').forEach(item=>item.open=true);
  if(action==='stop' && state.selected && confirm('Stop this swarm? Active requests retain any uncertain cost liability.')) { await api(`/api/swarms/${encodeURIComponent(state.selected)}/stop`,{reason:'Stopped from the dashboard.'});await refresh(); }
  if(button.dataset.preview && state.selected) {
    const container=$('file-preview'); container.replaceChildren(); const frame=document.createElement('iframe');frame.className='artifact-preview';frame.title=button.dataset.preview;frame.sandbox.add('allow-scripts');frame.src=`${previewOrigin}/artifact/${encodeURIComponent(state.selected)}/${button.dataset.preview.split('/').map(encodeURIComponent).join('/')}`;container.append(frame);
  }
  if(button.dataset.history && state.selected) {
    const version=selectionVersion; const dialog=state.dialog;
    const versions=await api<FileVersion[]>(`/api/swarms/${encodeURIComponent(state.selected)}/history?path=${encodeURIComponent(button.dataset.history)}`);
    if(selectionVersion!==version || state.dialog!==dialog || !$<HTMLDialogElement>('detail').open) return;
    $('file-preview').innerHTML=`<h3>${escape(button.dataset.history)} · HISTORY</h3>${versions.map(file=>`<div class="message"><strong>r${file.revision}</strong> ${escape(agent(file.authorId)?.name ?? file.authorId)} · ${new Date(file.createdAt).toLocaleString()}<p class="prose">${escape(file.reason)}${file.deleted?' (deleted)':''}</p></div>`).join('')}`;
  }
}
document.addEventListener('click',event=>{void handleClick(event).catch(error=>notice(message(error)));});
document.addEventListener('keydown',event=>{if(event.key==='/' && !['INPUT','TEXTAREA','SELECT'].includes((event.target as HTMLElement).tagName)){event.preventDefault();$('search').focus();}});
$('search').addEventListener('input',()=>{
  if(searchTimer) clearTimeout(searchTimer);
  threadRequestVersion += 1;
  if(state.view==='threads') {
    state.threads=[]; renderRows();
    searchTimer=setTimeout(()=>{void refreshThreads().catch(error=>notice(message(error)));},180);
  } else renderRows();
});
$('sort').addEventListener('change',renderRows);$('filter').addEventListener('change',renderRows);
$('close-detail').onclick=()=>{$<HTMLDialogElement>('detail').close();};
$('detail').addEventListener('close',()=>{if(!$<HTMLDialogElement>('detail').open){state.dialog=null;traceView=null;}});
$('operator-message').addEventListener('input',saveDraft);
$('close-conversation').onclick = () => { saveDraft(); conversation = null; render(); history.replaceState(null, '', `/?swarm=${encodeURIComponent(state.selected ?? '')}`); };
$('new-swarm').onclick=()=>$<HTMLDialogElement>('launch').showModal();$('close-launch').onclick=()=>$<HTMLDialogElement>('launch').close();
$('launch-form').addEventListener('submit',event=>{event.preventDefault();void launch().catch(error=>{$('launch-error').textContent=message(error);});});
async function launch(): Promise<void> {
  const form=$<HTMLFormElement>('launch-form');const data=new FormData(form);const opus=data.get('model')==='opus48';
  const result=await api<SwarmRecord>('/api/swarms',{title:data.get('title'),task:data.get('task'),definitionOfDone:data.get('definitionOfDone'),finalOutput:data.get('finalOutput'),agentCount:Number(data.get('agentCount')),budgetMicros:Math.round(Number(data.get('budget'))*1_000_000),...(String(data.get('workingTarget') ?? '').trim() ? {workingTargetMicros:Math.round(Number(data.get('workingTarget'))*1_000_000)} : {}),model:{provider:opus?'anthropic':'openai-codex',id:opus?'claude-opus-4-8':'gpt-5.5',thinking:'high'}});
  $<HTMLDialogElement>('launch').close();form.reset();$('launch-error').textContent='';await selectRun(result.id);notice('Swarm queued. An online worker will verify model access and isolation before execution.');
}
$('message-form').addEventListener('submit',event=>{event.preventDefault();void (async()=>{
  const current=conversation; if(!current)return;
  const input=$<HTMLTextAreaElement>('operator-message'); const body=input.value;
  await api(`/api/swarms/${encodeURIComponent(current.swarmId)}/messages`,{threadId:current.threadId,body});
  const key=`${current.swarmId}\0${current.threadId}`;
  if(drafts.get(key)===body) drafts.delete(key);
  if(conversation===current && input.value===body) input.value='';
  await refreshConversation(current); scheduleRefresh();
})().catch(error=>notice(message(error)));});
await refresh();
if(state.selected) await (async () => {
  await selectRun(state.selected!);
  const threadId = initialLocation.searchParams.get('thread');
  const messageId = initialLocation.searchParams.get('message');
  if (threadId) await showDetail('thread', threadId);
  if (messageId && /^[1-9][0-9]*$/.test(messageId)) await messageSearch.openContext(state.selected!, Number(messageId), '');
})().catch(error=>notice(message(error)));
setInterval(()=>{void refresh();},3000);
