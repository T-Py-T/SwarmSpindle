import { SwarmError, type Actor, type Reservation, type SwarmStore, type TokenUsage } from '@simpleswarm/swarm';
import { RuntimeError } from './pricing.ts';

export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function waitForTurn(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    void previous.then(() => { signal.removeEventListener('abort', abort); resolve(); });
  });
}

/** FIFO admission avoids one fast agent monopolizing released reservations. */
export class BudgetAdmission {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly circuits = new Map<string, AbortController>();
  constructor(private readonly store: SwarmStore) {}

  failure(swarmId: string): RuntimeError | undefined {
    const reason: unknown = this.circuits.get(swarmId)?.signal.reason;
    if (reason instanceof RuntimeError) return reason;
    const run = this.store.getSwarm(swarmId);
    if (run.budget.uncertainMicros > 0) {
      this.trip(swarmId);
      return this.failure(swarmId);
    }
    if (run.spec.workingTargetMicros !== undefined && run.budget.settledMicros >= run.spec.workingTargetMicros) {
      return new RuntimeError('working_target_reached', 'Shared verified usage reached the working target. No further model requests will start; existing requests may finish within the separate hard ceiling.');
    }
    return undefined;
  }

  assertOpen(swarmId: string): void {
    const failure = this.failure(swarmId);
    if (failure) throw failure;
  }

  trip(swarmId: string): void {
    const circuit = this.circuit(swarmId);
    if (!circuit.signal.aborted) circuit.abort(new RuntimeError('request_uncertain', 'New model requests stopped because a dispatched request has unverified charges. Existing requests may settle; uncertain liability remains retained.'));
  }

  private circuit(swarmId: string): AbortController {
    let circuit = this.circuits.get(swarmId);
    if (!circuit) { circuit = new AbortController(); this.circuits.set(swarmId, circuit); }
    return circuit;
  }

  async acquire(actor: Actor, ceiling: number, evidence: string, signal: AbortSignal): Promise<Reservation> {
    this.assertOpen(actor.swarmId);
    const admissionSignal = AbortSignal.any([signal, this.circuit(actor.swarmId).signal]);
    const previous = this.tails.get(actor.swarmId) ?? Promise.resolve();
    let release = () => {};
    const slot = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => slot);
    this.tails.set(actor.swarmId, tail);
    void tail.then(() => { if (this.tails.get(actor.swarmId) === tail) this.tails.delete(actor.swarmId); });
    try {
      await waitForTurn(previous, admissionSignal);
      let waiting = false;
      for (;;) {
        admissionSignal.throwIfAborted();
        this.assertOpen(actor.swarmId);
        const run = this.store.getSwarm(actor.swarmId);
        if (run.status !== 'running') throw new RuntimeError('cancelled', 'Swarm is no longer running.');
        const budget = this.store.budget(actor.swarmId);
        if (budget.availableMicros >= ceiling) {
          this.store.setAgentStatus(actor, 'running');
          try { return this.store.reserve(actor, ceiling, evidence); }
          catch (cause) { if (!(cause instanceof SwarmError) || cause.code !== 'budget_busy') throw cause; }
        }
        if (budget.availableMicros + budget.reservedMicros < ceiling) {
          throw new RuntimeError('budget_exhausted', 'Remaining funds cannot cover another bounded request.');
        }
        if (!waiting) { this.store.setAgentStatus(actor, 'waiting'); waiting = true; }
        await waitFor(150, admissionSignal);
      }
    } finally { release(); }
  }
}

/** One inference attempt; never shares a reservation across transport retries. */
export class RequestLiability {
  failure: RuntimeError | undefined;
  private reservation: Reservation | undefined;
  private payloadValidated = false;
  private attempted = false;
  constructor(private readonly options: {
    store: SwarmStore; admission: BudgetAdmission; actor: Actor; ceiling: number;
    evidence: string; signal: AbortSignal; fetch: typeof globalThis.fetch;
  }) {}

  validated(): void { this.payloadValidated = true; }

  async prepare(): Promise<void> {
    this.validated();
    await this.reserve();
  }

  private async reserve(): Promise<void> {
    if (this.reservation) return;
    try {
      this.reservation = await this.options.admission.acquire(this.options.actor, this.options.ceiling, this.options.evidence, this.options.signal);
    } catch (cause) {
      this.failure = cause instanceof RuntimeError ? cause : new RuntimeError(this.options.signal.aborted ? 'cancelled' : 'admission_failed', 'Request admission failed.');
      throw cause;
    }
  }

  readonly fetch: typeof globalThis.fetch = Object.assign(async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    if (this.attempted) throw new RuntimeError('retry_forbidden', 'A transport cannot reuse an inference attempt.');
    if (!this.payloadValidated) throw new RuntimeError('payload_invalid', 'Request did not pass payload validation.');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== 'https:' || !['api.anthropic.com', 'chatgpt.com'].includes(url.hostname)) {
      throw new RuntimeError('endpoint_invalid', 'The provider endpoint is outside the audited transport.');
    }
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method !== 'POST' || !['/v1/messages', '/backend-api/codex/responses'].includes(url.pathname)) {
      throw new RuntimeError('endpoint_invalid', 'Only the audited inference operation is permitted.');
    }
    await this.reserve();
    const suppliedSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    this.options.signal.throwIfAborted(); suppliedSignal?.throwIfAborted();
    try { this.options.admission.assertOpen(this.options.actor.swarmId); }
    catch (cause) {
      this.failure = cause instanceof RuntimeError ? cause : new RuntimeError('admission_failed', 'Request admission could not be verified.');
      throw cause;
    }
    this.attempted = true;
    return this.options.fetch(input, { ...init, signal: suppliedSignal ? AbortSignal.any([this.options.signal, suppliedSignal]) : this.options.signal, redirect: 'error' });
  }, { preconnect: globalThis.fetch.preconnect });

  settle(actualMicros: number, usage: TokenUsage): void {
    if (!this.reservation || !this.attempted) throw new RuntimeError('usage_invalid', 'No admitted inference attempt exists.');
    if (actualMicros > this.reservation.ceilingMicros) throw new RuntimeError('usage_invalid', 'Provider usage exceeds reserved liability.');
    this.options.store.settle(this.reservation.id, actualMicros, usage);
    this.reservation = undefined;
  }

  uncertain(reason: string): void {
    if (!this.reservation) return;
    if (this.attempted) {
      // Close admission even when persisting uncertainty fails; the reservation still covers it.
      this.options.admission.trip(this.options.actor.swarmId);
      this.options.store.markUncertain(this.reservation.id, reason);
    } else this.options.store.settle(this.reservation.id, 0, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    this.reservation = undefined;
  }
}
