/** One authorized challenge attempt. Existing receipts and matching runs prevent accidental new budgets. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { openSwarmStore, parseSwarmSpec } from '@simpleswarm/swarm';
import { readConfig } from '../apps/shared/config.ts';
import { parseModel, parsePrompt } from '../apps/shared/prompt.ts';
import { readSeedDirectory } from '../apps/shared/seeds.ts';

const [kind, target, seedDirectory, ...extra] = process.argv.slice(2);
if (!['pelican', 'canvas'].includes(kind ?? '') || !target || extra.length || (kind === 'canvas' ? !seedDirectory : Boolean(seedDirectory))) {
  throw new Error('Usage: bun tooling/run-challenge.ts pelican NEW_DIRECTORY | canvas NEW_DIRECTORY SEED_DIRECTORY');
}
const config = readConfig();
const store = openSwarmStore(config.databasePath);
const directory = resolve(target);
const terminal = new Set(['completed', 'bailed', 'failed', 'cancelled', 'budget_exhausted', 'interrupted']);
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function child(args: string[]) {
  const execution = Bun.spawn([process.execPath, ...args], { stdout: 'inherit', stderr: 'inherit' });
  return execution.exited;
}
try {
  let precedingAttempt: { swarmId: string; status: string; acceptanceAssessedByRunner: false } | undefined;
  const promptPath = kind === 'pelican' ? 'prompts/demo/USER_PROMPT_PELICAN.md' : 'prompts/demo/USER_PROMPT_CANVAS_FROM_VIDEO.md';
  const prompt = parsePrompt(await Bun.file(promptPath).text());
  const model = parseModel(kind === 'pelican' ? 'opus48' : 'gpt55');
  if (!store.listWorkers().some(worker => worker.status === 'online' && Date.now() - worker.heartbeatAt < 5000)) {
    throw new Error('Start the live worker before queuing acceptance.');
  }
  if (kind === 'canvas') {
    const prior = await Bun.file(`${config.dataDirectory}/acceptance-pelican.json`).json();
    if (prior.kind !== 'pelican' || typeof prior.swarmId !== 'string') throw new Error('The durable pelican attempt has no verified run identity.');
    const pelican = store.getSwarm(prior.swarmId);
    if (prior.specSha256 !== fingerprint(pelican.spec) || pelican.spec.model.provider !== 'anthropic' || pelican.spec.model.id !== 'claude-opus-4-8' || pelican.spec.model.thinking !== 'high' || pelican.spec.agentCount !== 30 || pelican.spec.budgetMicros !== 50_000_000 || pelican.spec.finalOutput !== 'pelican.svg' || !terminal.has(pelican.status) || !pelican.startedAt || pelican.agents.some(agent => !agent.sessionId) || new Set(pelican.agents.map(agent => agent.sessionId)).size !== 30) {
      throw new Error('The exact authorized 30-peer pelican attempt must finish before canvas starts.');
    }
    // The user authorized two ordered attempts with separate caps, not a replacement for a failed first attempt.
    // Runtime completion alone also cannot establish artifact acceptance; the external report owns that verdict.
    precedingAttempt = { swarmId: pelican.id, status: pelican.status, acceptanceAssessedByRunner: false };
  }
  const seeds = seedDirectory ? await readSeedDirectory(resolve(seedDirectory)) : [];
  await mkdir(directory, { mode: 0o700 });
  const intent = { kind, agentCount: 30, model, budgetMicros: 50_000_000, promptPath, directory, createdAt: new Date().toISOString(), automaticRetry: false, precedingAttempt };
  const claimPath = `${config.dataDirectory}/acceptance-${kind}.json`;
  // Exclusive persistent claim serializes launchers even across different output directories.
  // Never remove it automatically: a crash may have happened immediately after queue creation.
  await writeFile(claimPath, JSON.stringify({ ...intent, swarmId: null }), { flag: 'wx', mode: 0o600 });
  if (store.listSwarms().some(run => run.spec.model.id === model.id && run.spec.finalOutput === prompt.finalOutput && run.spec.agentCount === 30)) {
    throw new Error('A matching challenge already exists. Inspect its original ledger; this runner never creates a replacement budget.');
  }
  await writeFile(`${directory}/intent.json`, JSON.stringify(intent, null, 2), { flag: 'wx', mode: 0o600 });
  const run = store.createSwarm(parseSwarmSpec({ ...prompt, title: kind === 'pelican' ? 'Pelican · 30 Opus 4.8 High' : 'Canvas · 30 GPT-5.5 High', agentCount: 30, model, budgetMicros: 50_000_000, maxOutputTokens: 16000 }), seeds);
  await writeFile(claimPath, JSON.stringify({ ...intent, swarmId: run.id, specSha256: fingerprint(run.spec) }, null, 2), { mode: 0o600 });
  await writeFile(`${directory}/launch.json`, JSON.stringify({ swarmId: run.id, dashboard: `http://127.0.0.1:${config.port}/?swarm=${run.id}`, spec: run.spec }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ kind, swarmId: run.id, status: 'queued', agents: 30, model, cap: 50 }));
  const deadline = Date.now() + run.spec.maxRunMs + 180_000;
  let lastStatus = '';
  for (;;) {
    const current = store.getSwarm(run.id);
    if (current.status !== lastStatus) { console.log(JSON.stringify({ swarmId: run.id, status: current.status, budget: current.budget })); lastStatus = current.status; }
    if (terminal.has(current.status)) break;
    if (Date.now() > deadline) throw new Error(`Acceptance observer deadline exceeded for ${run.id}; inspect the existing run. No replacement or budget reset occurred.`);
    await Bun.sleep(5000);
  }
  if (await child(['apps/cli/main.ts', 'export', run.id, `${directory}/export`]) !== 0) throw new Error('Terminal export failed.');
  const result = await child(['tooling/verify-artifact.ts', run.id, kind === 'pelican' ? 'svg' : 'canvas', `${directory}/verification`]);
  if (result !== 0) process.exitCode = result;
} finally { store.close(); }
