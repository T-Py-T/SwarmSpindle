import { describe, expect, test } from 'bun:test';
import { parseSwarmSpec, type Actor, type BudgetSnapshot, type ModelBinding, type SwarmRecord } from '@simpleswarm/swarm';
import { budgetAwareness } from '../modules/runtime/budget-awareness.ts';

const opus: ModelBinding = { provider: 'anthropic', id: 'claude-opus-4-8', thinking: 'high' };
const codex: ModelBinding = { provider: 'openai-codex', id: 'gpt-5.5', thinking: 'high' };

function fixture(balances: Partial<Omit<BudgetSnapshot, 'availableMicros'>> = {}, workingTargetMicros?: number, model = opus): { run: SwarmRecord; actor: Actor } {
  const { capMicros, settledMicros, reservedMicros, uncertainMicros } = { capMicros: 50_000_000, settledMicros: 0, reservedMicros: 0, uncertainMicros: 0, ...balances };
  const budget = { capMicros, settledMicros, reservedMicros, uncertainMicros, availableMicros: capMicros - settledMicros - reservedMicros - uncertainMicros };
  const ownSettled = Math.min(settledMicros, 2_000_000);
  const run: SwarmRecord = {
    id: 'awareness-fixture', status: 'running', createdAt: 1, startedAt: 2, endedAt: null, reason: null, workerId: 'fixture-worker', budget,
    spec: parseSwarmSpec({ title: 'Budget awareness', task: 'Preserve useful verified work within the shared budget.', definitionOfDone: 'A checked result exists.', finalOutput: 'result.txt', agentCount: 2, budgetMicros: capMicros, model, ...(workingTargetMicros === undefined ? {} : { workingTargetMicros }) }),
    agents: [ownSettled, settledMicros - ownSettled].map((costMicros, index) => ({ id: `peer-${index}`, name: `Peer ${index}`, status: 'running', sessionId: `session-${index}`, startedAt: 2, updatedAt: 3, endedAt: null, reason: null, output: null, costMicros, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, toolCalls: 0 })),
  };
  return { run, actor: { swarmId: run.id, agentId: 'peer-0' } };
}

describe('agent budget awareness', () => {
  test('preserves every original balance, reports own cost, formats exact dollars, and changes no supplied state', () => {
    const { run, actor } = fixture({ settledMicros: 3_000_001, reservedMicros: 5_400_000 });
    const before = structuredClone(run);
    const awareness = budgetAwareness(run, actor);
    expect(awareness).toMatchObject(run.budget);
    expect(awareness.ownSettledMicros).toBe(2_000_000);
    expect(awareness.dollars).toMatchObject({ cap: '50.000000', settled: '3.000001', ownSettled: '2.000000', reserved: '5.400000', available: '41.599999', uncertain: '0.000000', nextRequestCeiling: '5.400000' });
    expect(awareness.workingTargetMicros).toBeNull(); expect(awareness.targetRemainingMicros).toBeNull();
    expect(awareness.dollars.workingTarget).toBeNull(); expect(awareness.decision).toBe('ready');
    expect(awareness.requestsAdmissibleNow).toBe(7);
    expect(awareness.units).toBe('USD-equivalent microdollars');
    expect(run).toEqual(before);
    expect(budgetAwareness(run, { ...actor, agentId: 'peer-1' }).ownSettledMicros).toBe(1_000_001);
    expect(() => budgetAwareness(run, { ...actor, swarmId: 'foreign' })).toThrow('belonging to this swarm');
    expect(() => budgetAwareness(run, { ...actor, agentId: 'missing' })).toThrow('belonging to this swarm');
  });

  test('uses shared verified spending at and beyond the working target, excluding temporary reservations', () => {
    for (const settledMicros of [9_999_999, 10_000_000, 10_000_001]) {
      const { run, actor } = fixture({ settledMicros }, 10_000_000);
      const awareness = budgetAwareness(run, actor);
      expect(awareness.targetRemainingMicros).toBe(settledMicros < 10_000_000 ? 1 : 0);
      expect(awareness.decision).toBe(settledMicros < 10_000_000 ? 'ready' : 'working_target_reached');
      expect(awareness.dollars.workingTarget).toBe('10.000000');
      expect(awareness.ownSettledMicros).toBe(2_000_000);
    }
    const { run, actor } = fixture({ settledMicros: 9_000_000, reservedMicros: 20_000_000 }, 10_000_000);
    expect(budgetAwareness(run, actor)).toMatchObject({ decision: 'ready', targetRemainingMicros: 1_000_000 });
  });

  test('distinguishes temporary contention from a permanently insufficient request floor', () => {
    const waiting = fixture({ capMicros: 10_000_000, settledMicros: 4_600_000, reservedMicros: 5_400_000 });
    expect(budgetAwareness(waiting.run, waiting.actor)).toMatchObject({ decision: 'waiting_for_reservations', availableMicros: 0, requestsAdmissibleNow: 0 });
    const exhausted = fixture({ capMicros: 10_000_000, settledMicros: 4_600_001, reservedMicros: 5_399_999 });
    expect(budgetAwareness(exhausted.run, exhausted.actor).decision).toBe('hard_ceiling_reached');
    const below = fixture({ capMicros: 5_399_999 });
    expect(budgetAwareness(below.run, below.actor)).toMatchObject({ decision: 'hard_ceiling_reached', availableMicros: 5_399_999, requestsAdmissibleNow: 0 });
    const exact = fixture({ capMicros: 5_400_000 });
    expect(budgetAwareness(exact.run, exact.actor)).toMatchObject({ decision: 'ready', requestsAdmissibleNow: 1 });
  });

  test('prioritizes uncertainty over a reached working target and the target over request capacity', () => {
    const uncertain = fixture({ settledMicros: 10_000_000, uncertainMicros: 5_400_000 }, 10_000_000);
    const awareness = budgetAwareness(uncertain.run, uncertain.actor);
    expect(awareness.decision).toBe('unresolved_usage'); expect(awareness.targetRemainingMicros).toBe(0);
    expect(awareness.requestsAdmissibleNow).toBe(6); // Numeric hard-ledger capacity does not override the circuit.
    expect(awareness.guidance).toContain('not confirmed spending');
    const reached = fixture({ capMicros: 10_000_000, settledMicros: 10_000_000 }, 10_000_000);
    expect(budgetAwareness(reached.run, reached.actor)).toMatchObject({ decision: 'working_target_reached', requestsAdmissibleNow: 0 });
  });

  test('uses each exact model reservation without predicting future request counts', () => {
    const left = fixture({}, undefined, opus); const right = fixture({}, undefined, codex);
    expect(budgetAwareness(left.run, left.actor)).toMatchObject({ nextRequestCeilingMicros: 5_400_000, requestsAdmissibleNow: 9 });
    const awareness = budgetAwareness(right.run, right.actor);
    expect(awareness).toMatchObject({ nextRequestCeilingMicros: 16_260_000, requestsAdmissibleNow: 3 });
    expect(awareness.dollars.nextRequestCeiling).toBe('16.260000');
    expect(awareness.guidance).toContain('not a forecast or a guarantee');
    expect(awareness.guidance).toContain('Other peers can change this snapshot');
    expect(JSON.stringify(awareness).length).toBeLessThan(2500);
  });
});
