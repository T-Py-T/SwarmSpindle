import { afterEach, describe, expect, test } from 'bun:test';
import { zstdDecompressSync } from 'node:zlib';
import { Type } from 'typebox';
import { streamSimple as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamCodex } from '@earendil-works/pi-ai/api/openai-codex-responses';
import { getBuiltinModel } from '@earendil-works/pi-ai/providers/all';
import type { Context, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { openSwarmStore, parseSwarmSpec, type ModelBinding, type SwarmStore } from '@simpleswarm/swarm';
import { BudgetAdmission, RequestLiability } from '../modules/runtime/budget.ts';
import { priceUsage, PRICING_EVIDENCE, reservationCeiling, validatePayload } from '../modules/runtime/pricing.ts';
import { ResponseEvidence } from '../modules/runtime/response-evidence.ts';

const opus: ModelBinding = { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' };
const codex: ModelBinding = { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' };
const privateMarker = 'SYNTHETIC-PRIVATE-CREDENTIAL-DO-NOT-LOG';
const context: Context = { systemPrompt: 'Synthetic transport verification.', messages: [{ role: 'user', content: 'Say OK', timestamp: 1 }], tools: [{ name: 'read', description: 'Read shared files', parameters: Type.Object({ path: Type.String() }) }] };
const stores: SwarmStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const sse = (events: unknown[]) => events.map(event => `event: ${typeof event === 'object' && event !== null && 'type' in event ? String(event.type) : 'message'}\ndata: ${JSON.stringify(event)}\n\n`).join('');
function anthropicEvents(model = opus.id, finalUsage: unknown = { output_tokens: 2 }) {
  return [
    { type: 'message_start', message: { id: 'fixture-message', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: finalUsage },
    { type: 'message_stop' },
  ];
}
function codexEvents(model = codex.id, usage: unknown = { input_tokens: 20, output_tokens: 2, input_tokens_details: { cached_tokens: 3 }, total_tokens: 22 }) {
  const message = { type: 'message', id: 'fixture-item', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
  return [
    { type: 'response.created', response: { id: 'fixture-response', model, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: 'fixture-item', part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'fixture-item', delta: 'OK' },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response: { id: 'fixture-response', model, status: 'completed', service_tier: 'default', output: [message], usage } },
  ];
}
function fixture(binding: ModelBinding, events: unknown[], status = 200, transport: { response?: () => Response; idleTimeoutMs?: number; signal?: AbortSignal; context?: Context } = {}) {
  const store = openSwarmStore(':memory:'); stores.push(store); store.registerWorker('native-fixture', process.pid);
  const created = store.createSwarm(parseSwarmSpec({ task: 'Synthetic transport only', definitionOfDone: 'No real HTTP', finalOutput: 'fixture.txt', agentCount: 1, budgetMicros: 50_000_000, model: binding })); store.claimNextSwarm('native-fixture');
  const agent = created.agents[0]; if (!agent) throw new Error('Missing fixture agent');
  const actor = { swarmId: created.id, agentId: agent.id }; store.startAgent(actor, crypto.randomUUID());
  let calls = 0; let actualBody = ''; let authorization = ''; let plannedBody = '';
  const fakeFetch: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls++; expect(store.budget(created.id).reservedMicros).toBe(reservationCeiling(binding, 16000));
    const request = new Request(input, init); authorization = request.headers.get('authorization') ?? '';
    const body = Buffer.from(await request.arrayBuffer());
    actualBody = (request.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(body) : body).toString();
    expect(JSON.parse(actualBody)).toEqual(JSON.parse(plannedBody));
    if (transport.response) return transport.response();
    return new Response(status === 200 ? sse(events) : JSON.stringify({ error: { message: 'Synthetic retryable failure', type: 'overloaded_error' } }), { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' } });
  }, { preconnect: () => { throw new Error('No real networking is permitted'); } });
  const evidence = new ResponseEvidence(binding, { idleTimeoutMs: transport.idleTimeoutMs });
  const liability = new RequestLiability({ store, actor, admission: new BudgetAdmission(store), ceiling: reservationCeiling(binding, 16000), evidence: PRICING_EVIDENCE, signal: transport.signal ?? new AbortController().signal, fetch: evidence.wrapFetch(fakeFetch) });
  const options: SimpleStreamOptions = { signal: transport.signal, apiKey: binding.provider === 'anthropic' ? 'sk-ant-oat01-fixture-not-a-real-credential' : `fixture.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64')}.fixture`, reasoning: 'high', maxTokens: 16000, cacheRetention: 'none', transport: 'sse', maxRetries: 0, timeoutMs: 3000, fetch: liability.fetch,
    onPayload: async payload => { validatePayload(binding, 16000, payload); plannedBody = JSON.stringify(payload); await liability.prepare(); },
  };
  const run = async () => {
    const requestContext = transport.context ?? context;
    const stream = binding.provider === 'anthropic' ? streamAnthropic(getBuiltinModel('anthropic', 'claude-opus-4-8'), requestContext, options) : streamCodex(getBuiltinModel('openai-codex', 'gpt-5.5'), requestContext, options);
    for await (const _event of stream) { /* Consume actual Pi transport events. */ }
    return stream.result();
  };
  return { run, store, created, evidence, liability, calls: () => calls, actualBody: () => actualBody, authorization: () => authorization };
}

const imageToolContext: Context = { ...context, messages: [
  ...context.messages,
  { role: 'assistant', api: 'openai-codex-responses', provider: 'openai-codex', model: 'gpt-5.5', timestamp: 2, stopReason: 'toolUse',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: 'toolCall', id: 'fixture_read', name: 'read', arguments: { path: 'fixture.png' } }] },
  { role: 'toolResult', toolCallId: 'fixture_read', toolName: 'read', timestamp: 3, isError: false,
    content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1kAAAAASUVORK5CYII=' }] },
] };

for (const scenario of ['fetch-rejection', 'empty-sse'] as const) {
  test(`Codex image-bearing ${scenario} is diagnosed without exposing raw cause or releasing liability`, async () => {
    const check = fixture(codex, [], 200, { context: imageToolContext, response: () => {
      if (scenario === 'fetch-rejection') throw new TypeError(privateMarker, { cause: { code: 'ECONNRESET', message: privateMarker, url: `https://invalid.example/${privateMarker}` } });
      return new Response('', { headers: { 'content-type': 'text/event-stream', 'x-private': privateMarker } });
    } });
    const message = await check.run();
    expect(message.stopReason).toBe('error'); expect(check.calls()).toBe(1);
    const payload = JSON.parse(check.actualBody());
    expect(payload.input.some((item: { type?: string; output?: Array<{ type?: string }> }) => item.type === 'function_call_output' && Array.isArray(item.output) && item.output.some(block => block.type === 'input_image'))).toBe(true);
    if (scenario === 'fetch-rejection') expect(check.evidence.error).toMatchObject({ code: 'provider_transport_error', phase: 'fetch_before_response', transportCode: 'ECONNRESET' });
    else expect(check.evidence.error?.code).toBe('response_incomplete');
    expect(() => check.evidence.verify(message.usage)).toThrow();
    check.liability.uncertain(check.evidence.error!.message);
    expect(check.store.budget(check.created.id).uncertainMicros).toBe(16_260_000);
    expect(check.store.budget(check.created.id).settledMicros).toBe(0);
    expect(JSON.stringify({ message, error: check.evidence.error, events: check.store.events(check.created.id), ledger: check.store.reservations(check.created.id) })).not.toContain(privateMarker);
  });
}

describe('actual pinned Pi provider transports through intercepted HTTP', () => {
  test('Anthropic OAuth retains identity boilerplate but sends no cache markers and enforces High/max_tokens', async () => {
    const check = fixture(opus, anthropicEvents()); const message = await check.run();
    expect(message.stopReason).toBe('stop'); expect(check.calls()).toBe(1);
    const payload = JSON.parse(check.actualBody());
    expect(payload.system[0].text).toContain('Claude Code'); expect(check.actualBody()).not.toContain('cache_control');
    expect(payload.thinking.type).toBe('adaptive'); expect(payload.output_config.effort).toBe('high'); expect(payload.max_tokens).toBe(16000);
    expect(check.authorization()).toBe('Bearer sk-ant-oat01-fixture-not-a-real-credential');
    const verified = check.evidence.verify(message.usage); expect(verified.responseModel).toBe(opus.id);
    check.liability.settle(priceUsage(opus, verified.usage), verified.usage); expect(check.store.budget(check.created.id).settledMicros).toBe(150);
  });
  test('Codex actually uses injected SSE fetch and omits max_output_tokens while preserving High', async () => {
    const check = fixture(codex, codexEvents()); const message = await check.run();
    expect(message.stopReason).toBe('stop'); expect(check.calls()).toBe(1);
    const payload = JSON.parse(check.actualBody()); expect(payload.reasoning.effort).toBe('high'); expect(payload.max_output_tokens).toBeUndefined();
    const verified = check.evidence.verify(message.usage); expect(verified.usage).toEqual({ input: 17, output: 2, cacheRead: 3, cacheWrite: 0 });
    check.liability.settle(priceUsage(codex, verified.usage), verified.usage); expect(check.store.budget(check.created.id).settledMicros).toBe(147);
  });
  for (const binding of [opus, codex]) {
    test(`${binding.provider} retains sanitized HTTP status without retries, body secrets, or released liability`, async () => {
      for (const status of [429, 500]) {
        const check = fixture(binding, [], status, { response: () => new Response(JSON.stringify({ error: { type: 'overloaded_error', message: privateMarker } }), {
          status, statusText: privateMarker, headers: { 'content-type': 'application/json', 'x-request-id': privateMarker, 'set-cookie': `credential=${privateMarker}` },
        }) });
        const message = await check.run();
        expect(message.stopReason).toBe('error'); expect(check.calls()).toBe(1);
        expect(check.evidence.error).toMatchObject({ code: 'provider_http_error', httpStatus: status });
        expect(check.evidence.error?.message).toContain(`HTTP ${status}`);
        expect(() => check.evidence.verify(message.usage)).toThrow(`HTTP ${status}`);
        check.liability.uncertain(check.evidence.error!.message);
        expect(check.store.budget(check.created.id).uncertainMicros).toBe(reservationCeiling(binding, 16000));
        expect(check.store.budget(check.created.id).settledMicros).toBe(0);
        expect(JSON.stringify({ message, error: check.evidence.error, events: check.store.events(check.created.id), ledger: check.store.reservations(check.created.id) })).not.toContain(privateMarker);
        const firstFailure = check.evidence.error;
        const subsequent = check.evidence.observe(new Response(privateMarker, { status: 503 }));
        expect(check.evidence.error).toBe(firstFailure);
        expect(await subsequent.text()).not.toContain(privateMarker);
      }
    });
    test(`${binding.provider} SSE error types are allowlisted before Pi can expose raw error messages`, async () => {
      for (const reportedType of ['rate_limit_error', 'overloaded_error', 'authentication_error', 'invalid_request_error', privateMarker]) {
        const start = binding.provider === 'anthropic' ? anthropicEvents().slice(0, 1) : codexEvents().slice(0, 1);
        const event = binding.provider === 'anthropic'
          ? { type: 'error', error: { type: reportedType, message: privateMarker } }
          : { type: 'error', code: reportedType, message: privateMarker };
        const check = fixture(binding, [...start, event]); const message = await check.run();
        const safeType = reportedType === privateMarker ? 'unknown' : reportedType;
        expect(message.stopReason).toBe('error'); expect(check.calls()).toBe(1);
        expect(check.evidence.error).toMatchObject({ code: 'provider_sse_error', providerErrorType: safeType });
        expect(() => check.evidence.verify(message.usage)).toThrow(`Provider SSE error (${safeType})`);
        check.liability.uncertain(check.evidence.error!.message);
        expect(check.store.budget(check.created.id).uncertainMicros).toBe(reservationCeiling(binding, 16000));
        expect(check.store.budget(check.created.id).settledMicros).toBe(0);
        expect(JSON.stringify({ message, error: check.evidence.error, events: check.store.events(check.created.id), ledger: check.store.reservations(check.created.id) })).not.toContain(privateMarker);
      }
    });
    test(`${binding.provider} cannot pass off its requested model as the actual server model`, async () => {
      const check = fixture(binding, binding.provider === 'anthropic' ? anthropicEvents('wrong-model') : codexEvents('wrong-model'));
      const message = await check.run(); expect(message.stopReason).toBe('error');
      expect(() => check.evidence.verify(message.usage)).toThrow('server reported');
      check.liability.uncertain('Synthetic identity mismatch'); expect(check.store.budget(check.created.id).settledMicros).toBe(0);
    });
    test(`${binding.provider} missing final usage cannot release the conservative reservation`, async () => {
      const check = fixture(binding, binding.provider === 'anthropic' ? anthropicEvents(binding.id, {}) : codexEvents(binding.id, {}));
      const message = await check.run(); expect(() => check.evidence.verify(message.usage)).toThrow();
      check.liability.uncertain('Synthetic missing usage'); expect(check.store.budget(check.created.id).availableMicros).toBe(50_000_000 - reservationCeiling(binding, 16000));
    });
  }
});

test('Codex response.failed reports only its allowlisted error code and retains full uncertainty', async () => {
  const check = fixture(codex, [...codexEvents().slice(0, 1), { type: 'response.failed', response: { error: { code: 'server_error', message: privateMarker } } }]);
  const message = await check.run();
  expect(message.stopReason).toBe('error'); expect(check.calls()).toBe(1);
  expect(check.evidence.error).toMatchObject({ code: 'provider_sse_error', providerErrorType: 'server_error' });
  check.liability.uncertain(check.evidence.error!.message);
  expect(check.store.budget(check.created.id).uncertainMicros).toBe(16_260_000);
  expect(JSON.stringify({ message, error: check.evidence.error, events: check.store.events(check.created.id) })).not.toContain(privateMarker);
});

test('Anthropic named error frames sanitize missing, conflicting, and malformed JSON types across chunks', async () => {
  const bodies = [
    { data: JSON.stringify({ error: { type: 'overloaded_error', message: privateMarker } }), safeType: 'overloaded_error' },
    { data: JSON.stringify({ type: 'message_start', error: { type: 'rate_limit_error', message: privateMarker } }), safeType: 'rate_limit_error' },
    { data: privateMarker, safeType: 'unknown' },
  ];
  for (const { data, safeType } of bodies) {
    const check = fixture(opus, [], 200, { response: () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        const encode = (value: string) => new TextEncoder().encode(value);
        controller.enqueue(encode(sse(anthropicEvents().slice(0, 1)) + 'event: er'));
        controller.enqueue(encode(`ror\ndata: ${data}\n\n`)); controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } }) });
    const message = await check.run();
    expect(message.stopReason).toBe('error'); expect(check.calls()).toBe(1);
    expect(check.evidence.error).toMatchObject({ code: 'provider_sse_error', providerErrorType: safeType });
    expect(() => check.evidence.verify(message.usage)).toThrow(`Provider SSE error (${safeType})`);
    check.liability.uncertain(check.evidence.error!.message);
    expect(check.store.budget(check.created.id).uncertainMicros).toBe(5_400_000);
    expect(check.store.budget(check.created.id).settledMicros).toBe(0);
    expect(JSON.stringify({ message, error: check.evidence.error, events: check.store.events(check.created.id), ledger: check.store.reservations(check.created.id) })).not.toContain(privateMarker);
  }
});

test('Anthropic event classification follows the last header and resets between frames', async () => {
  const raw = 'event: error\nevent: ping\ndata: {}\n\nevent: error\nevent:\n\n' + sse(anthropicEvents());
  const check = fixture(opus, [], 200, { response: () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }) });
  const message = await check.run();
  expect(message.stopReason).toBe('stop'); expect(check.calls()).toBe(1); expect(check.evidence.error).toBeUndefined();
  const verified = check.evidence.verify(message.usage); check.liability.settle(priceUsage(opus, verified.usage), verified.usage);
  expect(check.store.budget(check.created.id).settledMicros).toBe(150);
});

