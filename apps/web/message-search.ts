import type { MessageContext, MessageSearchHit, MessageSearchPage } from '@simpleswarm/swarm';

interface SearchDependencies {
  api: <T>(path: string) => Promise<T>;
  selected: () => string | null;
  openThread: (swarmId: string, threadId: string) => Promise<void>;
}

/** The dashboard owns this DOM; polling never replaces an active search or context. */
export function createMessageSearch(host: HTMLElement, dependencies: SearchDependencies) {
  host.innerHTML = `<form class="message-search-form"><label>Search message text<input name="query" required maxlength="200" placeholder="Find an idea, phrase or coordination pattern…"></label><label>Scope<select name="scope" aria-label="Scope"><option value="selected">Selected swarm</option><option value="all">All swarms</option></select></label><label>Author ID (optional)<input name="author" placeholder="Exact agent ID or operator"></label><button type="submit">SEARCH MESSAGES</button></form><p class="muted">Literal phrase search across full message bodies. ASCII ignores case; other characters match exactly.</p><div class="search-actions"><span role="status" data-search-status></span><button type="button" data-export hidden>EXPORT LOADED RESULTS · JSONL</button></div><div class="search-layout"><div><div data-results></div><button type="button" data-more hidden>LOAD MORE RESULTS</button></div><aside data-context aria-label="Message context" hidden></aside></div>`;
  const form = host.querySelector('form')!;
  const status = host.querySelector<HTMLElement>('[data-search-status]')!;
  const results = host.querySelector<HTMLElement>('[data-results]')!;
  const context = host.querySelector<HTMLElement>('[data-context]')!;
  const more = host.querySelector<HTMLButtonElement>('[data-more]')!;
  const download = host.querySelector<HTMLButtonElement>('[data-export]')!;
  let version = 0;
  let contextVersion = 0;
  let hits: MessageSearchHit[] = [];
  let next: number | null = null;
  let through: number | undefined;
  let parameters = new URLSearchParams();
  let query = '';
  let loading = false;

  function error(cause: unknown) { status.textContent = cause instanceof Error ? cause.message : 'Message search failed.'; }
  function highlighted(target: HTMLElement, text: string, phrase: string) {
    // SQLite lower() folds ASCII only; keep offsets and matching identical to the search service.
    const fold = (value: string) => value.replace(/[A-Z]/g, char => char.toLowerCase());
    const lower = fold(text); const needle = fold(phrase);
    let cursor = 0; let matches = 0;
    if (needle) for (let found = lower.indexOf(needle); found !== -1 && matches < 200; found = lower.indexOf(needle, cursor)) {
      target.append(document.createTextNode(text.slice(cursor, found)));
      const mark = document.createElement('mark'); mark.textContent = text.slice(found, found + needle.length); target.append(mark);
      cursor = found + needle.length;
      matches++;
    }
    target.append(document.createTextNode(text.slice(cursor)));
  }
  function contextUrl(swarmId: string, messageId: number) {
    const url = new URL('/', location.origin); url.searchParams.set('swarm', swarmId); url.searchParams.set('message', String(messageId)); return url;
  }
  async function openContext(swarmId: string, messageId: number, phrase = query) {
    const request = ++contextVersion;
    context.hidden = false; context.textContent = 'Loading nearby messages…';
    const data = await dependencies.api<MessageContext>(`/api/swarms/${encodeURIComponent(swarmId)}/message-context?message=${messageId}`).catch(cause => {
      if (request === contextVersion) { context.textContent = 'Unable to load message context.'; error(cause); }
      return null;
    });
    if (!data || request !== contextVersion) return;
    history.replaceState(null, '', contextUrl(swarmId, messageId));
    context.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = `${data.thread.title} · surrounding conversation`;
    const link = document.createElement('a'); link.href = contextUrl(swarmId, messageId).href; link.textContent = 'PERMANENT LINK';
    const full = document.createElement('button'); full.type = 'button'; full.textContent = 'OPEN FULL CONVERSATION';
    full.onclick = () => { void dependencies.openThread(swarmId, data.thread.id).catch(error); };
    context.append(heading, link, full);
    for (const item of data.messages) {
      const article = document.createElement('article'); article.className = 'message'; article.dataset.contextMessage = String(item.id);
      if (item.id === data.targetId) article.classList.add('target-message');
      const meta = document.createElement('div'); meta.className = 'row-meta'; meta.textContent = `${item.authorId} · ${new Date(item.createdAt).toLocaleString()} · #${item.id}${item.id === data.targetId ? ' · selected message' : ''}`;
      const body = document.createElement('div'); body.className = 'prose'; highlighted(body, item.body, phrase);
      article.append(meta, body); context.append(article);
    }
  }
  function appendHits(items: MessageSearchHit[]) {
    for (const item of items) {
      const article = document.createElement('article'); article.className = 'message search-hit'; article.dataset.searchId = String(item.searchId);
      const meta = document.createElement('div'); meta.className = 'row-meta'; meta.textContent = `${item.swarmTitle} / ${item.threadTitle} · ${item.authorName} · ${new Date(item.createdAt).toLocaleString()}`;
      const body = document.createElement('div'); body.className = 'prose';
      const folded = item.body.replace(/[A-Z]/g, char => char.toLowerCase());
      const index = folded.indexOf(query.replace(/[A-Z]/g, char => char.toLowerCase()));
      const start = Math.max(0, index - 140); const end = Math.min(item.body.length, Math.max(0, index) + query.length + 260);
      highlighted(body, `${start ? '…' : ''}${item.body.slice(start, end)}${end < item.body.length ? '…' : ''}`, query);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'VIEW CONTEXT';
      button.onclick = () => { void openContext(item.swarmId, item.id).catch(error); };
      article.append(meta, body, button); results.append(article);
    }
  }
  async function load(reset: boolean) {
    if (!reset && loading) return;
    if (reset) {
      version++; contextVersion++; loading = false; context.hidden = true;
      hits = []; results.replaceChildren(); next = null; through = undefined; download.hidden = true; more.hidden = true;
      const values = new FormData(form); query = String(values.get('query') ?? '').trim();
      if (!query) { status.textContent = 'Enter a phrase to search.'; return; }
      parameters = new URLSearchParams({ query, limit: '25' });
      if (values.get('scope') === 'selected') {
        const selected = dependencies.selected(); if (!selected) { status.textContent = 'Select a swarm or choose All swarms.'; return; }
        parameters.set('swarm', selected);
      }
      const author = String(values.get('author') ?? '').trim(); if (author) parameters.set('author', author);
    }
    loading = true; more.disabled = true; status.textContent = 'Searching full message text…';
    const request = version; const params = new URLSearchParams(parameters);
    if (!reset && next !== null) params.set('after', String(next));
    if (through !== undefined) params.set('through', String(through));
    try {
      const page = await dependencies.api<MessageSearchPage>(`/api/messages/search?${params}`);
      if (request !== version) return;
      through = page.through; next = page.next; hits.push(...page.messages); appendHits(page.messages);
      status.textContent = hits.length ? `${hits.length} matching messages loaded${next === null ? ' · end of snapshot' : ' · more available'}. Export includes loaded results only.` : 'No matching messages.';
      more.hidden = next === null; download.hidden = hits.length === 0;
    } catch (cause) { if (request === version) error(cause); }
    finally { if (request === version) { loading = false; more.disabled = false; } }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void load(true).catch(error); });
  more.onclick = () => { void load(false).catch(error); };
  download.onclick = () => {
    const blob = new Blob([hits.map(hit => JSON.stringify({ ...hit, contextUrl: contextUrl(hit.swarmId, hit.id).href, query, through })).join('\n') + '\n'], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'swarm-message-search.jsonl'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return {
    openContext,
    reset() { version++; contextVersion++; loading = false; hits = []; next = null; results.replaceChildren(); context.hidden = true; more.hidden = true; download.hidden = true; status.textContent = ''; },
  };
}
