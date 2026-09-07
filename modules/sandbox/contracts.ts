import type { FileChange, WorkspaceFile } from '@simpleswarm/swarm';

export interface SandboxResult { exitCode: number; stdout: string; stderr: string; changes: FileChange[]; durationMs: number }
export interface SandboxCheck { ready: boolean; reason: string; image: string }
export interface Sandbox {
  check(): Promise<SandboxCheck>;
  execute(options: { swarmId: string; agentId: string; command: string; files: WorkspaceFile[]; timeoutSeconds: number; signal: AbortSignal }): Promise<SandboxResult>;
  stop(swarmId: string): Promise<void>;
}
