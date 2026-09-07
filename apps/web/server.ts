import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { BoardMessage, SwarmStore, ThreadRecord } from '@simpleswarm/swarm';
import { parseSwarmSpec, SwarmError, normalizeWorkspacePath } from '@simpleswarm/swarm';

export interface WebOptions { store: SwarmStore; port: number; previewPort: number; html: string; script: string; styles: string }
const terminalStatuses = new Set(['completed', 'bailed', 'failed', 'cancelled', 'budget_exhausted', 'interrupted']);
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function createWebServers(options: WebOptions) {
  const { store, port, previewPort } = options;
  const origin = `http://127.0.0.1:${port}`;
  const previewOrigin = `http://127.0.0.1:${previewPort}`;
  const token = randomBytes(32).toString('hex');
  const messageIndex = createMessageIndex(store);
  const cookieName = `swarm_${port}`;
  const controlCsp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src ${previewOrigin}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  function controlResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    headers.set('Content-Security-Policy', controlCsp);
    return new Response(body, { ...init, headers });
  }
  function json(value: unknown, status = 200): Response { return controlResponse(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
  function authenticated(request: Request): boolean {
    const credential = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
    return equalSecret(credential, token);
  }
  async function fetchControl(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('host') !== `127.0.0.1:${port}`) return json({ error: 'Use the loopback dashboard address.' }, 403);
    if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Cross-site access denied.' }, 403);
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin !== null && requestOrigin !== origin) return json({ error: 'Foreign origin denied.' }, 403);
    if (request.method === 'GET' && url.pathname === '/') {
      return controlResponse(options.html.replaceAll('__CSRF__', token).replaceAll('__PREVIEW_ORIGIN__', previewOrigin), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/` },
      });
    }
    if (request.method === 'GET' && url.pathname === '/app.js') return controlResponse(options.script, { headers: { 'Content-Type': 'text/javascript' } });
    if (request.method === 'GET' && url.pathname === '/styles.css') return controlResponse(options.styles, { headers: { 'Content-Type': 'text/css' } });
    if (!authenticated(request)) return json({ error: 'Open the dashboard to authenticate.' }, 401);
    if (request.method !== 'GET' && (request.headers.get('origin') !== origin || !equalSecret(request.headers.get('x-swarm-csrf') ?? '', token))) return json({ error: 'Same-origin confirmation missing.' }, 403);
    try {
      if (url.pathname === '/api/workers' && request.method === 'GET') return json(store.listWorkers());
      if (url.pathname === '/api/swarms' && request.method === 'GET') return json(store.listSwarms());
      if (url.pathname === '/api/swarms' && request.method === 'POST') return json(store.createSwarm(parseSwarmSpec(await readJson(request))), 201);
      const route = /^\/api\/swarms\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
      if (!route?.[1]) return json({ error: 'Not found.' }, 404);
      const id = decodeURIComponent(route[1]);
      const action = route[2] ?? '';
      const run = store.getSwarm(id);
      if (request.method === 'GET') {
        if (!action) return json({ run, threads: store.threads(id), claims: store.claims(id), files: store.files(id).map(({ contentBase64: _, ...file }) => file) });
        if (action === 'threads') {
          const query = (url.searchParams.get('query') ?? '').trim().toLocaleLowerCase();
          if (query.length > 200) throw new Error('Thread search is limited to 200 characters.');
          const after = integerQuery(url.searchParams.get('after'), 0);
          const threads = store.threads(id);
          const page = threads.slice(after, after + 100);
          const names = new Map(run.agents.map(agent => [agent.id, agent.name]));
          return json({ threads: page.flatMap(thread => {
            const indexed = messageIndex.read(id, thread);
            const metadata = `${thread.title} ${thread.members.map(member => names.get(member) ?? '').join(' ')}`.toLocaleLowerCase();
            if (query && !metadata.includes(query) && !messageIndex.matches(id, thread, indexed, query)) return [];
            return [{ ...thread, lastMessage: indexed.latest }];
          }), next: after + page.length < threads.length ? after + page.length : null });
        }
        if (action === 'events') return eventStream(request, store, id, url.searchParams.get('after'), controlResponse);
        if (action === 'trace') return json(store.events(id, integerQuery(url.searchParams.get('after'), 0), 1000));
        if (action === 'messages') return json(store.messages(id, url.searchParams.get('thread') ?? '', integerQuery(url.searchParams.get('after'), 0)));
        if (action === 'message-page') return json(messagePage(store.messages(id, url.searchParams.get('thread') ?? '', integerQuery(url.searchParams.get('after'), 0))));
        if (action === 'reservations') return json(store.reservations(id));
        if (action === 'history') return json(store.fileHistory(id, normalizeWorkspacePath(url.searchParams.get('path') ?? '')));
        if (action === 'file') {
          const path = normalizeWorkspacePath(url.searchParams.get('path') ?? '');
          const file = store.readFile(id, path);
          const filename = path.split('/').at(-1)!.replace(/[^a-zA-Z0-9._-]/g, '_');
          return controlResponse(Buffer.from(file.contentBase64, 'base64'), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${filename}"` } });
        }
      }
      if (request.method === 'POST' && action === 'stop') {
        const body = await readJson(request);
        return json(store.stopSwarm(id, readString(body, 'reason', 'Stopped by operator.')));
      }
      if (request.method === 'POST' && action === 'messages') {
        if (terminalStatuses.has(run.status)) return json({ error: 'This swarm has ended.' }, 409);
        const body = await readJson(request);
        return json(store.postOperator(id, readString(body, 'threadId'), readString(body, 'body')), 201);
      }
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      const code = error instanceof SwarmError ? error.code : 'invalid_request';
      const status = code.includes('not_found') ? 404 : code.includes('conflict') ? 409 : 400;
      return json({ error: error instanceof Error ? error.message : 'Request failed.', code }, status);
    }
  }
  const preview = Bun.serve({ hostname: '127.0.0.1', port: previewPort, fetch(request) {
    const headers = { ...securityHeaders, 'Cross-Origin-Resource-Policy': 'cross-origin', 'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'" };
    if (request.headers.get('host') !== `127.0.0.1:${previewPort}` || request.method !== 'GET') return new Response('Forbidden', { status: 403, headers });
    try {
      const match = /^\/artifact\/([^/]+)\/(.+)$/.exec(new URL(request.url).pathname);
      if (!match?.[1] || !match[2]) return new Response('Not found', { status: 404, headers });
      const file = store.readFile(decodeURIComponent(match[1]), normalizeWorkspacePath(decodeURIComponent(match[2])));
      return new Response(Buffer.from(file.contentBase64, 'base64'), { headers: { ...headers, 'Content-Type': contentType(file.path) } });
    } catch { return new Response('Not found', { status: 404, headers }); }
  } });
  let control;
  try { control = Bun.serve({ hostname: '127.0.0.1', port, fetch: fetchControl, idleTimeout: 30 }); }
  catch (error) { preview.stop(true); throw error; }
  return { control, preview, origin, previewOrigin, stop() { control.stop(true); preview.stop(true); } };
}

