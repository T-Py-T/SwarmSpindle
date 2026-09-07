import type { Actor, ModelBinding, SwarmRecord, SwarmStore } from '@simpleswarm/swarm';
import type { Sandbox } from '@simpleswarm/sandbox';

export interface ModelReadiness { model: ModelBinding; ready: boolean; reason: string; billing: 'metered-usd' | 'subscription-usd-equivalent'; pricingEvidence: string }
export interface SwarmRuntime {
  preflight(run: SwarmRecord): Promise<ModelReadiness>;
  run(run: SwarmRecord, signal: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
}
export interface RuntimeOptions { store: SwarmStore; sandbox: Sandbox; sessionDirectory: string }
export interface ToolContext { store: SwarmStore; sandbox: Sandbox; actor: Actor; signal: AbortSignal }
