import type { ModelBinding, TokenUsage } from '@simpleswarm/swarm';

export const PRICING_EVIDENCE = '2026-09-07: https://platform.claude.com/docs/en/about-claude/pricing ; https://developers.openai.com/api/docs/models/gpt-5.5 ; https://help.openai.com/en/articles/20001415-chatgpt-rate-card-token-based-enterprise-pricing ; Pi v0.84.1 SSE, no retries, standard/global speed, no server tools. GPT-5.5 long-context premium persists per Pi session. USD equivalent for OAuth.';

export class RuntimeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'RuntimeError'; }
}

export function reservationCeiling(model: ModelBinding, maxOutputTokens: number): number {
  if (model.thinking !== 'high') throw new RuntimeError('unsupported_model', 'This audited tariff requires High reasoning.');
  if (model.provider === 'openai-codex' && model.id === 'gpt-5.5') return 16_260_000;
  if (model.provider === 'anthropic' && model.id === 'claude-opus-4-8') {
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1024 || maxOutputTokens > 128_000) {
      throw new RuntimeError('output_limit', 'Opus output limit must be between 1024 and 128000 tokens.');
    }
    return 5_000_000 + maxOutputTokens * 25;
  }
  throw new RuntimeError('unsupported_model', 'No audited tariff exists for this exact model.');
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RuntimeError('payload_invalid', 'Expected an object payload.');
  return Object.fromEntries(Object.entries(value));
}

function rejectCacheMarkers(value: unknown): void {
  if (Array.isArray(value)) { for (const item of value) rejectCacheMarkers(item); return; }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'cache_control') throw new RuntimeError('payload_invalid', 'Cache writes are disabled by this tariff.');
    rejectCacheMarkers(item);
  }
}

export function validatePayload(model: ModelBinding, maxOutputTokens: number, value: unknown): void {
  reservationCeiling(model, maxOutputTokens);
  const payload = object(value);
  if (payload.model !== model.id || payload.stream !== true) throw new RuntimeError('payload_invalid', 'Model or stream mode changed.');
  if (payload.speed !== undefined || payload.service_tier !== undefined || payload.inference_geo !== undefined) {
    throw new RuntimeError('payload_invalid', 'Unpriced service modifiers are forbidden.');
  }
  if (payload.tools !== undefined) {
    if (!Array.isArray(payload.tools)) throw new RuntimeError('payload_invalid', 'Invalid tool list.');
    for (const tool of payload.tools) {
      const entry = object(tool);
      if (entry.type !== undefined && entry.type !== 'function' && entry.type !== 'custom') {
        throw new RuntimeError('payload_invalid', 'Paid server tools are forbidden.');
      }
    }
  }
  if (model.provider === 'anthropic') {
    if (payload.max_tokens !== maxOutputTokens || object(payload.thinking).type !== 'adaptive' || object(payload.output_config).effort !== 'high') {
      throw new RuntimeError('payload_invalid', 'Opus output ceiling or High adaptive reasoning changed.');
    }
    rejectCacheMarkers(payload);
  } else if (object(payload.reasoning).effort !== 'high') {
    throw new RuntimeError('payload_invalid', 'Codex High reasoning changed.');
  }
}

/** Owned by one actual Pi session; crossing the threshold affects its later requests. */
export class SessionPricing {
  private tariff: 'standard' | 'long-context' = 'standard';
  constructor(private readonly model: ModelBinding) {}

  price(usage: TokenUsage): number {
    const price = priceUsage(this.model, usage, this.tariff);
    if (this.model.provider === 'openai-codex' && usage.input + usage.cacheRead > 272_000) this.tariff = 'long-context';
    return price;
  }
}

export function priceUsage(model: ModelBinding, usage: TokenUsage, tariff: 'standard' | 'long-context' = 'standard'): number {
  for (const count of Object.values(usage)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RuntimeError('usage_invalid', 'Provider usage is incomplete or invalid.');
  }
  if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite === 0) {
    throw new RuntimeError('usage_invalid', 'A zero-usage inference response cannot release its reservation.');
  }
  if (model.provider === 'anthropic') {
    if (usage.cacheWrite !== 0 || usage.input + usage.cacheRead > 1_000_000) throw new RuntimeError('usage_invalid', 'Usage exceeds the frozen Opus envelope.');
    return Math.ceil(usage.input * 5 + usage.output * 25 + usage.cacheRead * 0.5);
  }
  if (usage.cacheWrite !== 0 || usage.input + usage.cacheRead > 1_050_000 || usage.output > 128_000) {
    throw new RuntimeError('usage_invalid', 'Usage exceeds the frozen Codex envelope.');
  }
  const longContext = tariff === 'long-context' || usage.input + usage.cacheRead > 272_000;
  return Math.ceil(usage.input * (longContext ? 10 : 5) + usage.output * (longContext ? 45 : 30) + usage.cacheRead * (longContext ? 1 : 0.5));
}
