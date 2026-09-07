import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ResponseEvidence } from '../modules/runtime/response-evidence.ts';
import { priceUsage } from '../modules/runtime/pricing.ts';

// One read-only review request, separate from challenge swarms. No session or tools are created.
const [packetArgument, outputArgument] = process.argv.slice(2);
if (!packetArgument || !outputArgument) throw new Error('Supply a fixed review packet and a new output directory.');
const packet = await Bun.file(resolve(packetArgument)).text();
if (Buffer.byteLength(packet) > 350_000) throw new Error('Review packet exceeds the explicit size limit.');
const output = resolve(outputArgument);
await mkdir(output, { recursive: false, mode: 0o700 });
const modelBinding = { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'low' } as const;
const maxTokens = 16000;
// Standalone review tariff: the same $5/M input and $25/M output rates apply at Low effort.
// This tool has its own no-tools payload policy; swarm runtime settings remain owned by that module.
const ceilingMicros = 5_000_000 + maxTokens * 25;
const receipt = {
  kind: 'independent-code-review', packetSha256: createHash('sha256').update(packet).digest('hex'),
  requestedModel: modelBinding, responseModel: null as string | null,
  attemptCount: 0, ceilingMicros, actualMicros: null as number | null,
  status: 'not-attempted', createdAt: new Date().toISOString(), reason: '',
};
const save = () => Bun.write(`${output}/receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
await save();
const models = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, signal: AbortSignal.timeout(20_000) });
try {
  const model = models.getModel(modelBinding.provider, modelBinding.id);
  if (!model || !await models.checkAuth(modelBinding.provider, { signal: AbortSignal.timeout(20_000) })) throw new Error('Native Pi review model/authentication unavailable.');
  const evidence = new ResponseEvidence(modelBinding, { idleTimeoutMs: 120_000 });
  let validated = false;
  const guardedFetch: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!validated || receipt.attemptCount !== 0 || request.method !== 'POST' || url.origin !== 'https://api.anthropic.com' || url.pathname !== '/v1/messages') throw new Error('Review transport refused an unvalidated or additional inference request.');
    receipt.attemptCount = 1; receipt.status = 'reserved'; await save();
    return fetch(request, { redirect: 'error' });
  }, { preconnect: () => {} });
  const stream = models.streamSimple(model, {
    systemPrompt: 'Independently review only this fixed public-source packet. No tools, edits, helpers or external research. Prioritize the three most consequential source-grounded defects with severity, exact file and line, trigger and smallest fix. Return a concise report under 1200 words with a scoped verdict and verification limits. Use reasoning efficiently so that a final written report fits within the output allowance. Do not infer your identity from the packet.',
    messages: [{ role: 'user', content: packet, timestamp: Date.now() }],
  }, {
    reasoning: 'low', maxTokens, cacheRetention: 'none', transport: 'sse', maxRetries: 0,
    signal: AbortSignal.timeout(600_000), timeoutMs: 120_000, fetch: evidence.wrapFetch(guardedFetch),
    onPayload: payload => {
      const value = payload as Record<string, unknown>;
      const thinking = value.thinking as Record<string, unknown> | undefined;
      const outputConfig = value.output_config as Record<string, unknown> | undefined;
      if (value.model !== modelBinding.id || value.stream !== true || value.max_tokens !== maxTokens || thinking?.type !== 'adaptive' || outputConfig?.effort !== 'low') throw new Error('Review model, reasoning, or output policy changed.');
      if (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.length !== 0)) throw new Error('Review tools are forbidden.');
      if (value.speed !== undefined || value.service_tier !== undefined || value.inference_geo !== undefined || JSON.stringify(value).includes('"cache_control"')) throw new Error('Unpriced review payload modifiers are forbidden.');
      validated = true;
    },
  });
  for await (const _event of stream) { /* Consume the bounded single response without logging private transport metadata. */ }
  const message = await stream.result();
  if (!['stop', 'length'].includes(message.stopReason)) throw evidence.error ?? new Error(message.errorMessage ?? 'Review did not return a successful response.');
  const verified = evidence.verify(message.usage);
  const actualMicros = priceUsage(modelBinding, verified.usage);
  if (actualMicros > ceilingMicros) throw new Error('Review usage exceeded its conservative ceiling.');
  receipt.actualMicros = actualMicros; receipt.responseModel = verified.responseModel;
  receipt.status = message.stopReason === 'length' ? 'truncated' : 'completed';
  await Bun.write(`${output}/review.md`, message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'));
  await Bun.write(`${output}/usage.json`, `${JSON.stringify(verified.usage, null, 2)}\n`);
  await save();
  console.log(JSON.stringify(receipt));
  if (receipt.status !== 'completed') process.exitCode = 1;
} catch (error) {
  receipt.status = receipt.attemptCount ? 'uncertain' : 'not-attempted';
  receipt.reason = error instanceof Error ? error.message : 'Review failed.';
  await save(); console.error(JSON.stringify(receipt)); process.exitCode = 1;
}
