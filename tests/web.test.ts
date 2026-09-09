import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MessageContext, MessageSearchPage, SwarmRecord } from '@simpleswarm/swarm';
import { openWebFixture, readEvents, webSpec, type WebFixture } from './helpers/web-fixture.ts';

let fixture: WebFixture;
beforeEach(async () => { fixture = await openWebFixture(); });
afterEach(async () => { await fixture?.close(); });

function actor(run: SwarmRecord) {
  const agent = run.agents[0];
  if (!agent) throw new Error('Fixture needs at least one agent.');
  return { swarmId: run.id, agentId: agent.id };
}

function startRuns(...runs: SwarmRecord[]): void {
  fixture.store.registerWorker('http-test-worker', process.pid);
  for (const run of runs) {
    expect(fixture.store.claimNextSwarm('http-test-worker')?.id).toBe(run.id);
    fixture.store.startAgent(actor(run), `session-${run.id}`);
  }
}

describe('run diagnostics HTTP', () => {
  test('shows an ordinary failed shell result and explicit bail without changing recorded history', async () => {
    const run = await fixture.launch(); startRuns(run);
    const peer = actor(run);
    fixture.store.appendEvent(run.id, peer.agentId, 'tool_execution_start', { toolCallId: 'shell-1', toolName: 'bash', arguments: '{}' });
    fixture.store.appendEvent(run.id, peer.agentId, 'tool_execution_end', { toolCallId: 'shell-1', toolName: 'bash', isError: false,
      result: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ exitCode: 1, stderr: 'missing temporary draft', stdout: '', versions: [] }) }] }) });
    fixture.store.appendEvent(run.id, peer.agentId, 'agent_stop', { origin: 'agent', code: 'agent_bailed', status: 'bailed', reason: 'Cannot find the published artifact', turn: 3, budget: { ...fixture.store.budget(run.id) } });
    fixture.store.endAgent(peer, 'bailed', 'Cannot find the published artifact');
    fixture.store.finishSwarm(run.id, 'bailed', 'Peer reported a blocker');
    const before = fixture.store.events(run.id);
    const response = await fixture.request(`/api/swarms/${run.id}/diagnostics`);
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.metrics.toolFailures).toBe(1);
    expect(report.stops[0]).toMatchObject({ origin: 'agent', reason: 'Cannot find the published artifact', turn: 3 });
    expect(report.stops[0].lastTool).toMatchObject({ name: 'bash', failed: true, exitCode: 1 });
    expect(report.truncated).toBe(false);
    expect(fixture.store.events(run.id)).toEqual(before);
    await fixture.restart();
    expect(await (await fixture.request(`/api/swarms/${run.id}/diagnostics`)).json()).toEqual(report);
  });
  test('diagnostics remain authenticated, read-only and scoped to an existing swarm', async () => {
    const run = await fixture.launch();
    const path = `/api/swarms/${run.id}/diagnostics`;
    expect((await fixture.request(path, { headers: { cookie: '' } })).status).toBe(401);
    expect((await fixture.request(path, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fixture.post(path, {})).status).toBe(404);
    expect((await fixture.request('/api/swarms/missing/diagnostics')).status).toBe(404);
  });
  test('reads stop evidence beyond the first trace page without returning assistant content', async () => {
    const run = await fixture.launch(); startRuns(run); const peer = actor(run);
    for (let index = 0; index < 1002; index++) fixture.store.appendEvent(run.id, peer.agentId, 'assistant_message', { content: 'private-trace-marker' });
    fixture.store.appendEvent(run.id, peer.agentId, 'agent_stop', { origin: 'runtime', code: 'turn_limit', status: 'stalled', reason: 'Maximum model turns reached.', turn: 101, budget: { ...fixture.store.budget(run.id) } });
    fixture.store.endAgent(peer, 'stalled', 'Maximum model turns reached.');
    fixture.store.finishSwarm(run.id, 'failed', 'Maximum model turns reached.');
    const readEvents = fixture.store.events.bind(fixture.store); let historyReads = 0;
    fixture.store.events = (...args) => { historyReads++; return readEvents(...args); };
    const report = await (await fixture.request(`/api/swarms/${run.id}/diagnostics`)).json();
    expect(historyReads).toBe(1);
    expect(report.eventCount).toBeGreaterThan(1002);
    expect(report.stops[0]).toMatchObject({ origin: 'runtime', code: 'turn_limit', turn: 101 });
    expect(report.truncated).toBe(false);
    expect(JSON.stringify(report)).not.toContain('private-trace-marker');
  });
});

