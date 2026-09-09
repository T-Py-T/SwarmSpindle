import type { Actor, BudgetSnapshot, SwarmRecord } from '@simpleswarm/swarm';
import { reservationCeiling, RuntimeError } from './pricing.ts';

export type BudgetDecision = 'ready' | 'waiting_for_reservations' | 'hard_ceiling_reached' | 'unresolved_usage' | 'working_target_reached';
export type BudgetPhase = 'working' | 'wrap_up' | 'stop';
type AdmittedRequest = { reservedMicros: number; turn: number };
export interface BudgetAwareness extends BudgetSnapshot {
  ownSettledMicros: number;
  workingTargetMicros: number | null;
  targetRemainingMicros: number | null;
  nextRequestCeilingMicros: number;
  nextReservationHeadroomMicros: number;
  hardCapacitySlots: number;
  requestsAdmissibleNow: number;
  decision: BudgetDecision;
  phase: BudgetPhase;
  currentRequest: (AdmittedRequest & { admitted: true; maxTurns: number; remainingTurnsAfterCurrent: number }) | null;
  units: 'USD-equivalent microdollars';
  dollars: {
    cap: string; settled: string; reserved: string; uncertain: string; available: string;
    ownSettled: string; workingTarget: string | null; targetRemaining: string | null; nextRequestCeiling: string; nextReservationHeadroom: string;
  };
  guidance: string;
}

function dollars(micros: number): string {
  const amount = BigInt(micros);
  return `${amount / 1_000_000n}.${String(amount % 1_000_000n).padStart(6, '0')}`;
}

const guidance: Record<BudgetDecision, string> = {
  ready: 'The present hard-cap balance can cover another bounded request.',
  waiting_for_reservations: 'Another request needs capacity currently held by existing reservations. Runtime admission handles waiting; do not poll or spend turns waiting.',
  hard_ceiling_reached: 'Even releasing every temporary reservation would not leave enough capacity for another bounded request. Preserve current artifacts and explain the blocker; do not assume the nominal balance can fund a request.',
  unresolved_usage: 'A dispatched request has unverified charges. New model requests are blocked. Keep its full liability; already-dispatched requests may settle from verified usage. Preserve useful work and explain the unresolved charge.',
  working_target_reached: 'Shared verified spending has reached the working target. Stop choosing new model work; preserve the current artifact and report completion only when the definition of done is proven. In-flight requests may still settle above this target within the separate hard cap.',
};

const phaseGuidance: Record<BudgetPhase, string> = {
  working: 'Do useful work toward the definition of done; avoid duplicate discussion and verification.',
  wrap_up: 'Prioritize the canonical deliverable, essential checks and an explicit done or honest handoff. Do not start side work. This advice is not a prediction of the next request cost.',
  stop: 'Do not plan another model request. Use any already-authorized tool actions to preserve useful artifacts or post a concise handoff. Call done only with completion evidence, otherwise bail honestly.',
};

