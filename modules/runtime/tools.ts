import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { AgentStatus, FileChange } from '@simpleswarm/swarm';
import type { ToolContext } from './contracts.ts';
import { RuntimeError } from './pricing.ts';
import { budgetAwareness } from './budget-awareness.ts';
import { emitDiagnostic } from './diagnostics.ts';

const pathSchema = Type.String({ minLength: 1, maxLength: 512 });
const reasonSchema = Type.String({ minLength: 1, maxLength: 8000 });
const textResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
export interface AgentCompletion { status: Extract<AgentStatus, 'done' | 'bailed'>; reason: string; output: string }

export function createSwarmTools(context: ToolContext, complete: (result: AgentCompletion) => void, currentTurn: () => number = () => 0): ToolDefinition[] {
  const { store, sandbox, actor, signal } = context;
  const active = () => {
    signal.throwIfAborted();
    const run = store.getSwarm(actor.swarmId);
    const agent = run.agents.find(member => member.id === actor.agentId);
    if (run.status !== 'running' || !agent || !['running', 'waiting'].includes(agent.status)) {
      throw new RuntimeError('agent_inactive', 'This agent cannot execute another tool.');
    }
    return run;
  };
  const write = (path: string, content: string, baseRevision: number, reason: string) => {
    active();
    const change: FileChange = { path, baseRevision, contentBase64: Buffer.from(content).toString('base64') };
    return textResult(store.publishFiles(actor, [change], reason));
  };
  return [
    defineTool({ name: 'read', label: 'Read', description: 'Read a canonical workspace file including its revision. PNG/JPEG images are shown visually. Use list_files to discover paths.',
      parameters: Type.Object({ path: pathSchema }), execute: async (_id, params) => {
        active(); const file = store.readFile(actor.swarmId, params.path);
        if (/\.(png|jpe?g)$/i.test(file.path)) {
          return { content: [{ type: 'text' as const, text: `Path ${file.path}; revision ${file.revision}` }, { type: 'image' as const, data: file.contentBase64, mimeType: /\.png$/i.test(file.path) ? 'image/png' : 'image/jpeg' }], details: {} };
        }
        const content = Buffer.from(file.contentBase64, 'base64').toString('utf8');
        return textResult({ path: file.path, revision: file.revision, content: content.slice(0, 100_000), truncated: content.length > 100_000 });
      } }),
    defineTool({ name: 'list_files', label: 'Files', description: 'List canonical paths and current revisions without loading all contents.', parameters: Type.Object({}), execute: async () => {
      active(); return textResult(store.files(actor.swarmId).map(({ path, revision, size, authorId }) => ({ path, revision, size, authorId })));
    } }),
    defineTool({ name: 'write', label: 'Write', description: 'Publish UTF-8 text under your live file claim. Supply the revision from read, or 0 for a new file. Claims are mandatory.',
      parameters: Type.Object({ path: pathSchema, content: Type.String({ maxLength: 1_000_000 }), base_revision: Type.Integer({ minimum: 0 }), reason: reasonSchema }),
      execute: async (_id, params) => write(params.path, params.content, params.base_revision, params.reason) }),
    defineTool({ name: 'edit', label: 'Edit', description: 'Replace one unique exact substring in a claimed canonical file. The current revision must match.',
      parameters: Type.Object({ path: pathSchema, old_text: Type.String({ minLength: 1 }), new_text: Type.String(), base_revision: Type.Integer({ minimum: 1 }), reason: reasonSchema }),
      execute: async (_id, params) => {
        active(); const file = store.readFile(actor.swarmId, params.path); const content = Buffer.from(file.contentBase64, 'base64').toString('utf8');
        if (file.revision !== params.base_revision) throw new RuntimeError('revision_conflict', 'Read the current version before editing.');
        if (!content.includes(params.old_text) || content.indexOf(params.old_text) !== content.lastIndexOf(params.old_text)) throw new RuntimeError('edit_ambiguous', 'The original text must appear exactly once.');
        return write(params.path, content.replace(params.old_text, () => params.new_text), params.base_revision, params.reason);
      } }),
    defineTool({ name: 'bash', label: 'Bash', description: 'Every call starts a fresh isolated container at /workspace with the canonical files and no network or host access. /tmp is discarded when the call ends; create and consume scratch files within that one call. Persist useful work at claimed /workspace paths or with write before rendering. Every canonical file created/edited/deleted needs your live claim. Changes publish atomically; conflicts reject the entire changeset. versions:[] means nothing was published. Node Playwright Chromium and Python CairoSVG/PIL are installed.',
      parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 32000 }), timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 120 })) }),
      execute: async (toolCallId, params, toolSignal) => {
        active(); const result = await sandbox.execute({ swarmId: actor.swarmId, agentId: actor.agentId, command: params.command, files: store.files(actor.swarmId), timeoutSeconds: params.timeout_seconds ?? 60, signal: toolSignal ? AbortSignal.any([signal, toolSignal]) : signal });
        active(); const versions = result.changes.length ? store.publishFiles(actor, result.changes, 'Isolated shell changes') : [];
        emitDiagnostic(store, actor, 'tool_result', () => ({ toolCallId, toolName: 'bash', exitCode: result.exitCode, durationMs: result.durationMs, publishedFiles: versions.length, code: result.exitCode === 0 ? 'ok' : 'command_failed' }));
        return textResult({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, versions });
      } }),
    defineTool({ name: 'post', label: 'Post', description: 'Post to a shared thread. All participants see it. Use thread IDs from list_threads.', parameters: Type.Object({ thread_id: Type.String(), body: Type.String({ minLength: 1, maxLength: 20000 }) }), execute: async (_id, params) => { active(); return textResult(store.post(actor, params.thread_id, params.body)); } }),
    defineTool({ name: 'inbox', label: 'Inbox', description: 'Read new messages from joined threads and advance your inbox cursor.', parameters: Type.Object({}), execute: async () => { active(); return textResult(store.inbox(actor)); } }),
    defineTool({ name: 'list_threads', label: 'Threads', description: 'List swarm discussion threads and their IDs.', parameters: Type.Object({}), execute: async () => { active(); return textResult(store.threads(actor.swarmId)); } }),
    defineTool({ name: 'create_thread', label: 'Create thread', description: 'Create a named shared discussion thread and join it.', parameters: Type.Object({ title: Type.String({ minLength: 1, maxLength: 200 }) }), execute: async (_id, params) => { active(); return textResult(store.createThread(actor, params.title)); } }),
    defineTool({ name: 'join_thread', label: 'Join thread', description: 'Join a shared discussion and receive its messages in your inbox.', parameters: Type.Object({ thread_id: Type.String() }), execute: async (_id, params) => { active(); return textResult(store.joinThread(actor, params.thread_id)); } }),
    defineTool({ name: 'list_team', label: 'Team', description: 'List peers, chosen names, states and findings.', parameters: Type.Object({}), execute: async () => { active(); return textResult(store.getSwarm(actor.swarmId).agents); } }),
    defineTool({ name: 'name', label: 'Choose name', description: 'Choose a short unique memorable agent name.', parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }) }), execute: async (_id, params) => { active(); return textResult(store.renameAgent(actor, params.name)); } }),
    defineTool({ name: 'budget', label: 'Budget', description: 'Check shared spending before choosing work, before expensive verification, and before reporting completion. Distinguish verified usage, temporary reservations, unresolved liability, the working target, and the hard cap. This snapshot does not reserve funds. Cite observationSeq when referring to the exact recorded balance.', parameters: Type.Object({}), execute: async () => {
      const run = active();
      const awareness = budgetAwareness(run, actor);
      const observation = store.appendEvent(run.id, actor.agentId, 'budget_observed', { ...awareness });
      return textResult({ ...awareness, observationSeq: observation.seq });
    } }),
    defineTool({ name: 'claim_file', label: 'Claim files', description: 'Atomically claim exact file paths before any mutation, including shell output files. Claims expire; renew before long work. Coordinate ownership on the board.', parameters: Type.Object({ paths: Type.Array(pathSchema, { minItems: 1, maxItems: 100 }), reason: reasonSchema, ttl_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })) }), execute: async (_id, params) => { active(); return textResult(store.claimFiles(actor, params.paths, params.reason, params.ttl_ms)); } }),
    defineTool({ name: 'release_file', label: 'Release files', description: 'Release your file claims to peers.', parameters: Type.Object({ paths: Type.Array(pathSchema, { minItems: 1 }) }), execute: async (_id, params) => { active(); store.releaseFiles(actor, params.paths); return textResult({ released: params.paths }); } }),
    defineTool({ name: 'file_history', label: 'File history', description: 'List canonical versions and authors for a file.', parameters: Type.Object({ path: pathSchema }), execute: async (_id, params) => { active(); return textResult(store.fileHistory(actor.swarmId, params.path)); } }),
    defineTool({ name: 'file_diff', label: 'Compare versions', description: 'Read two UTF-8 canonical revisions together for comparison.', parameters: Type.Object({ path: pathSchema, from_revision: Type.Integer({ minimum: 1 }), to_revision: Type.Integer({ minimum: 1 }) }), execute: async (_id, params) => {
      active(); return textResult({ path: params.path, from: Buffer.from(store.fileAtRevision(actor.swarmId, params.path, params.from_revision).contentBase64, 'base64').toString('utf8').slice(0,100000), to: Buffer.from(store.fileAtRevision(actor.swarmId, params.path, params.to_revision).contentBase64, 'base64').toString('utf8').slice(0,100000) });
    } }),
    defineTool({ name: 'file_restore', label: 'Restore version', description: 'Restore a historic canonical version under your live claim.', parameters: Type.Object({ path: pathSchema, revision: Type.Integer({ minimum: 1 }), reason: reasonSchema }), execute: async (_id, params) => { active(); return textResult(store.restoreFile(actor, params.path, params.revision, params.reason)); } }),
    defineTool({ name: 'done', label: 'Done', description: 'End your participation when the definition of done is proven, or explicitly bail. Explain evidence and final output. This permanently stops your session.', parameters: Type.Object({ done_reasoning: reasonSchema, output: Type.Optional(Type.String({ maxLength: 20000 })), bail: Type.Optional(Type.Boolean()) }), execute: async (_id, params) => {
      active(); const completion: AgentCompletion = { status: params.bail ? 'bailed' : 'done', reason: params.done_reasoning, output: params.output ?? '' };
      emitDiagnostic(store, actor, 'agent_stop', () => ({ origin: 'agent', code: completion.status, reason: completion.reason, status: completion.status, turn: currentTurn(), budget: { ...store.budget(actor.swarmId) } }));
      store.endAgent(actor, completion.status, completion.reason, completion.output); complete(completion); return textResult({ status: completion.status });
    } }),
  ];
}
