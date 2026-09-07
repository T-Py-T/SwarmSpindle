import type { ModelBinding } from '@simpleswarm/swarm';

export function parsePrompt(document: string): { task: string; definitionOfDone: string; finalOutput: string } {
  const heading = /^##\s+Definition of Done\s*$/im.exec(document);
  if (!heading) throw new Error('Prompt must include a "## Definition of Done" section.');
  const task = document.slice(0, heading.index).trim();
  const definitionOfDone = document.slice(heading.index + heading[0].length).trim();
  const finalOutput = /^Final output:\s*`?([^`\r\n]+)`?\s*$/im.exec(task)?.[1]?.trim();
  if (!task || !definitionOfDone || !finalOutput) throw new Error('Prompt requires a task, definition of done, and "Final output: filename".');
  return { task, definitionOfDone, finalOutput };
}

export function parseModel(alias: string): ModelBinding {
  if (['opus48', 'opus-4.8', 'anthropic/claude-opus-4-8', 'claude-opus-4-8'].includes(alias)) return { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' };
  if (['gpt55', 'gpt-5.5', 'openai-codex/gpt-5.5'].includes(alias)) return { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' };
  throw new Error('Supported models: opus48 (Opus 4.8 High) or gpt55 (GPT-5.5 High). No model substitution is performed.');
}

export function parseDollars(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Budget must be positive dollars with at most two decimal places.');
  const [whole, cents = ''] = value.split('.');
  const micros = Number(whole) * 1_000_000 + Number(cents.padEnd(2, '0')) * 10_000;
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error('Invalid budget.');
  return micros;
}
