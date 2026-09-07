import { SwarmError, type SwarmRecord, type SwarmStore, type WorkerRecord } from '@simpleswarm/swarm';
import type { SwarmRuntime } from '@simpleswarm/runtime';
import type { Sandbox } from '@simpleswarm/sandbox';

type ProcessPresence = 'alive' | 'absent' | 'unknown';
type AbortReason = 'operator' | 'deadline' | 'shutdown';

export interface WorkerSchedulerOptions {
  store: SwarmStore;
  runtime: SwarmRuntime;
  sandbox: Pick<Sandbox, 'check' | 'stop'>;
  workerId: string;
  pid: number;
  maxConcurrentSwarms?: number;
  staleWorkerMs?: number;
  clock?: () => number;
  processPresence?: (pid: number) => ProcessPresence;
  reportError?: (error: unknown) => void;
}

export interface WorkerScheduler {
  start(): void;
  tick(): Promise<void>;
  shutdown(): Promise<void>;
  activeSwarmIds(): string[];
}

interface ActiveRun {
  controller: AbortController;
  deadlineAt: number;
  abortReason: AbortReason | null;
  completion: Promise<void>;
}

const activeStatuses = new Set(['running', 'stopping']);
const failureMessage = (error: unknown) => error instanceof Error ? error.message : 'Unknown worker failure.';

export function inspectProcessPresence(pid: number): ProcessPresence {
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') return 'absent';
    return 'unknown';
  }
}

