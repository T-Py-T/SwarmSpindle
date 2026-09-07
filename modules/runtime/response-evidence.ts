import type { ModelBinding, TokenUsage } from '@simpleswarm/swarm';
import { RuntimeError } from './pricing.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuntimeError('response_invalid', 'Provider response evidence is not an object.');
  return Object.fromEntries(Object.entries(value));
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RuntimeError('usage_invalid', 'Provider omitted a required final token count.');
  return value;
}
function optionalCount(value: unknown): number { return value === undefined || value === null ? 0 : count(value); }

const providerErrorTypes = new Set([
  'rate_limit_error', 'overloaded_error', 'authentication_error', 'invalid_request_error',
  'api_error', 'permission_error', 'not_found_error', 'request_too_large', 'server_error',
  'rate_limit_exceeded', 'insufficient_quota', 'context_length_exceeded',
]);
class ProviderDiagnosticError extends RuntimeError {
  constructor(code: string, message: string, public readonly httpStatus?: number, public readonly providerErrorType?: string) { super(code, message); }
}
const transportCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
class TransportDiagnosticError extends RuntimeError {
  readonly phase = 'fetch_before_response';
  constructor(public readonly transportCode: string) { super('provider_transport_error', `Provider transport failed before an HTTP response (${transportCode}); reserved liability was retained.`); }
}
function errorFields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function streamError(event: Record<string, unknown>): RuntimeError {
  const detail = event.type === 'response.failed' ? errorFields(errorFields(event.response).error) : errorFields(event.error);
  const type = [detail.type, detail.code, event.code].find(value => typeof value === 'string' && providerErrorTypes.has(value));
  const safeType = typeof type === 'string' ? type : 'unknown';
  return new ProviderDiagnosticError('provider_sse_error', `Provider SSE error (${safeType}); reserved liability was retained.`, undefined, safeType);
}

/** Observes the server's SSE fields because Pi 0.84.1 preserves the requested model in message.model. */
export class ResponseEvidence {
  private pending = '';
  private eventLines: string[] = [];
  private namedError = false;
  private eventSize = 0;
  private decoder = new TextDecoder();
  private observedModel: string | undefined;
  private usage: TokenUsage | undefined;
  private sawFinalUsage = false;
  private terminal = false;
  private failure: RuntimeError | undefined;
  constructor(private readonly expected: ModelBinding, private readonly options: { idleTimeoutMs?: number } = {}) {}

  get error(): RuntimeError | undefined { return this.failure; }

  wrapFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
    return Object.assign(async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const streamAbort = new AbortController();
      const signal = upstreamSignal ? AbortSignal.any([upstreamSignal, streamAbort.signal]) : streamAbort.signal;
      let response: Response;
      try { response = await fetch(input, { ...init, signal }); }
      catch (cause) {
        if (signal.aborted) {
          const timedOut = errorFields(signal.reason).name === 'TimeoutError';
          this.failure ??= new RuntimeError(timedOut ? 'request_timeout' : 'cancelled', timedOut ? 'Provider response headers exceeded the timeout.' : 'Provider request was interrupted before an HTTP response.');
        } else {
          const error = errorFields(cause);
          const code = [error.code, errorFields(error.cause).code].find(value => typeof value === 'string' && transportCodes.has(value));
          this.failure ??= new TransportDiagnosticError(typeof code === 'string' ? code : 'unknown');
        }
        throw this.failure;
      }
      return this.observe(response, { signal: upstreamSignal ?? undefined, abort: reason => streamAbort.abort(reason) });
    }, { preconnect: fetch.preconnect });
  }

  observe(response: Response, transport: { signal?: AbortSignal; abort?: (reason: unknown) => void } = {}): Response {
    if (!response.ok) {
      this.failure ??= new ProviderDiagnosticError('provider_http_error', `Provider returned HTTP ${response.status}; reserved liability was retained.`, response.status);
      // The SDK must never incorporate a provider's raw body, headers, or status text into its error.
      void response.body?.cancel().catch(() => {});
      return new Response(response.status === 304 ? null : JSON.stringify({ error: { type: 'api_error', message: this.failure.message } }), {
        status: response.status >= 200 ? response.status : 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (!response.body) {
      this.failure ??= new RuntimeError('response_incomplete', 'Provider response ended without terminal evidence.'); return response;
    }
    const reader = response.body.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let abort = () => {};
    let fail = (_reason: unknown) => {};
    const arm = () => {
      if (timer) clearTimeout(timer);
      if (this.options.idleTimeoutMs !== undefined) timer = setTimeout(() => fail(new RuntimeError('request_timeout', 'Provider response body exceeded the idle timeout.')), this.options.idleTimeoutMs);
    };
    const cleanup = () => { if (timer) clearTimeout(timer); transport.signal?.removeEventListener('abort', abort); };
    const cancelReader = async (reason?: unknown) => {
      try { await reader.cancel(reason); } catch { /* The transport may already have rejected on abort. */ }
      finally { reader.releaseLock(); }
    };
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        fail = (reason: unknown) => {
          if (closed) return;
          closed = true;
          this.failure ??= reason instanceof RuntimeError ? reason : new RuntimeError('response_error', 'Provider response failed before terminal evidence.');
          cleanup(); controller.error(this.failure); transport.abort?.(reason); void cancelReader(reason);
        };
        abort = () => fail(new RuntimeError('cancelled', 'Provider response was interrupted.'));
        transport.signal?.addEventListener('abort', abort, { once: true });
        if (transport.signal?.aborted) { abort(); return; }
        arm();
      },
      pull: async controller => {
        if (closed) return;
        try {
          const { value, done } = await reader.read();
          if (closed) return;
          if (done) {
            this.consume(this.decoder.decode());
            if (this.pending.length) { this.line(this.pending); this.pending = ''; }
            this.finishEvent();
            if (!this.terminal) this.failure ??= new RuntimeError('response_incomplete', 'Provider response ended without terminal evidence.');
            if (this.failure) throw this.failure;
            closed = true; cleanup(); reader.releaseLock(); controller.close(); return;
          }
          if (value.byteLength > 0) arm();
          this.consume(this.decoder.decode(value, { stream: true }));
          if (this.failure) throw this.failure;
          controller.enqueue(value);
          if (this.terminal) {
            closed = true; cleanup(); controller.close(); await cancelReader();
          }
        } catch (cause) { fail(cause); }
      },
      cancel: async reason => {
        if (closed) return;
        closed = true; cleanup(); transport.abort?.(reason); await cancelReader(reason);
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  verify(sdkUsage: TokenUsage): { responseModel: string; usage: TokenUsage } {
    if (this.failure) throw this.failure;
    if (!this.terminal || !this.sawFinalUsage || !this.usage || !this.observedModel) {
      throw new RuntimeError('response_incomplete', 'Server model identity and terminal usage were not both observed.');
    }
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      if (this.usage[key] !== sdkUsage[key]) throw new RuntimeError('usage_invalid', 'Pi usage differs from the server terminal usage.');
    }
    return { responseModel: this.observedModel, usage: this.usage };
  }

  private consume(chunk: string): void {
    if (this.failure) return;
    this.pending += chunk;
    let newline = this.pending.indexOf('\n');
    while (newline >= 0 && !this.failure) {
      const line = this.pending.slice(0, newline).replace(/\r$/, '');
      this.pending = this.pending.slice(newline + 1); this.line(line);
      newline = this.pending.indexOf('\n');
    }
    if (this.pending.length + this.eventSize > 4_000_000) this.failure ??= new RuntimeError('response_invalid', 'Provider event exceeded the bounded SSE observer.');
  }

  private line(line: string): void {
    if (line.length === 0) { this.finishEvent(); return; }
    if (line === 'event' || line.startsWith('event:')) {
      // SSE uses the last event field in each frame. Store only the classification, not untrusted text.
      this.namedError = line.slice(6).replace(/^ /, '') === 'error'; return;
    }
    if (!line.startsWith('data:')) return;
    const value = line.slice(5).replace(/^ /, '');
    this.eventLines.push(value); this.eventSize += value.length;
    if (this.eventSize > 4_000_000) this.failure ??= new RuntimeError('response_invalid', 'Provider event exceeded the bounded SSE observer.');
  }

  private finishEvent(): void {
    const hasData = this.eventLines.length > 0;
    const namedError = this.expected.provider === 'anthropic' && this.namedError;
    this.namedError = false;
    const json = this.eventLines.join('\n'); this.eventLines = []; this.eventSize = 0;
    // Anthropic dispatches event:error even without a JSON type, or with malformed/conflicting data.
    // Codex dispatches JSON type only; its pinned SDK ignores event names.
    if (namedError) {
      let event: Record<string, unknown> = {};
      try { event = errorFields(JSON.parse(json)); } catch { /* A malformed named error is still a sanitized provider error. */ }
      this.failure ??= streamError({ ...event, type: 'error' }); return;
    }
    if (!hasData || json === '[DONE]') return;
    try {
      const event = record(JSON.parse(json));
      if (event.type === 'error' || event.type === 'response.failed') throw streamError(event);
      if (this.expected.provider === 'anthropic') this.anthropic(event);
      else this.codex(event);
    } catch (cause) { this.failure ??= cause instanceof RuntimeError ? cause : new RuntimeError('response_invalid', 'Provider returned malformed SSE evidence.'); }
  }

  private identity(value: unknown): void {
    if (typeof value !== 'string' || value !== this.expected.id || (this.observedModel && value !== this.observedModel)) {
      throw new RuntimeError('model_changed', `The server reported an unexpected model identity, outside pinned ${this.expected.id}. Undocumented aliases require explicit verification.`);
    }
    this.observedModel = value;
  }

  private anthropic(event: Record<string, unknown>): void {
    if (event.type === 'message_start') {
      const message = record(event.message); this.identity(message.model);
      const usage = record(message.usage);
      this.usage = { input: count(usage.input_tokens), output: count(usage.output_tokens), cacheRead: optionalCount(usage.cache_read_input_tokens), cacheWrite: optionalCount(usage.cache_creation_input_tokens) };
    } else if (event.type === 'message_delta') {
      if (!this.usage) throw new RuntimeError('response_invalid', 'Anthropic usage arrived before message_start.');
      const usage = record(event.usage);
      if (usage.input_tokens !== undefined && usage.input_tokens !== null) this.usage.input = count(usage.input_tokens);
      if (usage.cache_read_input_tokens !== undefined && usage.cache_read_input_tokens !== null) this.usage.cacheRead = count(usage.cache_read_input_tokens);
      if (usage.cache_creation_input_tokens !== undefined && usage.cache_creation_input_tokens !== null) this.usage.cacheWrite = count(usage.cache_creation_input_tokens);
      this.usage.output = count(usage.output_tokens); this.sawFinalUsage = true;
    } else if (event.type === 'message_stop') this.terminal = true;
  }

  private codex(event: Record<string, unknown>): void {
    if (event.type === 'response.created' || event.type === 'response.in_progress') {
      const response = record(event.response);
      if (response.model !== undefined) this.identity(response.model);
    }
    if (event.type !== 'response.completed' && event.type !== 'response.incomplete') return;
    const response = record(event.response); this.identity(response.model);
    if (response.service_tier !== undefined && response.service_tier !== null && response.service_tier !== 'default') {
      throw new RuntimeError('response_invalid', 'Provider selected an unpriced service tier.');
    }
    const usage = record(response.usage);
    const details = usage.input_tokens_details === undefined || usage.input_tokens_details === null ? {} : record(usage.input_tokens_details);
    const totalInput = count(usage.input_tokens); const cached = optionalCount(details.cached_tokens); const written = optionalCount(details.cache_write_tokens);
    if (cached + written > totalInput) throw new RuntimeError('usage_invalid', 'Cache counts exceed total input.');
    this.usage = { input: totalInput - cached - written, output: count(usage.output_tokens), cacheRead: cached, cacheWrite: written };
    this.sawFinalUsage = true; this.terminal = true;
  }
}
