import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSwarmStore, parseSwarmSpec, type SwarmRecord, type TraceEvent } from '@simpleswarm/swarm';
import { createWebServers } from '../../apps/web/server.ts';

export const webSpec = parseSwarmSpec({
  title: 'HTTP acceptance swarm', task: 'Produce an independently checked artifact.',
  definitionOfDone: 'The artifact is available with a review record.', finalOutput: 'index.html',
  agentCount: 2, model: { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' }, budgetMicros: 1_000_000,
});

async function availablePorts(): Promise<{ port: number; previewPort: number }> {
  const control = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('port allocation') });
  const preview = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('port allocation') });
  try {
    if (typeof control.port !== 'number' || typeof preview.port !== 'number') throw new Error('Unable to allocate TCP ports.');
    return { port: control.port, previewPort: preview.port };
  } finally { await Promise.all([control.stop(true), preview.stop(true)]); }
}

export async function openWebFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'simpleswarm-web-'));
  const databasePath = join(directory, 'swarms.sqlite');
  const ports = await availablePorts();
  let store = openSwarmStore(databasePath);
  const assets = { html: '<!doctype html><meta name="csrf" content="__CSRF__"><main>Swarm dashboard</main><iframe sandbox="allow-scripts" src="__PREVIEW_ORIGIN__"></iframe>', script: 'document.title = "Swarm dashboard";', styles: 'body { margin: 0; }' };
  let servers = createWebServers({ store, ...ports, ...assets });
  let cookie = '';
  let csrf = '';

  async function authenticate(): Promise<Response> {
    const response = await fetch(servers.origin);
    const setCookie = response.headers.get('set-cookie');
    if (response.status !== 200 || !setCookie) throw new Error('Dashboard did not provide an authentication cookie.');
    cookie = setCookie.split(';')[0] ?? '';
    const page = await response.clone().text();
    csrf = /name="csrf" content="([^"]+)"/.exec(page)?.[1] ?? '';
    if (!csrf) throw new Error('Dashboard did not provide its CSRF credential.');
    return response;
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has('cookie')) headers.set('cookie', cookie);
    return fetch(`${servers.origin}${path}`, { ...init, headers });
  }

  async function post(path: string, body: unknown, headers: HeadersInit = {}): Promise<Response> {
    const merged = new Headers({ 'content-type': 'application/json', origin: servers.origin, 'x-swarm-csrf': csrf });
    new Headers(headers).forEach((value, key) => merged.set(key, value));
    return request(path, { method: 'POST', headers: merged, body: JSON.stringify(body) });
  }

  async function launch(overrides: Partial<typeof webSpec> = {}): Promise<SwarmRecord> {
    const response = await post('/api/swarms', { ...webSpec, ...overrides });
    const result: unknown = await response.json();
    if (response.status !== 201 || typeof result !== 'object' || result === null || !('id' in result) || typeof result.id !== 'string') throw new Error(`HTTP swarm launch failed: ${JSON.stringify(result)}`);
    return store.getSwarm(result.id);
  }

  async function restart(): Promise<void> {
    servers.stop();
    store.close();
    store = openSwarmStore(databasePath);
    servers = createWebServers({ store, ...ports, ...assets });
    await authenticate();
  }

  async function close(): Promise<void> {
    servers.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }

  try { await authenticate(); } catch (error) { await close(); throw error; }
  return { get store() { return store; }, get servers() { return servers; }, get cookie() { return cookie; }, get csrf() { return csrf; }, request, post, launch, authenticate, restart, close };
}

export type WebFixture = Awaited<ReturnType<typeof openWebFixture>>;

export async function readEvents(response: Response, count: number): Promise<Array<Omit<TraceEvent, 'payload'> & { payload: unknown }>> {
  if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new Error(`Expected an SSE response, received ${response.status}.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: Array<Omit<TraceEvent, 'payload'> & { payload: unknown }> = [];
  let pending = '';
  try {
    while (events.length < count) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE ended before the requested events arrived.');
      pending += decoder.decode(chunk.value, { stream: true });
      let separator = pending.indexOf('\n\n');
      while (separator >= 0) {
        const frame = pending.slice(0, separator);
        pending = pending.slice(separator + 2);
        const id = /^id: (\d+)$/m.exec(frame)?.[1];
        const payload = /^data: (.+)$/m.exec(frame)?.[1];
        if (id && payload) {
          const event: unknown = JSON.parse(payload);
          if (typeof event !== 'object' || event === null || !('seq' in event) || event.seq !== Number(id) || !('kind' in event) || typeof event.kind !== 'string' || !('swarmId' in event) || typeof event.swarmId !== 'string' || !('agentId' in event) || (event.agentId !== null && typeof event.agentId !== 'string') || !('createdAt' in event) || typeof event.createdAt !== 'number' || !('payload' in event)) throw new Error('SSE frame does not identify a complete trace event.');
          events.push({ seq: Number(id), kind: event.kind, swarmId: event.swarmId, agentId: event.agentId, createdAt: event.createdAt, payload: event.payload });
          if (events.length === count) return events;
        }
        separator = pending.indexOf('\n\n');
      }
    }
    return events;
  } finally { await reader.cancel(); reader.releaseLock(); }
}
