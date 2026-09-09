import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openSwarmStore, parseSwarmSpec, type FileChange, type SwarmRecord, type SwarmSpec, type SwarmStore, type TraceEvent } from '@simpleswarm/swarm';
import { readConfig } from '../apps/shared/config.ts';
import { parsePrompt } from '../apps/shared/prompt.ts';
import { assessBudgetProbe } from './budget-probe.ts';

export const retestKinds = ['budget', 'pelican', 'canvas'] as const;
export type RetestKind = typeof retestKinds[number];
export const challengeKinds = ['pelican', 'canvas'] as const;
type ChallengeKind = typeof challengeKinds[number];
const promptFiles = { budget: 'budget-probe.md', pelican: 'retest-pelican.md', canvas: 'retest-canvas.md' };
const terminal = new Set(['completed', 'bailed', 'failed', 'cancelled', 'budget_exhausted', 'interrupted']);

export async function retestSpec(kind: RetestKind): Promise<SwarmSpec> {
  const prompt = parsePrompt(await Bun.file(new URL(`../prompts/${promptFiles[kind]}`, import.meta.url)).text());
  return parseSwarmSpec({ ...prompt, title: `${kind[0]!.toUpperCase()}${kind.slice(1)} retest · 2 Opus 4.8 peers`,
    agentCount: 2, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' },
    budgetMicros: 6_000_000, workingTargetMicros: 1_000_000, maxOutputTokens: 4096,
    maxTurnsPerAgent: 12, maxRunMs: 300_000, idleTimeoutMs: 120_000 });
}

/** A durable allocation claim prevents replaying the batch under another output directory. */
export async function claimRetestBatch(claimPath: string, directory: string): Promise<void> {
  await writeFile(claimPath, JSON.stringify({ directory, kinds: retestKinds, automaticRetry: false,
    workingTargetTotalMicros: 3_000_000, hardCeilingTotalMicros: 18_000_000 }), { flag: 'wx', mode: 0o600 });
}

export async function challengeSpec(kind: ChallengeKind): Promise<SwarmSpec> {
  return parseSwarmSpec({ ...await retestSpec(kind), title: `${kind === 'pelican' ? 'Pelican' : 'Canvas'} challenge · 2 Opus 4.8 peers`,
    budgetMicros: 50_000_000, workingTargetMicros: 40_000_000, maxOutputTokens: 16_000,
    maxTurnsPerAgent: 60, maxRunMs: 1_200_000, idleTimeoutMs: 120_000 });
}

/** Recompute the prerequisite from the local ledger and trace, never from a caller's pass flag. */
export function requireGuidanceEvidence(store: SwarmStore, swarmId: string) {
  const run = store.getSwarm(swarmId); const events: TraceEvent[] = []; let after = 0;
  for (;;) {
    const page = store.events(swarmId, after, 1000); events.push(...page);
    if (page.length < 1000) break;
    after = page.at(-1)!.seq;
  }
  const messages = store.threads(swarmId).flatMap(thread => store.messages(swarmId, thread.id));
  const assessment = assessBudgetProbe(run, events, messages, store.files(swarmId).some(file => file.path === 'budget-report.md' && file.size > 0));
  const model = run.spec.model;
  const verifiedPeers = new Set(events.filter(event => {
    const response = event.payload;
    return event.kind === 'model_response' && response !== null && typeof response === 'object' && !Array.isArray(response)
      && response.provider === 'anthropic' && response.responseModel === 'claude-opus-4-8'
      && response.requestedModel === 'claude-opus-4-8' && response.thinking === 'high';
  }).map(event => event.agentId));
  if (!assessment.passed || model.provider !== 'anthropic' || model.id !== 'claude-opus-4-8' || model.thinking !== 'high'
    || run.budget.settledMicros <= 0 || run.budget.reservedMicros !== 0 || run.budget.uncertainMicros !== 0
    || !run.agents.every(agent => verifiedPeers.has(agent.id))) throw new Error('Larger challenges require a completed Claude budget probe with two accurate observations per peer, verified model responses and fully settled usage.');
  return assessment;
}

export async function claimChallengeBatch(claimPath: string, directory: string, guidanceSwarmId: string): Promise<void> {
  await writeFile(claimPath, JSON.stringify({ directory, kinds: challengeKinds, guidanceSwarmId, automaticRetry: false,
    workingTargetTotalMicros: 80_000_000, hardCeilingTotalMicros: 100_000_000 }), { flag: 'wx', mode: 0o600 });
}

export function canvasSeeds(store: SwarmStore, sourceId: string): FileChange[] {
  const originals = store.files(sourceId).filter(file => file.path.startsWith('reference/'));
  if (!originals.some(file => /\.png$/.test(file.path)) || !originals.some(file => file.path === 'reference/README.md')) throw new Error('Canvas retest needs original reference images and notes.');
  return originals.map(file => ({ path: file.path, baseRevision: 0, contentBase64: file.contentBase64 }));
}