test('Codex keeps dispatching JSON types rather than ignored SSE event names', async () => {
  const raw = sse(codexEvents()).replace('event: response.completed\n', 'event: response.failed\n');
  const check = fixture(codex, [], 200, { response: () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }) });
  const message = await check.run();
  expect(message.stopReason).toBe('stop'); expect(check.calls()).toBe(1); expect(check.evidence.error).toBeUndefined();
  const verified = check.evidence.verify(message.usage); check.liability.settle(priceUsage(codex, verified.usage), verified.usage);
  expect(check.store.budget(check.created.id).settledMicros).toBe(147);
});

test('an earlier model mismatch stays authoritative and never echoes a malicious model string', async () => {
  const check = fixture(opus, [...anthropicEvents(privateMarker).slice(0, 1), { type: 'error', error: { type: 'overloaded_error', message: privateMarker } }]);
  const message = await check.run();
  expect(message.stopReason).toBe('error'); expect(check.calls()).toBe(1);
  expect(check.evidence.error?.code).toBe('model_changed');
  expect(JSON.stringify({ message, error: check.evidence.error })).not.toContain(privateMarker);
  check.liability.uncertain(check.evidence.error!.message);
  expect(check.store.budget(check.created.id).uncertainMicros).toBe(5_400_000);
});

