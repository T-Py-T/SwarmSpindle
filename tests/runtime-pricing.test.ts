import { describe, expect, test } from 'bun:test';
import { priceUsage, reservationCeiling, validatePayload } from '../modules/runtime/pricing.ts';
import type { ModelBinding } from '@simpleswarm/swarm';
const opus: ModelBinding = { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' };
const codex: ModelBinding = { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' };
const opusPayload = () => ({ model: opus.id, stream: true, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, messages: [], tools: [{ name: 'read', input_schema: { type: 'object' } }] });
const codexPayload = () => ({ model: codex.id, stream: true, reasoning: { effort: 'high' }, input: [], tools: [{ type: 'function', name: 'read' }] });

describe('audited exact model accounting', () => {
  test('reserves the full Codex output envelope even when requested output is small', () => {
    expect(reservationCeiling(codex, 1024)).toBe(16_260_000);
    expect(reservationCeiling(opus, 16000)).toBe(5_400_000);
    expect(() => reservationCeiling({ ...opus, id: 'claude-sonnet-4-5' }, 16000)).toThrow('No audited tariff');
  });
  test('validates the final provider transformed payload', () => {
    expect(() => validatePayload(opus, 16000, opusPayload())).not.toThrow();
    expect(() => validatePayload(codex, 16000, codexPayload())).not.toThrow();
    expect(() => validatePayload(opus, 16000, { ...opusPayload(), max_tokens: 16001 })).toThrow();
    expect(() => validatePayload(opus, 16000, { ...opusPayload(), thinking: { type: 'enabled' } })).toThrow();
    expect(() => validatePayload(codex, 16000, { ...codexPayload(), reasoning: { effort: 'low' } })).toThrow();
    expect(() => validatePayload(codex, 16000, { ...codexPayload(), service_tier: 'priority' })).toThrow();
    expect(() => validatePayload(opus, 16000, { ...opusPayload(), messages: [{ content: [{ cache_control: { type: 'ephemeral' } }] }] })).toThrow();
    expect(() => validatePayload(codex, 16000, { ...codexPayload(), tools: [{ type: 'web_search' }] })).toThrow();
  });
  test('freezes prices, includes hidden output once, and rounds microdollars up', () => {
    expect(priceUsage(opus, { input: 100, output: 200, cacheRead: 3, cacheWrite: 0 })).toBe(5502);
    expect(priceUsage(codex, { input: 100, output: 200, cacheRead: 3, cacheWrite: 0 })).toBe(6502);
    expect(priceUsage(codex, { input: 273000, output: 200, cacheRead: 3, cacheWrite: 0 })).toBe(2739003);
  });
  test('unknown, zero, or impossible usage never refunds an attempted request', () => {
    expect(() => priceUsage(opus, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toThrow();
    expect(() => priceUsage(opus, { input: NaN, output: 1, cacheRead: 0, cacheWrite: 0 })).toThrow();
    expect(() => priceUsage(opus, { input: 1, output: 1, cacheRead: 0, cacheWrite: 1 })).toThrow();
    expect(() => priceUsage(codex, { input: 1, output: 128001, cacheRead: 0, cacheWrite: 0 })).toThrow();
  });
});