async function waitForTerminal(store: SwarmStore, run: SwarmRecord): Promise<SwarmRecord> {
  const deadline = Date.now() + run.spec.maxRunMs + 60_000;
  for (;;) {
    const current = store.getSwarm(run.id);
    if (terminal.has(current.status)) return current;
    if (Date.now() >= deadline) throw new Error(`Observer timed out for ${run.id}; inspect that existing run. No replacement budget was allocated.`);
    await Bun.sleep(500);
  }
}

async function child(args: string[]): Promise<number> {
  const process = Bun.spawn([Bun.which('bun') ?? 'bun', ...args], { cwd: new URL('..', import.meta.url).pathname, stdout: 'inherit', stderr: 'inherit' });
  return process.exited;
}

async function main(): Promise<void> {
  const [mode, output, sourceId, guidanceId, ...extra] = process.argv.slice(2);
  const challenge = mode === 'plan-large' || mode === 'launch-large';
  const launch = mode === 'launch' || mode === 'launch-large';
  if (!['plan', 'launch', 'plan-large', 'launch-large'].includes(mode ?? '') || extra.length
    || (launch ? !output || !sourceId || (challenge ? !guidanceId : Boolean(guidanceId)) : Boolean(output || sourceId || guidanceId))) {
    throw new Error('Usage: swarm-retest.ts plan | plan-large | launch NEW_DIRECTORY ORIGINAL_CANVAS_ID | launch-large NEW_DIRECTORY ORIGINAL_CANVAS_ID PASSED_BUDGET_SWARM_ID. Each stage allocates paid Claude-only runs once.');
  }
  const kinds: readonly RetestKind[] = challenge ? challengeKinds : retestKinds;
  const specs = challenge ? await Promise.all(challengeKinds.map(challengeSpec)) : await Promise.all(retestKinds.map(retestSpec));
  if (!launch) { console.log(JSON.stringify({ paidRequests: false, specs, aggregateHardCeilingMicros: specs.reduce((sum, spec) => sum + spec.budgetMicros, 0) }, null, 2)); return; }
  const config = readConfig(); const store = openSwarmStore(config.databasePath);
  try {
    if (store.listSwarms().some(run => !terminal.has(run.status))) throw new Error('Finish existing swarms before this isolated batch.');
    if (!store.listWorkers().some(worker => worker.status === 'online' && Date.now() - worker.heartbeatAt < 5000)) throw new Error('An updated worker must be online.');
    const seeds = canvasSeeds(store, sourceId!);
    const guidance = challenge ? requireGuidanceEvidence(store, guidanceId!) : null;
    const directory = resolve(output!); await mkdir(directory, { mode: 0o700 });
    if (challenge) {
      await claimChallengeBatch(`${config.dataDirectory}/swarm-challenge-budget-feedback-opus48.json`, directory, guidanceId!);
      await writeFile(`${directory}/guidance-prerequisite.json`, JSON.stringify(guidance, null, 2), { flag: 'wx', mode: 0o600 });
    } else await claimRetestBatch(`${config.dataDirectory}/swarm-retest-budget-feedback-opus48.json`, directory);
    const results: Array<{ kind: RetestKind; swarmId: string; status: string; budget: SwarmRecord['budget']; verifierExit: number }> = [];
    for (const [index, kind] of kinds.entries()) {
      const spec = specs[index]; if (!spec) throw new Error('Missing fixed retest specification.');
      const target = `${directory}/${kind}`; await mkdir(target, { mode: 0o700 });
      // Persist intent before queue visibility; an interrupted observer never retries this allocation.
      await writeFile(`${target}/intent.json`, JSON.stringify({ kind, spec, automaticRetry: false }), { flag: 'wx', mode: 0o600 });
      const run = store.createSwarm(spec, kind === 'canvas' ? seeds : []);
      await writeFile(`${target}/launch.json`, JSON.stringify({ swarmId: run.id, spec }), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ kind, swarmId: run.id, status: 'queued', workingTarget: spec.workingTargetMicros! / 1_000_000, hardCeiling: spec.budgetMicros / 1_000_000 }));
      const finished = await waitForTerminal(store, run);
      if (await child(['apps/cli/main.ts', 'export', run.id, `${target}/export`]) !== 0) throw new Error(`Export failed for existing run ${run.id}.`);
      const verifierExit = kind === 'budget'
        ? await child(['tooling/budget-probe.ts', 'verify', run.id, `${target}/verification`])
        : await child(['tooling/verify-artifact.ts', run.id, kind === 'pelican' ? 'svg' : 'canvas', `${target}/verification`]);
      results.push({ kind, swarmId: run.id, status: finished.status, budget: finished.budget, verifierExit });
      await writeFile(`${directory}/results.json`, JSON.stringify({ results, automaticRetry: false, artifactReviewRequired: true }, null, 2), { mode: 0o600 });
    }
    console.log(JSON.stringify({ results, artifactReviewRequired: true }));
    if (results.some(result => result.verifierExit !== 0)) process.exitCode = 1;
  } finally { store.close(); }
}

if (import.meta.main) await main().catch(error => { console.error(error instanceof Error ? error.message : 'Retest failed.'); process.exitCode = 1; });
