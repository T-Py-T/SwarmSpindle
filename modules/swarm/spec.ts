import { z } from 'zod';
import { SwarmError, normalizeWorkspacePath, type SwarmSpec } from './contracts.ts';

export const microdollars = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const timestamp = microdollars;
export const boundedText = z.string().trim().min(1).max(200_000);
export const specSchema = z.object({
  title: z.string().trim().min(1).max(200).default('New swarm'),
  task: boundedText,
  definitionOfDone: boundedText,
  finalOutput: z.string().min(1).max(512).refine(value => { try { return normalizeWorkspacePath(value) === value; } catch { return false; } }, 'Final output must be a canonical relative file path.'),
  agentCount: z.number().int().min(1).max(100).default(5),
  model: z.discriminatedUnion('provider', [
    z.object({ provider: z.literal('anthropic'), id: z.literal('claude-opus-4-8'), thinking: z.literal('high') }).strict(),
    z.object({ provider: z.literal('openai-codex'), id: z.literal('gpt-5.5'), thinking: z.literal('high') }).strict(),
  ]),
  budgetMicros: microdollars.refine(value => value > 0),
  maxOutputTokens: z.number().int().min(1024).max(128_000).default(16000),
  maxTurnsPerAgent: z.number().int().min(1).max(10000).default(100),
  maxRunMs: z.number().int().min(1000).max(604_800_000).default(3_600_000),
  idleTimeoutMs: z.number().int().min(1000).max(86_400_000).default(120_000),
}).strict();

export function parseSwarmSpec(input: unknown): z.output<typeof specSchema> {
  const result = specSchema.safeParse(input);
  if (!result.success) throw new SwarmError('invalid_spec', result.error.message);
  return result.data;
}
