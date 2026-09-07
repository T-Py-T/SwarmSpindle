import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SwarmStore } from '../modules/swarm/index.ts';

interface BenchmarkInput { directory: string; moduleUrl: string; deadlineAt: number }
interface Timing { calls: number; totalMs: number; samples: number[] }
const WALL_BUDGET_MS = 18_500;
const COOPERATIVE_BUDGET_MS = 15_000;

function parseInput(input: unknown): BenchmarkInput {
  if (typeof input !== 'object' || input === null || !('directory' in input) || typeof input.directory !== 'string' || !('moduleUrl' in input) || typeof input.moduleUrl !== 'string' || !('deadlineAt' in input) || typeof input.deadlineAt !== 'number') throw new Error('Invalid benchmark worker input.');
  return { directory: input.directory, moduleUrl: input.moduleUrl, deadlineAt: input.deadlineAt };
}

function fileBytes(path: string): number {
  try { return statSync(path).size; }
  catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return 0; throw error; }
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

if (isMainThread) {
  const directory = mkdtempSync(join(tmpdir(), 'simpleswarm-scale-'));
  const moduleUrl = pathToFileURL(resolve(process.argv[2] ?? 'modules/swarm/index.ts')).href;
  const startedAt = Date.now();
  const worker = new Worker(new URL(import.meta.url), { workerData: { directory, moduleUrl, deadlineAt: startedAt + COOPERATIVE_BUDGET_MS } });
  console.log(JSON.stringify({ kind: 'benchmark_start', moduleUrl, maxWallMs: WALL_BUDGET_MS, maxWorkMs: COOPERATIVE_BUDGET_MS, fixture: 'Synthetic local data; zero provider calls; two scenarios, 30 agents each, stable 1 MiB then 5 MiB references, three 256 KiB artifact revisions and 200 trace appends per scenario.' }));
  let watchdogFired = false;
  let exitCode = 0;
  await new Promise<void>(resolveExit => {
    const watchdog = setTimeout(() => {
      watchdogFired = true; exitCode = 2;
      console.log(JSON.stringify({ kind: 'benchmark_watchdog', elapsedMs: Date.now() - startedAt, completed: false }));
      void worker.terminate();
    }, WALL_BUDGET_MS);
    worker.on('message', message => { console.log(JSON.stringify(message)); });
    worker.once('error', error => { exitCode = 1; console.error(JSON.stringify({ kind: 'benchmark_error', reason: error instanceof Error ? error.message : String(error) })); });
    worker.once('exit', code => { clearTimeout(watchdog); if (code !== 0 && !watchdogFired) exitCode = 1; resolveExit(); });
  });
  rmSync(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ kind: 'benchmark_exit', elapsedMs: Date.now() - startedAt, exitCode }));
  process.exitCode = exitCode;
} else {
  const input = parseInput(workerData);
  const module: typeof import('../modules/swarm/index.ts') = await import(input.moduleUrl);
  const emit = (message: object) => parentPort?.postMessage(message);
  let stoppedEarly = false;

  for (const referenceMiB of [1, 5]) {
    if (Date.now() >= input.deadlineAt) { stoppedEarly = true; break; }
    const databasePath = join(input.directory, `reference-${referenceMiB}.sqlite`);
    const timings = new Map<string, Timing>();
    const scenarioStarted = performance.now();
    const reference = Buffer.alloc(referenceMiB * 1024 * 1024, 73).toString('base64');
    const artifactBytes = 256 * 1024;
    let store: SwarmStore | null = null;
    let appended = 0;
    let completed = false;
    let peakSqliteBytes = 0;
    let finalEvents = 0;
    let integrity = 'not checked';
    const snapshotBytes = () => fileBytes(databasePath) + fileBytes(`${databasePath}-wal`) + fileBytes(`${databasePath}-shm`);
    function measured<T>(name: string, operation: () => T): T {
      if (Date.now() >= input.deadlineAt) throw new Error('benchmark_deadline');
      const began = performance.now();
      try { return operation(); }
      finally {
        const elapsed = performance.now() - began;
        const previous = timings.get(name) ?? { calls: 0, totalMs: 0, samples: [] };
        previous.calls += 1; previous.totalMs += elapsed; previous.samples.push(elapsed); timings.set(name, previous);
      }
    }
    try {
      store = module.openSwarmStore(databasePath);
      const activeStore = store;
      const spec = module.parseSwarmSpec({ title: 'Synthetic persistence scale fixture', task: 'Produce a synthetic artifact for persistence measurement.', definitionOfDone: 'All synthetic events, budget settlements, and file revisions remain intact.', finalOutput: 'artifact.bin', agentCount: 30, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' }, budgetMicros: 50_000_000 });
      const swarm = measured('create_with_reference', () => activeStore.createSwarm(spec, [{ path: 'reference.bin', baseRevision: 0, contentBase64: reference }]));
      activeStore.registerWorker('scale-worker', process.pid);
      measured('claim_run', () => activeStore.claimNextSwarm('scale-worker'));
      for (const agent of swarm.agents) {
        const actor = { swarmId: swarm.id, agentId: agent.id };
        measured('start_agent', () => activeStore.startAgent(actor, `scale-${agent.id}`));
        const reservation = measured('reserve', () => activeStore.reserve(actor, 1000, 'Synthetic integer micros; no external request.'));
        measured('settle', () => activeStore.settle(reservation.id, 100, { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }));
      }
      const author = swarm.agents[0];
      if (!author) throw new Error('Expected 30 agents.');
      const actor = { swarmId: swarm.id, agentId: author.id };
      measured('claim_file', () => activeStore.claimFiles(actor, ['artifact.bin'], 'Synthetic artifact revisions'));
      for (let revision = 0; revision < 3; revision += 1) {
        const content = Buffer.alloc(artifactBytes, revision + 1).toString('base64');
        measured('publish_revision', () => activeStore.publishFiles(actor, [{ path: 'artifact.bin', baseRevision: revision, contentBase64: content }], 'Synthetic revision'));
      }
      for (let index = 0; index < 200; index += 1) {
        const agent = swarm.agents[index % 30];
        if (!agent) throw new Error('Missing benchmark actor.');
        const event = measured('append_trace', () => activeStore.appendEvent(swarm.id, agent.id, 'scale_trace', { index, text: 'T'.repeat(1024) }));
        appended += 1;
        if (appended % 20 === 0) {
          measured('get_status', () => activeStore.getSwarm(swarm.id));
          measured('read_event_tail', () => activeStore.events(swarm.id, Math.max(0, event.seq - 10), 10));
          measured('list_files', () => activeStore.files(swarm.id));
          peakSqliteBytes = Math.max(peakSqliteBytes, snapshotBytes());
          emit({ kind: 'benchmark_progress', referenceMiB, traceAppends: appended, elapsedMs: performance.now() - scenarioStarted, sqliteBytes: snapshotBytes() });
        }
      }
      const status = measured('verify_status', () => activeStore.getSwarm(swarm.id));
      const events = measured('verify_events', () => activeStore.events(swarm.id, 0, 10000));
      const histories = measured('verify_history', () => activeStore.fileHistory(swarm.id, 'artifact.bin'));
      const storedReference = measured('verify_reference', () => activeStore.readFile(swarm.id, 'reference.bin'));
      if (status.agents.length !== 30 || status.budget.settledMicros !== 3000 || status.budget.reservedMicros !== 0 || status.budget.uncertainMicros !== 0) throw new Error('Roster or budget conservation failed.');
      if (events.filter(event => event.kind === 'scale_trace').length !== 200 || events.some((event, index) => event.seq !== index + 1) || histories.length !== 3 || storedReference.contentBase64 !== reference) throw new Error('File or trace integrity failed.');
      finalEvents = events.length; integrity = 'passed'; completed = true;
    } catch (error) {
      if (error instanceof Error && error.message === 'benchmark_deadline') { stoppedEarly = true; integrity = 'cooperative deadline reached; partial results only'; }
      else throw error;
    } finally {
      peakSqliteBytes = Math.max(peakSqliteBytes, snapshotBytes());
      store?.close();
      emit({ kind: 'benchmark_scenario', referenceMiB, artifactRevisionBytes: artifactBytes, artifactRevisions: 3, requestedTraceAppends: 200, traceAppends: appended, completed, integrity, finalEvents, elapsedMs: performance.now() - scenarioStarted, peakSqliteBytes, closedDatabaseBytes: fileBytes(databasePath), rssBytes: process.memoryUsage().rss, operations: Object.fromEntries([...timings].map(([name, timing]) => [name, { calls: timing.calls, totalMs: timing.totalMs, p50Ms: percentile(timing.samples, 0.5), p95Ms: percentile(timing.samples, 0.95), maxMs: Math.max(...timing.samples) }])) });
    }
    if (stoppedEarly) break;
  }
  emit({ kind: 'benchmark_done', stoppedEarly, providerRequests: 0 });
  parentPort?.close();
}