/** A pure assessment of the supplied snapshot; it does not reserve funds or authorize a request. */
export function budgetAwareness(run: SwarmRecord, actor: Actor, admittedRequest?: AdmittedRequest): BudgetAwareness {
  const ownAgent = run.agents.find(agent => agent.id === actor.agentId);
  if (actor.swarmId !== run.id || !ownAgent) throw new RuntimeError('agent_not_found', 'Budget awareness requires an agent belonging to this swarm.');
  const budget = run.budget;
  const workingTargetMicros = run.spec.workingTargetMicros ?? null;
  const targetRemainingMicros = workingTargetMicros === null ? null : Math.max(0, workingTargetMicros - budget.settledMicros);
  const nextRequestCeilingMicros = reservationCeiling(run.spec.model, run.spec.maxOutputTokens);
  const initialReservationHeadroomMicros = Math.max(0, budget.capMicros - nextRequestCeilingMicros);
  const nextReservationHeadroomMicros = Math.max(0, budget.capMicros - budget.settledMicros - budget.uncertainMicros - nextRequestCeilingMicros);
  if (admittedRequest && (admittedRequest.reservedMicros !== nextRequestCeilingMicros || admittedRequest.reservedMicros > budget.reservedMicros
    || !Number.isSafeInteger(admittedRequest.turn) || admittedRequest.turn < 1 || admittedRequest.turn > run.spec.maxTurnsPerAgent)) {
    throw new RuntimeError('request_context_invalid', 'Current request context must match an admitted reservation and a valid model turn.');
  }
  const currentRequest: BudgetAwareness['currentRequest'] = admittedRequest ? {
    admitted: true, reservedMicros: admittedRequest.reservedMicros, turn: admittedRequest.turn,
    maxTurns: run.spec.maxTurnsPerAgent, remainingTurnsAfterCurrent: run.spec.maxTurnsPerAgent - admittedRequest.turn,
  } : null;
  const hardCapacitySlots = Math.floor(budget.availableMicros / nextRequestCeilingMicros);
  const decision: BudgetDecision = budget.uncertainMicros > 0 ? 'unresolved_usage'
    : targetRemainingMicros === 0 ? 'working_target_reached'
    : budget.availableMicros >= nextRequestCeilingMicros ? 'ready'
    : budget.availableMicros + budget.reservedMicros >= nextRequestCeilingMicros ? 'waiting_for_reservations'
    : 'hard_ceiling_reached';
  const stopped = ['unresolved_usage', 'working_target_reached', 'hard_ceiling_reached'].includes(decision);
  const nearTarget = workingTargetMicros !== null && targetRemainingMicros !== null && targetRemainingMicros <= Math.floor(workingTargetMicros / 5);
  const nearReservationFloor = nextReservationHeadroomMicros <= Math.floor(initialReservationHeadroomMicros / 5);
  const nearTurnLimit = currentRequest !== null && currentRequest.remainingTurnsAfterCurrent <= 1;
  const phase: BudgetPhase = stopped ? 'stop' : nearTarget || nearReservationFloor || nearTurnLimit ? 'wrap_up' : 'working';
  const requestsAdmissibleNow = stopped ? 0 : hardCapacitySlots;
  const requestGuidance = currentRequest ? `This model request already holds ${dollars(currentRequest.reservedMicros)} USD-equivalent of the shared reserved capacity. Do not idle on your own hold: use the current request productively. Turn ${currentRequest.turn} of ${currentRequest.maxTurns}; ${currentRequest.remainingTurnsAfterCurrent} model turns remain after this one. ` : '';
  const phaseReason = stopped ? '' : `${nearTarget ? 'At most 20% of the shared working target remains. ' : ''}${nearReservationFloor ? 'At most 20% of the initial next-reservation headroom remains. Preserve the canonical draft before spending another turn on checks or discussion. ' : ''}`;
  return {
    ...budget, ownSettledMicros: ownAgent.costMicros, workingTargetMicros, targetRemainingMicros,
    nextRequestCeilingMicros, nextReservationHeadroomMicros, hardCapacitySlots, requestsAdmissibleNow, decision, phase, currentRequest, units: 'USD-equivalent microdollars',
    dollars: {
      cap: dollars(budget.capMicros), settled: dollars(budget.settledMicros), reserved: dollars(budget.reservedMicros),
      uncertain: dollars(budget.uncertainMicros), available: dollars(budget.availableMicros), ownSettled: dollars(ownAgent.costMicros),
      workingTarget: workingTargetMicros === null ? null : dollars(workingTargetMicros),
      targetRemaining: targetRemainingMicros === null ? null : dollars(targetRemainingMicros), nextRequestCeiling: dollars(nextRequestCeilingMicros), nextReservationHeadroom: dollars(nextReservationHeadroomMicros),
    },
    guidance: `${requestGuidance}${guidance[decision]} ${phaseReason}${phaseGuidance[phase]} Next-reservation headroom is cap minus settled usage, uncertain liability and one request ceiling, clamped at zero. Temporary holds are not subtracted; outstanding requests, including this one, can consume that headroom when they settle. It is not a spending allowance or a promise of another request. Available is unreserved shared hard-cap capacity, not a personal allowance or the working-target remainder. Reserved includes the current request when shown. Settled is verified usage; uncertain is retained liability, not confirmed spending. decision and requestsAdmissibleNow concern additional shared requests, not the current admitted request or your remaining turns. hardCapacitySlots ignores target/uncertainty gates; requestsAdmissibleNow applies them. Counts are not a forecast or a guarantee. Other peers can change this snapshot. Check budget before choosing work, before expensive verification, and before reporting completion.`,
  };
}