describe('cross-board message search HTTP', () => {
  test('searches complete historical bodies across swarms with stable snapshots and context links', async () => {
    const first = await fixture.launch({ title: 'First search mission' });
    const second = await fixture.launch({ title: 'Second search mission' });
    startRuns(first, second);
    const board = fixture.store.createThread(actor(first), 'Earlier discussion');
    const secondBoard = fixture.store.threads(second.id)[0]!;
    fixture.store.renameAgent(actor(first), 'Geometry Reviewer');
    const hidden = fixture.store.post(actor(first), board.id, `${'Long context '.repeat(1000)}FindThis <img src=x onerror=alert(1)> 100%_done`);
    fixture.store.post(actor(first), board.id, 'Latest message hides the earlier search match.');
    fixture.store.postOperator(second.id, secondBoard.id, 'findthis on the other board');
    const response = await fixture.request('/api/messages/search?query=FINDTHIS&limit=1');
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const page: MessageSearchPage = await response.json();
    expect(page.messages[0]).toMatchObject({ ...hidden, swarmTitle: first.spec.title, threadTitle: board.title, authorName: 'Geometry Reviewer' });
    const firstHit = page.messages[0];
    if (!firstHit) throw new Error('Expected a full-body search hit.');
    expect(page.next).toBe(firstHit.searchId);
    fixture.store.postOperator(second.id, secondBoard.id, 'findthis newly appended');
    const continued: MessageSearchPage = await (await fixture.request(`/api/messages/search?query=findthis&limit=1&after=${page.next}&through=${page.through}`)).json();
    expect(continued.messages).toHaveLength(1); expect(continued.messages[0]?.body).toBe('findthis on the other board');
    expect(continued.next).toBeNull(); expect(continued.through).toBe(page.through);
    const context: MessageContext = await (await fixture.request(`/api/swarms/${first.id}/message-context?message=${hidden.id}`)).json();
    expect(context.thread.id).toBe(board.id); expect(context.targetId).toBe(hidden.id);
    expect(context.messages.map(message => message.body)).toEqual([hidden.body, 'Latest message hides the earlier search match.']);
    const scoped: MessageSearchPage = await (await fixture.request(`/api/messages/search?${new URLSearchParams({ query: 'findthis', swarm: first.id, author: actor(first).agentId })}`)).json();
    expect(scoped.messages.map(message => message.id)).toEqual([hidden.id]);
    const operators: MessageSearchPage = await (await fixture.request('/api/messages/search?query=findthis&author=operator')).json();
    expect(operators.messages.map(message => message.body)).toEqual(['findthis on the other board', 'findthis newly appended']);
    const literal: MessageSearchPage = await (await fixture.request(`/api/messages/search?${new URLSearchParams({ query: '100%_done' })}`)).json();
    expect(literal.messages.map(message => message.body)).toEqual([hidden.body]);
  });
  test('enforces authentication, request bounds, and missing or foreign context without writes', async () => {
    const first = await fixture.launch(); const second = await fixture.launch();
    const board = fixture.store.threads(first.id)[0]!;
    const target = fixture.store.postOperator(first.id, board.id, "literal ' OR 1=1 --");
    const events = fixture.store.events(first.id);
    const paths = ['/api/messages/search?query=literal', `/api/swarms/${first.id}/message-context?message=${target.id}`];
    for (const path of paths) {
      expect((await fixture.request(path, { headers: { cookie: '' } })).status).toBe(401);
      expect((await fixture.request(path, { headers: { host: 'evil.example' } })).status).toBe(403);
      expect((await fixture.request(path, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
      expect((await fixture.request(path, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    }
    for (const suffix of ['', '?query=', '?query=%20', `?query=${'x'.repeat(201)}`, '?query=x&limit=0', '?query=x&limit=51', '?query=x&after=-1', '?query=x&through=999', '?query=x&after=1.2']) {
      expect((await fixture.request(`/api/messages/search${suffix}`)).status).toBe(400);
    }
    expect((await fixture.request(`/api/swarms/${second.id}/message-context?message=${target.id}`)).status).toBe(404);
    expect((await fixture.request(`/api/swarms/missing/message-context?message=${target.id}`)).status).toBe(404);
    expect((await fixture.request(`/api/swarms/${first.id}/message-context?message=999`)).status).toBe(404);
    expect((await fixture.request(`/api/swarms/${first.id}/message-context`)).status).toBe(400);
    expect((await fixture.request(`/api/swarms/${first.id}/message-context?message=1.2`)).status).toBe(400);
    const literal: MessageSearchPage = await (await fixture.request(`/api/messages/search?${new URLSearchParams({ query: "' OR 1=1 --" })}`)).json();
    expect(literal.messages.map(message => message.body)).toEqual([target.body]);
    expect(fixture.store.events(first.id)).toEqual(events);
  });
});

describe('FR-36 control HTTP authentication and request boundaries', () => {
  test('bootstraps an HttpOnly Strict cookie and embeds its CSRF credential on loopback', async () => {
    const response = await fixture.authenticate();
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(fixture.csrf).toMatch(/^[a-f0-9]{64}$/);
    const html = await response.text();
    expect(html).toContain(fixture.csrf);
    expect(html).not.toContain('__CSRF__');
    expect(html).toContain(fixture.servers.previewOrigin);
    expect(fixture.servers.control.hostname).toBe('127.0.0.1');
    expect(fixture.servers.preview.hostname).toBe('127.0.0.1');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('content-security-policy')).toContain(`frame-src ${fixture.servers.previewOrigin}`);
  });

  test('rejects unauthenticated reads, writes, downloads and event streams without changing durable state', async () => {
    const run = await fixture.launch();
    fixture.store.seedFiles(run.id, [{ path: 'artifact.txt', baseRevision: 0, contentBase64: 'c2VjcmV0' }]);
    const before = fixture.store.events(run.id);
    for (const path of ['/api/swarms', '/api/workers', `/api/swarms/${run.id}`, `/api/swarms/${run.id}/file?path=artifact.txt`, `/api/swarms/${run.id}/events`]) {
      const response = await fixture.request(path, { headers: { cookie: '' } });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain('c2VjcmV0');
    }
    expect((await fixture.post(`/api/swarms/${run.id}/stop`, { reason: 'unauthenticated' }, { cookie: '' })).status).toBe(401);
    expect((await fixture.request('/api/swarms', { headers: { cookie: `${fixture.cookie}wrong` } })).status).toBe(401);
    expect(fixture.store.events(run.id)).toEqual(before);
    expect(fixture.store.getSwarm(run.id).status).toBe('queued');
  });

  test('rejects foreign Host, foreign or null Origin, and cross-site reads including bootstrap', async () => {
    for (const host of ['evil.example', 'localhost', '127.0.0.1.evil.example']) {
      expect((await fixture.request('/api/swarms', { headers: { host } })).status).toBe(403);
      expect((await fixture.request('/', { headers: { host } })).status).toBe(403);
    }
    for (const origin of ['https://evil.example', 'null', fixture.servers.previewOrigin]) {
      expect((await fixture.request('/api/swarms', { headers: { origin, 'sec-fetch-site': 'same-site' } })).status).toBe(403);
    }
    expect((await fixture.request('/api/swarms', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    const rejectedBootstrap = await fixture.request('/', { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(rejectedBootstrap.status).toBe(403);
    expect(rejectedBootstrap.headers.get('set-cookie')).toBeNull();
    expect((await fixture.request('/api/swarms')).status).toBe(200);
    expect((await fixture.request('/api/swarms', { headers: { origin: fixture.servers.origin, 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
  });

  test('requires both correct Origin and CSRF for launch, messages and stop', async () => {
    const run = await fixture.launch();
    const thread = fixture.store.threads(run.id)[0];
    if (!thread) throw new Error('Expected a mission thread.');
    const before = fixture.store.events(run.id);
    const operations = [
      { path: '/api/swarms', body: webSpec },
      { path: `/api/swarms/${run.id}/messages`, body: { threadId: thread.id, body: 'should not arrive' } },
      { path: `/api/swarms/${run.id}/stop`, body: { reason: 'should not stop' } },
    ];
    const invalidHeaders: HeadersInit[] = [
      { origin: '', 'x-swarm-csrf': fixture.csrf },
      { origin: 'https://evil.example', 'x-swarm-csrf': fixture.csrf },
      { origin: fixture.servers.origin, 'x-swarm-csrf': '' },
      { origin: fixture.servers.origin, 'x-swarm-csrf': 'wrong' },
      { origin: fixture.servers.origin, 'x-swarm-csrf': fixture.csrf, 'sec-fetch-site': 'cross-site' },
    ];
    for (const operation of operations) {
      for (const headers of invalidHeaders) expect((await fixture.post(operation.path, operation.body, headers)).status).toBe(403);
    }
    expect(fixture.store.listSwarms()).toHaveLength(1);
    expect(fixture.store.events(run.id)).toEqual(before);
    expect(fixture.store.messages(run.id, thread.id)).toEqual([]);
  });

  test('rejects malformed, wrong-media-type and oversized bodies without partially creating a run', async () => {
    const headers = { origin: fixture.servers.origin, 'x-swarm-csrf': fixture.csrf, 'content-type': 'application/json' };
    for (const body of ['', '{bad json', 'null', '[]', '42', JSON.stringify({ ...webSpec, task: 'x'.repeat(256_001) })]) {
      const response = await fixture.request('/api/swarms', { method: 'POST', headers, body });
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(fixture.store.listSwarms()).toEqual([]);
    }
    const text = await fixture.request('/api/swarms', { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: JSON.stringify(webSpec) });
    expect(text.status).toBe(400);
    expect(fixture.store.listSwarms()).toEqual([]);
    const healthy = await fixture.launch();
    expect(healthy.status).toBe('queued');
  });

  test('rejects semantically invalid launch settings without changing persisted runs', async () => {
    const existing = await fixture.launch();
    const invalid = [
      { agentCount: 0 }, { agentCount: 101 }, { budgetMicros: 0 }, { budgetMicros: -1 },
      { model: { provider: 'anthropic', id: 'invented-model', thinking: 'high' } },
      { model: { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'low' } },
      { finalOutput: '../escape' }, { task: '' }, { definitionOfDone: '' }, { unexpected: true },
    ];
    for (const overrides of invalid) expect((await fixture.post('/api/swarms', { ...webSpec, ...overrides })).status).toBe(400);
    expect(fixture.store.listSwarms()).toEqual([existing]);
  });
});

describe('FR-34/35 actual swarm HTTP operations and artifacts', () => {
  test('searches scoped full message contents and returns only bounded latest-message summaries', async () => {
    const first = await fixture.launch();
    const second = await fixture.launch();
    startRuns(first, second);
    const thread = fixture.store.createThread(actor(first), 'Composition review');
    const foreign = fixture.store.createThread(actor(second), 'Foreign review');
    fixture.store.post(actor(first), thread.id, `${'earlier '.repeat(150)}The iridescent beak geometry is the search target.`);
    fixture.store.post(actor(second), foreign.id, 'Only the foreign swarm contains secret blue whales.');
    const latest = fixture.store.post(actor(first), thread.id, `<svg onload=alert(1)>${'latest '.repeat(150)}`);
    const response = await fixture.request(`/api/swarms/${first.id}/threads?query=IRIDESCENT%20BEAK%20GEOMETRY`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ threads: [{ ...fixture.store.threads(first.id).find(candidate => candidate.id === thread.id), lastMessage: { id: latest.id, authorId: latest.authorId, createdAt: latest.createdAt, body: latest.body.replace(/\s+/g, ' ').slice(0, 512) } }], next: null });
    const appended = fixture.store.post(actor(first), thread.id, 'A newly arrived message introduces lavender bicycle spokes.');
    expect(await (await fixture.request(`/api/swarms/${first.id}/threads?query=lavender`)).json()).toMatchObject({ threads: [{ id: thread.id, lastMessage: { id: appended.id, body: appended.body } }], next: null });
    expect(await (await fixture.request(`/api/swarms/${first.id}/threads?query=secret%20blue%20whales`)).json()).toEqual({ threads: [], next: null });
    expect((await fixture.request(`/api/swarms/${first.id}/threads?query=${'x'.repeat(201)}`)).status).toBe(400);
    expect((await fixture.request(`/api/swarms/${first.id}/threads?after=-1`)).status).toBe(400);
    expect((await fixture.request(`/api/swarms/${first.id}/threads`, { headers: { cookie: '' } })).status).toBe(401);
  });

  test('retains full-content search when a thread exceeds the retained-text cache limit', async () => {
    const run = await fixture.launch();
    startRuns(run);
    const thread = fixture.store.createThread(actor(run), 'Large conversation');
    for (let index = 0; index < 6; index += 1) fixture.store.post(actor(run), thread.id, `${'x'.repeat(190_000)}${index === 0 ? ' distant-cache-boundary-needle' : ' later message'}`);
    const response = await fixture.request(`/api/swarms/${run.id}/threads?query=distant-cache-boundary-needle`);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(Buffer.byteLength(text)).toBeLessThan(10_000);
    expect(JSON.parse(text)).toMatchObject({ threads: [{ id: thread.id, messageCount: 6 }], next: null });
  }, 15000);

  test('continues thread search past an empty first page without expanding the response bound', async () => {
    const run = await fixture.launch();
    startRuns(run);
    let lastThread = '';
    for (let index = 0; index < 105; index += 1) lastThread = fixture.store.createThread(actor(run), `Review group ${index}`).id;
    fixture.store.post(actor(run), lastThread, 'The distant-page-marker is only in the last conversation.');
    const first = await fixture.request(`/api/swarms/${run.id}/threads?query=distant-page-marker`);
    expect(await first.json()).toEqual({ threads: [], next: 100 });
    const second = await fixture.request(`/api/swarms/${run.id}/threads?query=distant-page-marker&after=100`);
    expect(await second.json()).toMatchObject({ threads: [{ id: lastThread }], next: null });
    const unfiltered = await fixture.request(`/api/swarms/${run.id}/threads`);
    expect(await unfiltered.json()).toMatchObject({ threads: fixture.store.threads(run.id).slice(0, 100).map(thread => ({ ...thread, lastMessage: null })), next: 100 });
  }, 15000);

  test('pages conversations by scoped message cursor and bounds each returned batch', async () => {
    const run = await fixture.launch();
    startRuns(run);
    const thread = fixture.store.createThread(actor(run), 'Paged conversation');
    for (let index = 0; index < 105; index += 1) fixture.store.post(actor(run), thread.id, `Message ${index}`);
    const expected = fixture.store.messages(run.id, thread.id);
    const first = await fixture.request(`/api/swarms/${run.id}/message-page?thread=${encodeURIComponent(thread.id)}`);
    expect(await first.json()).toEqual({ messages: expected.slice(0, 100), next: expected[99]?.id });
    const second = await fixture.request(`/api/swarms/${run.id}/message-page?thread=${encodeURIComponent(thread.id)}&after=${expected[99]?.id}`);
    expect(await second.json()).toEqual({ messages: expected.slice(100), next: null });
    const empty = await fixture.request(`/api/swarms/${run.id}/message-page?thread=${encodeURIComponent(thread.id)}&after=${expected.at(-1)?.id}`);
    expect(await empty.json()).toEqual({ messages: [], next: null });
    expect((await fixture.request(`/api/swarms/${run.id}/message-page?thread=foreign`)).status).toBe(404);

    const large = fixture.store.createThread(actor(run), 'Byte-bounded conversation');
    for (let index = 0; index < 3; index += 1) fixture.store.post(actor(run), large.id, '\u{10400}'.repeat(95_000));
    const bounded = await fixture.request(`/api/swarms/${run.id}/message-page?thread=${encodeURIComponent(large.id)}`);
    const body = await bounded.text();
    expect(Buffer.byteLength(body)).toBeLessThan(1_000_000);
    expect(JSON.parse(body)).toMatchObject({ messages: fixture.store.messages(run.id, large.id).slice(0, 2), next: fixture.store.messages(run.id, large.id)[1]?.id });
  }, 15000);

  test('launches a queued run, posts as operator, and records targeted stop behavior', async () => {
    const run = await fixture.launch({ title: 'Operator workflow' });
    const other = await fixture.launch({ title: 'Unaffected run' });
    startRuns(run);
    const thread = fixture.store.threads(run.id)[0];
    if (!thread) throw new Error('Expected a mission thread.');
    const message = await fixture.post(`/api/swarms/${run.id}/messages`, { threadId: thread.id, body: 'Please review the canvas.', authorId: actor(run).agentId });
    expect(message.status).toBe(201);
    expect(await message.json()).toMatchObject({ swarmId: run.id, threadId: thread.id, authorId: 'operator', body: 'Please review the canvas.' });
    expect(fixture.store.messages(run.id, thread.id)).toHaveLength(1);
    const stopped = await fixture.post(`/api/swarms/${run.id}/stop`, { reason: 'Operator requested a review pause.' });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ id: run.id, status: 'stopping', reason: 'Operator requested a review pause.' });
    expect(fixture.store.events(run.id).some(event => event.kind === 'swarm_stopping')).toBe(true);
    expect(fixture.store.getSwarm(other.id).status).toBe('queued');
    expect((await fixture.post(`/api/swarms/${other.id}/stop`, {})).status).toBe(200);
    expect(fixture.store.getSwarm(other.id).status).toBe('cancelled');
    const endedThread = fixture.store.threads(other.id)[0];
    if (!endedThread) throw new Error('Expected a mission thread.');
    expect((await fixture.post(`/api/swarms/${other.id}/messages`, { threadId: endedThread.id, body: 'too late' })).status).toBe(409);
  });

  test('isolates messages, claims, history and contents between runs', async () => {
    const first = await fixture.launch({ title: '<img src=x onerror=alert(1)>' });
    const second = await fixture.launch({ title: 'Second swarm' });
    startRuns(first, second);
    const firstThread = fixture.store.createThread(actor(first), '<script>unsafe text</script>');
    const secondThread = fixture.store.createThread(actor(second), 'Second private thread');
    fixture.store.post(actor(first), firstThread.id, '<svg onload="alert(1)">First-only message</svg>');
    fixture.store.post(actor(second), secondThread.id, 'Second-only message');
    fixture.store.claimFiles(actor(first), ['first.html'], 'First claim');
    fixture.store.publishFiles(actor(first), [{ path: 'first.html', baseRevision: 0, contentBase64: 'b25l' }], 'Initial version');
    fixture.store.publishFiles(actor(first), [{ path: 'first.html', baseRevision: 1, contentBase64: 'dHdv' }], 'Reviewed version');
    fixture.store.claimFiles(actor(second), ['second.html'], 'Second claim');
    fixture.store.publishFiles(actor(second), [{ path: 'second.html', baseRevision: 0, contentBase64: 'c2Vjb25k' }], 'Other version');

    const detail = await fixture.request(`/api/swarms/${first.id}`);
    expect(detail.headers.get('content-type')).toContain('application/json');
    expect(detail.headers.get('x-content-type-options')).toBe('nosniff');
    const detailBody = await detail.text();
    expect(detailBody).toContain('first.html');
    expect(detailBody).not.toContain('second.html');
    expect(detailBody).not.toContain('contentBase64');
    const messages = await fixture.request(`/api/swarms/${first.id}/messages?thread=${encodeURIComponent(firstThread.id)}`);
    expect(await messages.json()).toEqual(fixture.store.messages(first.id, firstThread.id));
    expect((await fixture.request(`/api/swarms/${first.id}/messages?thread=${encodeURIComponent(secondThread.id)}`)).status).toBe(404);
    expect((await fixture.post(`/api/swarms/${first.id}/messages`, { threadId: secondThread.id, body: 'wrong destination' })).status).toBe(404);
    const history = await fixture.request(`/api/swarms/${first.id}/history?path=first.html`);
    expect(await history.json()).toEqual(fixture.store.fileHistory(first.id, 'first.html'));
    expect(fixture.store.fileHistory(first.id, 'first.html')).toHaveLength(2);
    expect(await (await fixture.request(`/api/swarms/${second.id}/history?path=first.html`)).json()).toEqual([]);
    expect((await fixture.request(`/api/swarms/${second.id}/file?path=first.html`)).status).toBe(404);
    expect((await fixture.request(`/api/swarms/${first.id}/history?path=..%2Fsecret`)).status).toBe(400);
    expect((await fixture.request('/api/swarms/does-not-exist')).status).toBe(404);
  });

  test('downloads exact canonical bytes as attachments and serves active artifacts only with separate sandbox CSP', async () => {
    const run = await fixture.launch();
    const markup = '<!doctype html><canvas></canvas><script>document.body.dataset.executed="yes"</script>';
    const binary = Buffer.from([0, 255, 1, 254, 128, 10]);
    fixture.store.seedFiles(run.id, [
      { path: 'index.html', baseRevision: 0, contentBase64: Buffer.from(markup).toString('base64') },
      { path: 'nested/data.bin', baseRevision: 0, contentBase64: binary.toString('base64') },
      { path: 'pelican.svg', baseRevision: 0, contentBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') },
    ]);
    for (const [path, expected] of [['index.html', Buffer.from(markup)], ['nested/data.bin', binary]] as const) {
      const response = await fixture.request(`/api/swarms/${run.id}/file?path=${encodeURIComponent(path)}`);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-disposition')).toStartWith('attachment;');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
    expect(fixture.servers.previewOrigin).not.toBe(fixture.servers.origin);
    const preview = await fetch(`${fixture.servers.previewOrigin}/artifact/${run.id}/index.html`);
    expect(preview.status).toBe(200);
    expect(await preview.text()).toBe(markup);
    expect(preview.headers.get('content-type')).toBe('text/html');
    expect(preview.headers.get('set-cookie')).toBeNull();
    expect(preview.headers.get('access-control-allow-origin')).toBeNull();
    const csp = preview.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts;');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain('allow-top-navigation');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    const svg = await fetch(`${fixture.servers.previewOrigin}/artifact/${run.id}/pelican.svg`);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(svg.headers.get('content-security-policy')).toBe(csp);
    expect((await fetch(`${fixture.servers.previewOrigin}/api/swarms`)).status).toBe(404);
    expect((await fetch(`${fixture.servers.previewOrigin}/artifact/${run.id}/index.html`, { method: 'POST' })).status).toBe(403);
    expect((await fetch(`${fixture.servers.previewOrigin}/artifact/${run.id}/index.html`, { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await fetch(`${fixture.servers.previewOrigin}/artifact/${run.id}/nested%2F..%2Findex.html`)).status).toBe(404);
    expect((await fixture.request('/api/swarms', { headers: { origin: 'null', 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await fixture.post(`/api/swarms/${run.id}/stop`, {}, { origin: fixture.servers.previewOrigin })).status).toBe(403);
    expect(fixture.store.getSwarm(run.id).status).toBe('queued');
  });
});

describe('FR-33 SSE cursor recovery and durable history', () => {
  test('delivers ordered batches beyond one page without duplicate events', async () => {
    const run = await fixture.launch();
    for (let index = 0; index < 205; index += 1) fixture.store.appendEvent(run.id, null, 'acceptance_progress', { index });
    const expected = fixture.store.events(run.id, 0, 1000);
    const response = await fixture.request(`/api/swarms/${run.id}/events`, { signal: AbortSignal.timeout(8000) });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const events = await readEvents(response, expected.length);
    expect(events).toEqual(expected);
    expect(new Set(events.map(event => event.seq)).size).toBe(events.length);
  }, 15_000);

  test('disconnects and resumes using Last-Event-ID without losing events written while absent', async () => {
    const run = await fixture.launch();
    const first = fixture.store.appendEvent(run.id, null, 'before_disconnect', { message: 'one' });
    const initial = await fixture.request(`/api/swarms/${run.id}/events?after=0`, { signal: AbortSignal.timeout(5000) });
    const observed = await readEvents(initial, first.seq);
    expect(observed.at(-1)?.seq).toBe(first.seq);
    const disconnectDeadline = Date.now() + 2000;
    while (fixture.servers.control.pendingRequests > 0 && Date.now() < disconnectDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    expect(fixture.servers.control.pendingRequests).toBe(0);
    const writtenOffline = fixture.store.appendEvent(run.id, null, 'while_disconnected', { message: 'two' });
    fixture.store.appendEvent(run.id, null, 'while_disconnected', { message: 'three' });
    const resumed = await fixture.request(`/api/swarms/${run.id}/events?after=0`, { headers: { 'last-event-id': String(first.seq) }, signal: AbortSignal.timeout(5000) });
    const received = await readEvents(resumed, 2);
    expect(received).toEqual(fixture.store.events(run.id, first.seq));
    expect(received[0]?.seq).toBe(writtenOffline.seq);
    expect(received.every(event => event.seq > first.seq)).toBe(true);
    expect(fixture.store.getSwarm(run.id).status).toBe('queued');
  }, 10_000);

  test('preserves events and worker-owned state through a control service and database reopen', async () => {
    const run = await fixture.launch();
    startRuns(run);
    const cursor = fixture.store.appendEvent(run.id, null, 'before_restart', { checkpoint: true }).seq;
    const cookieBefore = fixture.cookie;
    await fixture.restart();
    expect(fixture.cookie).not.toBe(cookieBefore);
    expect((await fixture.request('/api/swarms', { headers: { cookie: cookieBefore } })).status).toBe(401);
    expect(fixture.store.getSwarm(run.id)).toMatchObject({ status: 'running', workerId: 'http-test-worker' });
    const newest = fixture.store.appendEvent(run.id, null, 'after_restart', { resumed: true });
    const response = await fixture.request(`/api/swarms/${run.id}/events?after=${cursor}`, { signal: AbortSignal.timeout(5000) });
    expect(await readEvents(response, 1)).toEqual([newest]);
    const trace = await fixture.request(`/api/swarms/${run.id}/trace?after=${cursor}`);
    expect(await trace.json()).toEqual([newest]);
    expect((await fixture.request('/api/workers')).status).toBe(200);
  }, 10_000);

  test('rejects invalid cursors before opening an event stream and keeps scoped streams separate', async () => {
    const first = await fixture.launch();
    const second = await fixture.launch();
    for (const cursor of ['-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
      expect((await fixture.request(`/api/swarms/${first.id}/events?after=${cursor}`)).status).toBe(400);
      expect((await fixture.request(`/api/swarms/${first.id}/trace?after=${cursor}`)).status).toBe(400);
    }
    expect((await fixture.request(`/api/swarms/${first.id}/events`, { headers: { 'last-event-id': 'bad' } })).status).toBe(400);
    fixture.store.appendEvent(first.id, null, 'first_only', { private: 'first' });
    const response = await fixture.request(`/api/swarms/${second.id}/events`, { signal: AbortSignal.timeout(5000) });
    const events = await readEvents(response, 1);
    expect(events.every(event => event.swarmId === second.id)).toBe(true);
    expect(events.some(event => event.kind === 'first_only')).toBe(false);
  });
});
