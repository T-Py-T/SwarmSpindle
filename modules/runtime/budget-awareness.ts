import type { Actor, BudgetSnapshot, SwarmRecord } from '@simpleswarm/swarm';
import { reservationCeiling, RuntimeError } from './pricing.ts';

export type BudgetDecision = 'ready' | 'waiting_for_reservations' | 'hard_ceiling_reached' | 'unresolved_usage' | 'working_target_reached';
export interface BudgetAwareness extends BudgetSnapshot {
  ownSettledMicros: number;
  workingTargetMicros: number | null;
  targetRemainingMicros: number | null;
  nextRequestCeilingMicros: number;
  requestsAdmissibleNow: number;
  decision: BudgetDecision;
  units: 'USD-equivalent microdollars';
  dollars: {
    cap: string; settled: string; reserved: string; uncertain: string; available: string;
    ownSettled: string; workingTarget: string | null; targetRemaining: string | null; nextRequestCeiling: string;
  };
  guidance: string;
}

function dollars(micros: number): string {
  const amount = BigInt(micros);
  return `${amount / 1_000_000n}.${String(amount % 1_000_000n).padStart(6, '0')}`;
}

const guidance: Record<BudgetDecision, string> = {
  ready: 'The present hard-cap balance can cover a bounded request. Choose useful work toward the definition of done; avoid duplicate discussion and verification.',
  waiting_for_reservations: 'Existing requests temporarily hold capacity. Wait for their verified settlements rather than repeat work or request a new budget.',
  hard_ceiling_reached: 'Even releasing every temporary reservation would not leave enough capacity for another bounded request. Preserve current artifacts and explain the blocker; do not assume the nominal balance can fund a request.',
  unresolved_usage: 'A dispatched request has unverified charges. New model requests are blocked. Keep its full liability; already-dispatched requests may settle from verified usage. Preserve useful work and explain the unresolved charge.',
  working_target_reached: 'Shared verified spending has reached the working target. Stop choosing new model work; preserve the current artifact and report completion only when the definition of done is proven. In-flight requests may still settle above this target within the separate hard cap.',
};

/** A pure assessment of the supplied snapshot; it does not reserve funds or authorize a request. */
export function budgetAwareness(run: SwarmRecord, actor: Actor): BudgetAwareness {
  const ownAgent = run.agents.find(agent => agent.id === actor.agentId);
  if (actor.swarmId !== run.id || !ownAgent) throw new RuntimeError('agent_not_found', 'Budget awareness requires an agent belonging to this swarm.');
  const budget = run.budget;
  const workingTargetMicros = run.spec.workingTargetMicros ?? null;
  const targetRemainingMicros = workingTargetMicros === null ? null : Math.max(0, workingTargetMicros - budget.settledMicros);
  const nextRequestCeilingMicros = reservationCeiling(run.spec.model, run.spec.maxOutputTokens);
  const requestsAdmissibleNow = Math.floor(budget.availableMicros / nextRequestCeilingMicros);
  const decision: BudgetDecision = budget.uncertainMicros > 0 ? 'unresolved_usage'
    : targetRemainingMicros === 0 ? 'working_target_reached'
    : budget.availableMicros >= nextRequestCeilingMicros ? 'ready'
    : budget.availableMicros + budget.reservedMicros >= nextRequestCeilingMicros ? 'waiting_for_reservations'
    : 'hard_ceiling_reached';
  return {
    ...budget, ownSettledMicros: ownAgent.costMicros, workingTargetMicros, targetRemainingMicros,
    nextRequestCeilingMicros, requestsAdmissibleNow, decision, units: 'USD-equivalent microdollars',
    dollars: {
      cap: dollars(budget.capMicros), settled: dollars(budget.settledMicros), reserved: dollars(budget.reservedMicros),
      uncertain: dollars(budget.uncertainMicros), available: dollars(budget.availableMicros), ownSettled: dollars(ownAgent.costMicros),
      workingTarget: workingTargetMicros === null ? null : dollars(workingTargetMicros),
      targetRemaining: targetRemainingMicros === null ? null : dollars(targetRemainingMicros), nextRequestCeiling: dollars(nextRequestCeilingMicros),
    },
    guidance: `${guidance[decision]} Settled is verified usage; reserved is temporary capacity; uncertain is retained liability, not confirmed spending. The working target tracks shared settled usage, not your personal allowance. requestsAdmissibleNow is only the current hard-ledger capacity before target/uncertainty gates, not a forecast or a guarantee. Other peers can change this snapshot. Check budget before choosing work, before expensive verification, and before reporting completion.`,
  };
}