test('Anthropic body idle timeout ends a real Pi stream and cancels its underlying response', async () => {
  let cancellations = 0;
  const check = fixture(opus, [], 200, { idleTimeoutMs: 30, response: () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(sse(anthropicEvents().slice(0, 1)))); },
    cancel() { cancellations++; },
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  const message = await check.run();
  expect(message.stopReason).toBe('error'); expect(check.evidence.error?.code).toBe('request_timeout');
  expect(cancellations).toBe(1); expect(check.calls()).toBe(1);
  check.liability.uncertain('Synthetic stalled response'); expect(check.store.budget(check.created.id).uncertainMicros).toBe(5_400_000);
});

test('operator abort unblocks an already pending body read and retains attempted liability', async () => {
  const controller = new AbortController(); let cancellations = 0;
  const check = fixture(opus, [], 200, { idleTimeoutMs: 1000, signal: controller.signal, response: () => new Response(new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(new TextEncoder().encode(sse(anthropicEvents().slice(0, 1))));
      setTimeout(() => controller.abort(new Error('Synthetic operator stop')), 15);
    }, cancel() { cancellations++; },
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  const message = await check.run();
  expect(message.stopReason).toBe('aborted'); expect(cancellations).toBe(1); expect(check.calls()).toBe(1);
  check.liability.uncertain('Synthetic operator stop'); expect(check.store.budget(check.created.id).uncertainMicros).toBe(5_400_000);
});

test('terminal SSE evidence closes a lingering response without a false later idle timeout', async () => {
  let cancellations = 0;
  const check = fixture(opus, [], 200, { idleTimeoutMs: 30, response: () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(sse(anthropicEvents()))); },
    cancel() { cancellations++; },
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  const message = await check.run(); expect(message.stopReason).toBe('stop');
  const verified = check.evidence.verify(message.usage); check.liability.settle(priceUsage(opus, verified.usage), verified.usage);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(check.evidence.error).toBeUndefined(); expect(cancellations).toBe(1); expect(check.store.budget(check.created.id).settledMicros).toBe(150);
});