interface IndexedThread {
  count: number;
  cursor: number;
  latest: Pick<BoardMessage, 'id' | 'authorId' | 'createdAt' | 'body'> | null;
  bodies: string[] | null;
  characters: number;
}

function createMessageIndex(store: SwarmStore) {
  const cache = new Map<string, IndexedThread>();
  let characters = 0;
  function read(swarmId: string, thread: ThreadRecord): IndexedThread {
    const key = `${swarmId}\0${thread.id}`;
    const previous = cache.get(key);
    const indexed: IndexedThread = previous ?? { count: 0, cursor: 0, latest: null, bodies: [], characters: 0 };
    if (previous) { characters -= previous.characters; cache.delete(key); }
    if (indexed.count < thread.messageCount) {
      for (const message of store.messages(swarmId, thread.id, indexed.cursor)) {
        indexed.count += 1;
        indexed.cursor = message.id;
        indexed.latest = { id: message.id, authorId: message.authorId, createdAt: message.createdAt, body: message.body.replace(/\s+/g, ' ').slice(0, 512) };
        if (indexed.bodies !== null) {
          const body = message.body.toLocaleLowerCase();
          if (indexed.characters + body.length > 1_000_000) { indexed.bodies = null; indexed.characters = 0; }
          else { indexed.bodies.push(body); indexed.characters += body.length; }
        }
      }
    }
    cache.set(key, indexed);
    characters += indexed.characters;
    while (cache.size > 128 || characters > 8_000_000) {
      const oldest = cache.entries().next().value;
      if (!oldest) break;
      cache.delete(oldest[0]); characters -= oldest[1].characters;
    }
    return indexed;
  }
  function matches(swarmId: string, thread: ThreadRecord, indexed: IndexedThread, query: string): boolean {
    if (indexed.bodies !== null) return indexed.bodies.some(body => body.includes(query));
    // Oversized threads remain fully searchable without retaining their full text in the cache.
    return store.messages(swarmId, thread.id).some(message => message.body.toLocaleLowerCase().includes(query));
  }
  return { read, matches };
}

function messagePage(messages: BoardMessage[]): { messages: BoardMessage[]; next: number | null } {
  const page: BoardMessage[] = [];
  let bytes = 0;
  for (const message of messages) {
    const size = Buffer.byteLength(JSON.stringify(message));
    if (page.length > 0 && (page.length === 100 || bytes + size > 1_000_000)) break;
    page.push(message); bytes += size;
  }
  return { messages: page, next: page.length < messages.length ? page.at(-1)?.id ?? null : null };
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Use a JSON request body.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body required.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 256_000) { await reader.cancel(); throw new Error('Request body exceeds 256 KB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function readString(value: unknown, field: string, fallback?: string): string {
  const candidate = typeof value === 'object' && value !== null && field in value ? (value as Record<string, unknown>)[field] : fallback;
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error(`${field} is required.`);
  return candidate;
}

function integerQuery(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid event cursor.');
  return number;
}

function eventStream(request: Request, store: SwarmStore, id: string, after: string | null, respond: (body: BodyInit | null, init?: ResponseInit) => Response): Response {
  let cursor = integerQuery(request.headers.get('last-event-id') ?? after, 0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const encoder = new TextEncoder();
  const stop = () => { stopped = true; if (timer) clearInterval(timer); request.signal.removeEventListener('abort', stop); };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const tick = () => {
        if (stopped) return;
        try {
          for (const event of store.events(id, cursor, 200)) {
            controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: trace\ndata: ${JSON.stringify(event)}\n\n`));
            cursor = event.seq;
          }
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch { stop(); controller.close(); }
      };
      timer = setInterval(tick, 1000);
      request.signal.addEventListener('abort', stop, { once: true });
      tick();
    }, cancel: stop,
  });
  return respond(stream, { headers: { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' } });
}

function contentType(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  return ({ html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', js: 'text/javascript', css: 'text/css', json: 'application/json', txt: 'text/plain', mp4: 'video/mp4' } as Record<string, string>)[extension] ?? 'application/octet-stream';
}
