import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSwarmStore, parseSwarmSpec, type SwarmRecord, type SwarmStore } from '../modules/swarm/index.ts';
import type { SwarmRuntime } from '../modules/runtime/contracts.ts';
import { createWorkerScheduler, type WorkerScheduler, type WorkerSchedulerOptions } from '../apps/worker/scheduler.ts';

const directories: string[] = [];
const stores: SwarmStore[] = [];
const schedulers: WorkerScheduler[] = [];

afterEach(async () => {
  await Promise.allSettled(schedulers.splice(0).map(scheduler => scheduler.shutdown()));
  stores.splice(0).forEach(store => store.close());
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});

function fixture() {
  let now = 1000;
  const directory = mkdtempSync(join(tmpdir(), 'swarm-worker-')); directories.push(directory);
  const path = join(directory, 'state.sqlite');
  const store = openSwarmStore(path, { clock: () => now }); stores.push(store);
  function queue() {
    return store.createSwarm(parseSwarmSpec({ title: 'Scheduler test', task: 'Produce a tested SVG', definitionOfDone: 'SVG is present and verified', finalOutput: 'result.svg', agentCount: 1, model: { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' }, budgetMicros: 100, maxRunMs: 1000 }));
  }
  return { store, path, queue, clock: () => now, advance: (milliseconds: number) => { now += milliseconds; } };
}

function controlledRuntime(store: SwarmStore) {
  const started: string[] = [];
  const aborted: string[] = [];
  const gates = new Map<string, { resolve: () => void; reject: (reason: unknown) => void }>();
  let disposeCount = 0;
  const runtime: SwarmRuntime = {
    preflight: async run => ({ model: run.spec.model, ready: true, reason: 'Deterministic scheduler fixture', billing: 'metered-usd', pricingEvidence: 'No provider calls in this test' }),
    async run(run: SwarmRecord, signal: AbortSignal) {
      started.push(run.id);
      for (const agent of run.agents) store.startAgent({ swarmId: run.id, agentId: agent.id }, `fixture-${agent.id}`);
      let onAbort = () => {};
      try {
        await new Promise<void>((resolve, reject) => {
          gates.set(run.id, { resolve, reject });
          onAbort = () => { aborted.push(run.id); reject(signal.reason); };
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        for (const agent of run.agents) store.endAgent({ swarmId: run.id, agentId: agent.id }, 'done', 'Fixture completed');
        store.finishSwarm(run.id, 'completed', 'Deterministic fixture completed');
      } finally { signal.removeEventListener('abort', onAbort); gates.delete(run.id); }
    },
    async dispose() { disposeCount += 1; },
  };
  return { runtime, started, aborted, complete: (id: string) => gates.get(id)?.resolve(), fail: (id: string) => gates.get(id)?.reject(new Error('Injected transport crash')), disposeCount: () => disposeCount };
}

function schedulerFor(f: ReturnType<typeof fixture>, control: ReturnType<typeof controlledRuntime>, overrides: Partial<WorkerSchedulerOptions> = {}) {
  const stopped: string[] = []; const errors: unknown[] = [];
  const scheduler = createWorkerScheduler({ store: f.store, runtime: control.runtime, sandbox: { check: async () => ({ ready: true, reason: 'Deterministic isolated executor fixture', image: 'fixture' }), stop: async id => { stopped.push(id); } }, workerId: `worker-${schedulers.length}`, pid: 123 + schedulers.length, clock: f.clock, processPresence: () => 'alive', reportError: error => { errors.push(error); }, ...overrides });
  schedulers.push(scheduler); scheduler.start();
  return { scheduler, stopped, errors };
}

async function microtasksUntil(predicate: () => boolean) {
  for (let index = 0; index < 100 && !predicate(); index += 1) await Promise.resolve();
  expect(predicate()).toBe(true);
}

describe('independent durable worker scheduling', () => {
  test('two swarms overlap without a browser and a third waits for a free slot', async () => {
    const f = fixture(); const runs = [f.queue(), f.queue(), f.queue()]; const control = controlledRuntime(f.store); const { scheduler } = schedulerFor(f, control);
    await scheduler.tick(); await microtasksUntil(() => control.started.length === 2);
    expect(scheduler.activeSwarmIds()).toEqual(runs.slice(0, 2).map(run => run.id)); expect(f.store.getSwarm(runs[2]!.id).status).toBe('queued');
    control.complete(runs[0]!.id); await microtasksUntil(() => scheduler.activeSwarmIds().length === 1);
    await scheduler.tick(); await microtasksUntil(() => control.started.length === 3);
    expect(f.store.getSwarm(runs[0]!.id).status).toBe('completed'); expect(scheduler.activeSwarmIds()).toContain(runs[1]!.id); expect(scheduler.activeSwarmIds()).toContain(runs[2]!.id);
  });

  test('two worker connections never claim the same queued run', async () => {
    const f = fixture(); const runs = Array.from({ length: 4 }, () => f.queue());
    const secondStore = openSwarmStore(f.path, { clock: f.clock }); stores.push(secondStore);
    const first = controlledRuntime(f.store); const second = controlledRuntime(secondStore);
    const one = schedulerFor(f, first); const two = schedulerFor(f, second, { store: secondStore });
    await Promise.all([one.scheduler.tick(), two.scheduler.tick()]); await microtasksUntil(() => first.started.length + second.started.length === 4);
    expect(new Set([...first.started, ...second.started]).size).toBe(4);
    expect(runs.map(run => f.store.getSwarm(run.id).workerId).filter(id => id === 'worker-0')).toHaveLength(2);
    expect(runs.map(run => f.store.getSwarm(run.id).workerId).filter(id => id === 'worker-1')).toHaveLength(2);
  });

  test('operator stopping aborts the runtime, releases resources, and retains unresolved billing', async () => {
    const f = fixture(); const run = f.queue(); const control = controlledRuntime(f.store); const { scheduler, stopped } = schedulerFor(f, control);
    await scheduler.tick(); await microtasksUntil(() => control.started.length === 1);
    f.store.reserve({ swarmId: run.id, agentId: run.agents[0]!.id }, 40, 'Maximum known request cost'); f.store.stopSwarm(run.id, 'User stop');
    await scheduler.tick(); await microtasksUntil(() => scheduler.activeSwarmIds().length === 0);
    expect(control.aborted).toEqual([run.id]); expect(f.store.getSwarm(run.id).status).toBe('cancelled'); expect(stopped).toContain(run.id); expect(f.store.budget(run.id).uncertainMicros).toBe(40);
  });

  test('unexpected runtime rejection fails the run and leaves the worker available', async () => {
    const f = fixture(); const run = f.queue(); const control = controlledRuntime(f.store); const { scheduler, errors, stopped } = schedulerFor(f, control);
    await scheduler.tick(); await microtasksUntil(() => control.started.length === 1); control.fail(run.id);
    await microtasksUntil(() => scheduler.activeSwarmIds().length === 0);
    expect(f.store.getSwarm(run.id).status).toBe('failed'); expect(stopped).toContain(run.id); expect(errors.length).toBeGreaterThan(0);
    const next = f.queue(); await scheduler.tick(); await microtasksUntil(() => control.started.includes(next.id));
  });

  test('deadline is a failure and shutdown interrupts all runs, disposes once, and leaves queued work intact', async () => {
    const f = fixture(); const deadlineRun = f.queue(); const control = controlledRuntime(f.store); const { scheduler, stopped } = schedulerFor(f, control);
    await scheduler.tick(); await microtasksUntil(() => control.started.length === 1); f.advance(1001); await scheduler.tick();
    await microtasksUntil(() => scheduler.activeSwarmIds().length === 0); expect(f.store.getSwarm(deadlineRun.id).status).toBe('failed');
    const first = f.queue(); const second = f.queue(); const queued = f.queue(); await scheduler.tick(); await microtasksUntil(() => control.started.length === 3);
    await Promise.all([scheduler.shutdown(), scheduler.shutdown()]);
    expect(f.store.getSwarm(first.id).status).toBe('interrupted'); expect(f.store.getSwarm(second.id).status).toBe('interrupted'); expect(f.store.getSwarm(queued.id).status).toBe('queued');
    expect(stopped).toContain(first.id); expect(stopped).toContain(second.id); expect(control.disposeCount()).toBe(1); expect(f.store.listWorkers()[0]?.status).toBe('offline');
    await scheduler.tick(); expect(control.started).toHaveLength(3);
  });

  test('dead worker recovery retains uncertain liability and never replays claimed work', async () => {
    const f = fixture(); const orphan = f.queue(); f.store.registerWorker('dead', 999);
    f.store.claimNextSwarm('dead'); const actor = { swarmId: orphan.id, agentId: orphan.agents[0]!.id }; f.store.startAgent(actor, 'lost-session'); f.store.reserve(actor, 75, 'Known maximum'); f.advance(31_000);
    const control = controlledRuntime(f.store); const { scheduler, stopped } = schedulerFor(f, control, { processPresence: pid => pid === 999 ? 'absent' : 'alive' });
    await scheduler.tick(); expect(f.store.getSwarm(orphan.id).status).toBe('interrupted'); expect(f.store.budget(orphan.id).uncertainMicros).toBe(75); expect(f.store.budget(orphan.id).availableMicros).toBe(25); expect(control.started).toEqual([]); expect(stopped).toContain(orphan.id);
    f.advance(31_000); await scheduler.tick(); expect(control.started).toEqual([]); expect(f.store.listWorkers().find(worker => worker.id === 'dead')?.status).toBe('offline');
    const reopened = openSwarmStore(f.path); stores.push(reopened); expect(reopened.getSwarm(orphan.id).status).toBe('interrupted'); expect(reopened.budget(orphan.id).uncertainMicros).toBe(75);
  });

  test('stale heartbeat with reused live PID, unknown liveness, or future clock is not proof of death', async () => {
    const f = fixture(); const live = f.queue(); f.store.registerWorker('old-pid-reused', 900); f.store.claimNextSwarm('old-pid-reused');
    const unknown = f.queue(); f.store.registerWorker('permission-denied', 901); f.store.claimNextSwarm('permission-denied');
    f.advance(90_000); const future = f.queue(); f.store.registerWorker('future-clock', 902); f.store.claimNextSwarm('future-clock'); f.advance(-40_000);
    const probes: number[] = []; const control = controlledRuntime(f.store); const { scheduler } = schedulerFor(f, control, { processPresence: pid => { probes.push(pid); return pid === 900 ? 'alive' : pid === 901 ? 'unknown' : 'absent'; } });
    await scheduler.tick(); expect([live, unknown, future].map(run => f.store.getSwarm(run.id).status)).toEqual(['running', 'running', 'running']); expect(probes).not.toContain(902); expect(control.started).toEqual([]);
  });

  test('preflight failure and runtime returning without a terminal result cannot appear successful', async () => {
    const f = fixture(); const first = f.queue(); const second = f.queue(); const control = controlledRuntime(f.store);
    const runtime: SwarmRuntime = { ...control.runtime, preflight: async run => ({ model: run.spec.model, ready: run.id !== first.id, reason: 'Fixture provider unavailable', billing: 'metered-usd', pricingEvidence: 'Fixture' }), run: async () => {} };
    const { scheduler } = schedulerFor(f, control, { runtime }); await scheduler.tick(); await microtasksUntil(() => scheduler.activeSwarmIds().length === 0);
    expect(f.store.getSwarm(first.id).status).toBe('failed'); expect(f.store.getSwarm(second.id).status).toBe('failed');
  });

  test('cleanup failure prevents new work and makes shutdown failure visible', async () => {
    const f = fixture(); const run = f.queue(); const control = controlledRuntime(f.store);
    const { scheduler } = schedulerFor(f, control, { maxConcurrentSwarms: 1, sandbox: { check: async () => ({ ready: true, reason: 'Fixture', image: 'fixture' }), stop: async () => { throw new Error('Injected container cleanup failure'); } } });
    await scheduler.tick(); await microtasksUntil(() => control.started.length === 1); control.complete(run.id);
    await microtasksUntil(() => scheduler.activeSwarmIds().length === 0);
    const queued = f.queue(); await expect(scheduler.tick()).rejects.toThrow('Worker will stop accepting runs'); expect(f.store.getSwarm(queued.id).status).toBe('queued');
    expect(f.store.events(run.id).some(event => event.kind === 'sandbox_cleanup_failed')).toBe(true);
    await expect(scheduler.shutdown()).rejects.toThrow('Worker will stop accepting runs'); expect(f.store.listWorkers()[0]?.status).toBe('offline');
  });
});