export function createWorkerScheduler(options: WorkerSchedulerOptions): WorkerScheduler {
  const { store, runtime, sandbox, workerId, pid } = options;
  const clock = options.clock ?? Date.now;
  const processPresence = options.processPresence ?? inspectProcessPresence;
  const concurrency = options.maxConcurrentSwarms ?? 2;
  const staleWorkerMs = options.staleWorkerMs ?? 30_000;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Worker concurrency must be an integer between 1 and 16.');
  if (!Number.isSafeInteger(staleWorkerMs) || staleWorkerMs < 1000) throw new Error('Stale worker interval must be at least one second.');
  const active = new Map<string, ActiveRun>();
  let started = false;
  let stopping = false;
  let tickPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let nextRecoveryAt = 0;
  let cleanupFailure: Error | null = null;

  function report(error: unknown): void {
    try { options.reportError?.(error); } catch { /* Reporting must not break cleanup. */ }
  }

  function retainUnsettledLiability(runId: string, reason: string): void {
    for (const reservation of store.reservations(runId)) {
      if (reservation.status !== 'reserved') continue;
      try { store.markUncertain(reservation.id, reason); }
      catch (error) { if (!(error instanceof SwarmError && error.code === 'reservation_settled')) throw error; }
    }
  }

  function finishUnresolved(runId: string, status: 'failed' | 'cancelled' | 'interrupted', reason: string): void {
    retainUnsettledLiability(runId, reason);
    if (!activeStatuses.has(store.getSwarm(runId).status)) return;
    try { store.finishSwarm(runId, status, reason); }
    catch (error) { if (!(error instanceof SwarmError && error.code === 'run_terminal')) throw error; }
  }

  async function execute(run: SwarmRecord, entry: ActiveRun): Promise<void> {
    try {
      const isolation = await sandbox.check();
      if (!isolation.ready) throw new Error(isolation.reason);
      entry.controller.signal.throwIfAborted();
      const readiness = await runtime.preflight(run);
      store.appendEvent(run.id, null, 'preflight', { ...readiness, model: { ...readiness.model } });
      if (!readiness.ready) throw new Error(readiness.reason);
      entry.controller.signal.throwIfAborted();
      await runtime.run(run, entry.controller.signal);
      if (activeStatuses.has(store.getSwarm(run.id).status)) throw new Error('Runtime returned without a terminal swarm status.');
      retainUnsettledLiability(run.id, 'Runtime ended with an unreconciled provider attempt.');
    } catch (error) {
      const status = entry.abortReason === 'operator' ? 'cancelled' : entry.abortReason === 'shutdown' ? 'interrupted' : 'failed';
      try { finishUnresolved(run.id, status, failureMessage(error)); } catch (persistenceError) { report(persistenceError); }
      report(error);
    } finally {
      try { await sandbox.stop(run.id); }
      catch (error) {
        cleanupFailure = new Error(`Sandbox cleanup failed for ${run.id}. Worker will stop accepting runs.`, { cause: error });
        report(error);
        try { store.appendEvent(run.id, null, 'sandbox_cleanup_failed', { reason: failureMessage(error) }); } catch (persistenceError) { report(persistenceError); }
      }
      active.delete(run.id);
    }
  }

  function abortRun(runId: string, entry: ActiveRun, reason: AbortReason): void {
    if (entry.controller.signal.aborted) return;
    entry.abortReason = reason;
    const message = reason === 'operator' ? 'Stopped by operator.' : reason === 'deadline' ? 'Swarm time limit reached.' : 'Worker shutting down.';
    store.appendEvent(runId, null, 'worker_abort_requested', { reason });
    const error = new Error(message);
    error.name = reason === 'deadline' ? 'WorkerDeadlineError' : reason === 'shutdown' ? 'WorkerShutdownError' : 'AbortError';
    entry.controller.abort(error);
  }

  function unchangedWorker(expected: WorkerRecord): boolean {
    const current = store.listWorkers().find(worker => worker.id === expected.id);
    return current !== undefined && current.pid === expected.pid && current.startedAt === expected.startedAt && current.heartbeatAt === expected.heartbeatAt;
  }

  async function recoverDeadWorkers(now: number): Promise<void> {
    for (const worker of store.listWorkers()) {
      if (worker.id === workerId || worker.startedAt > worker.heartbeatAt || now < worker.heartbeatAt || now - worker.heartbeatAt < staleWorkerMs) continue;
      // Staleness does not prove death: reused PIDs, EPERM, and clock ambiguity leave runs untouched.
      if (processPresence(worker.pid) !== 'absent' || !unchangedWorker(worker)) continue;
      for (const run of store.listSwarms().filter(candidate => candidate.workerId === worker.id && activeStatuses.has(candidate.status))) {
        if (!unchangedWorker(worker)) break;
        const reason = 'Worker exited before reconciliation. Uncertain request liabilities are retained; this swarm will not be replayed.';
        finishUnresolved(run.id, 'interrupted', reason);
        try { await sandbox.stop(run.id); }
        catch (error) { cleanupFailure = new Error(`Recovery cleanup failed for ${run.id}. Worker will stop accepting runs.`, { cause: error }); report(error); }
      }
      if (unchangedWorker(worker)) store.offlineWorker(worker.id);
    }
  }

  async function performTick(): Promise<void> {
    if (cleanupFailure) throw cleanupFailure;
    if (!started || stopping) return;
    store.heartbeatWorker(workerId);
    const now = clock();
    for (const [runId, entry] of active) {
      const status = store.getSwarm(runId).status;
      if (status === 'stopping' || status === 'cancelled') abortRun(runId, entry, 'operator');
      else if (now >= entry.deadlineAt) abortRun(runId, entry, 'deadline');
    }
    if (now >= nextRecoveryAt) {
      nextRecoveryAt = now + Math.min(staleWorkerMs, 5000);
      await recoverDeadWorkers(now);
    }
    if (cleanupFailure) throw cleanupFailure;
    while (!stopping && active.size < concurrency) {
      const run = store.claimNextSwarm(workerId);
      if (!run) break;
      const entry: ActiveRun = { controller: new AbortController(), deadlineAt: clock() + run.spec.maxRunMs, abortReason: null, completion: Promise.resolve() };
      active.set(run.id, entry);
      entry.completion = execute(run, entry);
    }
  }

  function tick(): Promise<void> {
    if (tickPromise) return tickPromise;
    tickPromise = performTick().finally(() => { tickPromise = null; });
    return tickPromise;
  }

  async function performShutdown(): Promise<void> {
    stopping = true;
    if (!started) return;
    try {
      for (const [runId, entry] of active) {
        try { abortRun(runId, entry, 'shutdown'); }
        catch (error) {
          report(error); entry.abortReason = 'shutdown';
          const shutdownError = new Error('Worker shutting down.'); shutdownError.name = 'WorkerShutdownError';
          entry.controller.abort(shutdownError);
        }
      }
      await tickPromise;
      await Promise.allSettled([...active.values()].map(entry => entry.completion));
    } finally {
      try { await runtime.dispose(); if (cleanupFailure) throw cleanupFailure; }
      finally { store.offlineWorker(workerId); }
    }
  }

  return {
    start() {
      if (started || stopping) throw new Error('A worker scheduler can only start once.');
      store.registerWorker(workerId, pid); started = true;
    },
    tick,
    shutdown() { shutdownPromise ??= performShutdown(); return shutdownPromise; },
    activeSwarmIds: () => [...active.keys()],
  };
}
