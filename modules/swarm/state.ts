import { z } from 'zod';
import { microdollars, timestamp, specSchema } from './spec.ts';
import { SwarmError, type BudgetSnapshot } from './contracts.ts';

export const usageSchema = z.object({ input: microdollars, output: microdollars, cacheRead: microdollars, cacheWrite: microdollars }).strict();
export const agentSchema = z.object({
  id: z.string(), name: z.string().min(1), status: z.enum(['ready','running','waiting','done','bailed','failed','cancelled','stalled']),
  sessionId: z.string().nullable(), startedAt: timestamp.nullable(), updatedAt: timestamp, endedAt: timestamp.nullable(),
  reason: z.string().nullable(), output: z.string().nullable(), costMicros: microdollars, usage: usageSchema, toolCalls: microdollars,
}).strict();
const fileSchema = z.object({ path: z.string(), revision: z.number().int().positive(), authorId: z.string(), createdAt: timestamp, reason: z.string(), deleted: z.boolean(), size: microdollars, contentBase64: z.string() }).strict();
export const reservationSchema = z.object({ id: z.string(), swarmId: z.string(), agentId: z.string(), ceilingMicros: microdollars, status: z.enum(['reserved','settled','uncertain']), actualMicros: microdollars.nullable(), createdAt: timestamp, pricingEvidence: z.string().min(1), usage: usageSchema.nullable() }).strict();
export const workerSchema = z.object({ id: z.string().min(1), pid: z.number().int().positive(), startedAt: timestamp, heartbeatAt: timestamp, status: z.enum(['online','offline']) }).strict();
export const stateSchema = z.object({
  version: z.literal(1), id: z.string(), spec: specSchema,
  status: z.enum(['queued','running','stopping','completed','bailed','failed','cancelled','budget_exhausted','interrupted']),
  createdAt: timestamp, startedAt: timestamp.nullable(), endedAt: timestamp.nullable(), reason: z.string().nullable(), workerId: z.string().nullable(),
  agents: z.array(agentSchema),
  threads: z.array(z.object({ id: z.string(), swarmId: z.string(), title: z.string(), createdAt: timestamp, updatedAt: timestamp, members: z.array(z.string()), messageCount: microdollars }).strict()),
  messages: z.array(z.object({ id: z.number().int().positive(), swarmId: z.string(), threadId: z.string(), authorId: z.string(), body: z.string(), createdAt: timestamp }).strict()),
  cursors: z.record(z.string(), microdollars),
  claims: z.array(z.object({ path: z.string(), ownerId: z.string(), reason: z.string(), expiresAt: timestamp }).strict()),
  versions: z.array(fileSchema), reservations: z.array(reservationSchema),
  events: z.array(z.object({ seq: z.number().int().positive(), swarmId: z.string(), agentId: z.string().nullable(), kind: z.string(), createdAt: timestamp, payload: z.json() }).strict()),
}).strict();
export type State = z.infer<typeof stateSchema>;
export type StoredReservation = z.infer<typeof reservationSchema>;

export function sumSafe(values: number[]): number {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum)) throw new SwarmError('invalid_money', 'Accounting exceeds the safe integer range.');
  return sum;
}

export function budgetOf(state: State): BudgetSnapshot {
  const settledMicros = sumSafe(state.reservations.filter(entry => entry.status === 'settled').map(entry => entry.actualMicros ?? 0));
  const reservedMicros = sumSafe(state.reservations.filter(entry => entry.status === 'reserved').map(entry => entry.ceilingMicros));
  const uncertainMicros = sumSafe(state.reservations.filter(entry => entry.status === 'uncertain').map(entry => entry.ceilingMicros));
  return { capMicros: state.spec.budgetMicros, settledMicros, reservedMicros, uncertainMicros,
    availableMicros: state.spec.budgetMicros - sumSafe([settledMicros, reservedMicros, uncertainMicros]) };
}
