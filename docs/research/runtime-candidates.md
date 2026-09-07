# Simple Swarm System runtime architecture candidates

Research question: How can 30 Pi agents collaborate through a co-located web service and worker on Taylor’s M4 Max, with meaningful sandboxing and a $50 cap for each requested challenge?

Date: 2026-09-07. This is a delegated architecture note for incorporation into LearningVault; no model requests or workload launches were performed.

## Verified local evidence

- Pi executable resolves to `/Users/taylor/.local/share/agent-tools/pi/0.84.1/pi`.
- SDK full-control example supports explicit resource loader, explicit tools, private agent directory, model runtime, settings, and session manager. Empty resource discovery can prevent loading personal extensions/skills/AGENTS files.
- SDK exposes `session.prompt`, `session.subscribe`, `session.steer`, `session.followUp`, `session.abort`, `session.dispose`, and custom tools.
- Pi tools have replaceable operations: `BashOperations`, `ReadOperations`, `WriteOperations`, `EditOperations`. The SSH example demonstrates remote execution without changing the model-facing tool contract.
- Pi `before_provider_request` runs after payload construction, supports replacing payload; documentation does not establish a fail-closed budget authorization contract or prove all retries pass the hook. Do not depend on this hook alone for a hard cap.
- Pi’s sandbox example only wraps bash, inherits environment, and falls back to local bash when sandbox initialization fails. It is illustrative and must not be copied as the security policy for this system.
- Docker CLI exists and its current context is `colima`; daemon status was not checked.
- Podman machine `podman-machine-default` is CURRENTLY RUNNING: libkrun, arm64, 8 CPUs, 18.63 GiB configured memory, ~93 GiB disk. `podman info` reports 19,458,629,632 bytes memory and rootless=false inside VM. Do not equate VM separation with safe container privileges; run workload as non-root with dropped capabilities.
- `/usr/bin/sandbox-exec` exists. Presence alone is not validation of a complete sandbox policy.
- Parent-provided findings: native Pi Codex requests work; no Anthropic credentials; Cursor CLI is authenticated and advertises `claude-opus-4-8-high`, but bridge has no trustworthy costs. These were not re-requested in this subtask.

## Required invariants

1. Web service and worker are separate processes on this Mac; a restarted browser cannot kill the swarm.
2. Exactly 30 agent identities and persistent sessions per requested run; network requests may overlap up to 30, while CPU-heavy commands use a separately bounded execution queue.
3. All agents can create/read/reply to shared discussion threads; no obligatory manager routing. Direct messages and role prompts are optional conveniences.
4. All tool execution is in a validated sandbox. Sandbox unavailable means run admission fails, never fallback to host execution.
5. Never expose host auth files, home directories, SSH agents, cloud credentials, Docker/Podman sockets, or process environment to model-written commands.
6. Cap invariant is `settled + unresolved liabilities + active reservations <= cap` in integer monetary units. Authorization occurs before each billable operation.
7. Done and bail are explicit, idempotent state transitions; kill closes admission before canceling outstanding operations. Completion is not inferred from a socket closing or model text saying “done”.
8. Persist full message/tool/model traces, ordering, actual reported usage, reservations, lifecycle events, and artifact provenance. “Full” means all exposed traces; hidden provider reasoning cannot be invented or promised.
9. Agent claims prevent conflicting structured writes; arbitrary shell access to a shared writable tree bypasses file claims unless shell execution itself uses isolated workspaces or a global exclusive write lease.

## Candidate A — Trusted host Pi worker, sandboxed tool executor (recommended initial implementation)

Flow: browser → loopback web API → SQLite/events → trusted host worker with 30 Pi SDK sessions → custom tool operations via Podman → per-swarm workspace container. Model requests occur only in the trusted worker through a budget-authorizing provider adapter.

The web service never executes tools or owns model credentials. Worker owns Pi sessions and explicitly registers collaboration and sandbox tools, with no automatic extension discovery. Personal Pi OAuth stays on host and is available only to the model runtime. Agent-controlled strings cannot select arbitrary host paths, executables, providers, headers, or auth stores.

Container: prebuilt pinned arm64 image with required build/browser tools; non-root UID; read-only rootfs; `/tmp` tmpfs; only run workspace writable; no host HOME; `--network=none`; no privileged mode; `--cap-drop=ALL`; no-new-privileges; memory/CPU/PID limits; no daemon socket. Browser previews can be copied out and served through the web service; tests/rendering happen inside the container. Dependency preparation occurs explicitly before the run or via a separate constrained fetch/build facility. Never silently grant network to arbitrary commands.

Run workspace is a Podman named volume, not a broad host bind mount. Snapshot/export through controlled container reads keeps symlink escapes inside the VM. Validate artifact sizes/types and render active HTML on a distinct preview origin with restrictive sandboxing, so artifacts cannot call the trusted web API.

File collaboration choices: use individual agent overlays/workspaces and a claim-protected atomic publish tool, with a shared read-only artifact snapshot; OR retain one shared tree for demo fidelity and admit arbitrary bash only under one global write lease. Ordinary read/edit/write tools use atomic path claims. Do not market a convention-only file claim as enforced isolation.

Pros: minimal custom transport; native Pi OAuth and full sessions work directly; straightforward debugging; strongest reuse of documented Pi operations APIs; 30 network-bound agents fit a single Node worker. Cons: trusted host process still parses untrusted model/tool content; all tool names must be overridden/audited; one shared Node failure interrupts all sessions until restart; global shell write lease reduces build concurrency. VM means Linux tools, not native macOS apps.

## Candidate B — Pi worker inside VM/container, narrow host model broker

Flow: web service → durable command/event transport → containerized Pi SDK worker with 30 sessions → credential-free custom provider adapter → host broker → provider. Broker accepts only model requests for an admitted run and enforces budget. The worker/tool tree contains no host credentials and has no general network.

Use a framed stdio channel carried by `podman exec` for broker requests/replies and worker events. This avoids relying on Docker Desktop forwarding of macOS Unix sockets. Host launches fixed runner argv; worker RPC frames are parsed with strict size limits and schemas. Model adapter receives deltas/results over the channel. The protocol fixes allowed provider/model/reasoning per run, maximum output/context, request IDs, and idempotency. Tools execute in the worker container with non-root permissions; separate trusted worker UID and tool UID if process/signal separation is needed. Worker code and dependencies are in read-only image layers. The broker never accepts arbitrary URLs or provider headers.

Pros: stronger boundary around SDK/runtime and tool execution, a good path to a future separate Mac worker, exact same worker service topology on one host or remote. Cons: custom Pi provider streaming adapter and transport need careful cancellation/backpressure/restart testing; broker still requires native provider integration and budget semantics; more initial code than A. Provider access through Cursor’s opaque CLI does not solve accounting just by moving it into a container.

Choose B if “external sandboxed agent” specifically requires the Pi process itself to be sandboxed. Choose A if the requirement is that all agent actions are sandboxed while the trusted harness mediates them. Both maintain a real separate worker and web service on the same physical Mac.

## Caller-facing contracts and ownership

These are proposed application contracts, not assertions about Pi SDK export names.

```ts
type MoneyMicros = bigint;
type SwarmSpec = {
  task: string; agentCount: 30; model: ModelBinding;
  budgetMicros: MoneyMicros; sandbox: "podman";
  workspaceSeed?: ArtifactSetId;
};
type ModelBinding = {
  provider: string; modelId: string; reasoning: "high";
  billing: "metered" | "subscription";
  priceEvidenceId: string; maxOutputTokens: number;
};
type RunStatus = "queued" | "preflight" | "running" | "stopping" |
  "completed" | "bailed" | "failed" | "killed" | "budget_exhausted";
type AgentStatus = "ready" | "running" | "waiting" | "done" | "bailed" | "killed";
type BudgetReservation = {
  id: string; requestId: string; runId: string;
  ceilingMicros: MoneyMicros; pricingVersion: string;
  status: "reserved" | "settled" | "uncertain";
};
type Event = {
  sequence: number; runId: string; agentId?: string;
  kind: string; timestamp: string; data: unknown;
};
```

- `runs` owns `createRun(spec)`, `startRun(runId)`, `stopRun(runId, reason)`, admission validation, run/agent state transitions, scheduler, and completion policy. Routes invoke this directly, rather than adding a pass-through controller/service/repository chain.
- `store` owns SQLite schema, transactions, append-only event sequence, run snapshots, thread messages, claims, reservations. Unique keys deduplicate request/command IDs. Financial reservations and admission change in one transaction.
- `budget` owns `reserve(request: BillableRequest): Reservation | BudgetDenied`, `settle(id, trustedUsage)`, `markUncertain(id)` and provider pricing/token rules. It shares the store transaction boundary, has no browser or Pi dependency.
- `pi-worker` owns `runAgent(spec, ports, signal)`, Pi session construction/subscriptions, tool schema registration, provider adapter wiring and saved session replay. It accepts the sandbox and budget contracts; application domain types do not import Pi types.
- `sandbox` owns `prepare(run)`, `execute(agent, command, signal)`, `read/write/publish`, `snapshot`, and `stopAll(run)`. It validates capabilities, limits, actual container identity, exit status and process cleanup.
- `collaboration` owns `createThread`, `reply`, `listThreads`, `claimPaths`, `renewClaim`, `releaseClaim`, `markDone`, `bail`. Claim acquisition checks whole path sets atomically and canonicalizes path relations including ancestor/descendant conflicts.
- `web` owns loopback HTTP API, command authentication/CSRF defense, SSE replay from `Last-Event-ID`, readable traces, live agent grid, discussion board, budget view, and isolated artifact preview/export.

API examples: `POST /api/runs`, `GET /api/runs/:id`, `POST /api/runs/:id/stop`, `GET /api/runs/:id/events?after=N`, `GET /api/runs/:id/threads`, `GET /api/runs/:id/artifacts`. Admission returns concrete `provider_unavailable`, `cost_bound_unavailable`, `sandbox_unavailable`, or `invalid_model_reasoning` errors before any billable request.

Restart policy: persist a worker lease/epoch. On reattachment verify the actual live worker process and container identity; do not start a duplicate from stale heartbeats alone. In-flight provider requests whose billing outcome is unknown retain maximum liability. Replaying a Pi session must not re-execute completed tools or repeat a billed request automatically.

## Hard $50 caps: safe mechanics and limits

A post-response sum and AbortController are not a hard cap. With 30 simultaneous requests, outstanding charges can already exceed remaining budget by the time the first response reports usage. Aborting a stream does not guarantee provider billing stops immediately or returns final usage.

For each actual provider attempt, reserve a provable upper bound before transport starts:

`reservation = ceil(inputTokenUpperBound * maxApplicableInputRate + outputTokenLimit * maxApplicableOutputRate + fixedRequestFees + boundedBillableTools)`.

Use full uncached input rate unless caching behavior provides a stronger guarantee. Output limit must include billable reasoning tokens according to the exact provider API, not only visible response text. Include image/multimodal charges. Disable server-side paid tools and automatic compaction until independently budgeted. Provider retries, nested model tools and compaction must all obtain reservations; hidden transport retries must be disabled or bounded within a reservation.

Input upper bounds need evidence: provider token-count endpoint or verified tokenizer/serialization accounting. Character-count heuristics are not a mathematical guarantee. A fallback is the provider’s documented maximum billable input for the configured request/model, but reserving the entire context window may prevent 30 requests from fitting under $50. That is a truthful admission failure, not a reason to weaken the cap. Token-count endpoint costs, if any, need their own bound.

Under a serializable transaction, admit only when `settled + uncertain + reserved + proposed <= 50_000_000` micros. After authoritative usage arrives, replace reservation by settled cost and release unused capacity. Unknown/aborted/disconnected outcomes retain the entire reservation as uncertain liability until reconciled. On worker restart do not refund unknown attempts. Decimal price math must round up each bound, never use floating sums for enforcement.

A provider invoice can still disagree with software if rates/discount rules are stale, pricing is unknown, or the provider bills outside the documented request ceiling. Strong claim: this system enforces the locally verified tariff/request ceiling. If the user needs an absolute invoiced-dollar guarantee, combine it with an independently verified provider-side account/project hard spend limit where supported. Label a catalog-cost estimate separately from actual billed dollars.

Cursor bridge with no trustworthy usage/request ceiling cannot satisfy a hard $50 paid cap. Block that particular paid challenge until exact billing bounds or a provider-side limit are verified; do not silently use a different model or call subscription use $0. A $50 authorization is not authorization to exceed $50 while estimating after the fact.

Thirty agents should share a single budget pool. Optional initial per-agent fair-share reservations prevent one agent consuming the whole run before others start; avoid permanently splitting into $1.666 ceilings, because that prevents useful collaboration and final integration. Preserve all 30 identities even if provider rate limits temporarily throttle active requests.

## Practical concurrency and verification

The verified VM has 8 CPUs/18.63 GiB; 30 simultaneous cloud streams are plausible, 30 Chromium/build jobs are not established. Start with 30 network slots, 4 CPU/build slots, and 1–2 browser slots, configurable after measurement. Agent count and tool execution parallelism are independent visible settings. The exact model provider may impose lower simultaneous-request limits; queue/rate-limit rather than faking 30 agents or silently changing requested models.

Required tests: 30 simultaneous reservation races; completion/refund; aborted/unknown billing; restart after send/before settle; kill during model/tool execution; nested child process cleanup; read/write traversal and symlink attacks; host home/auth/env/socket access denied; network denied; fake sandbox failure refuses run; out-of-order/duplicate events; SSE reconnect; crash recovery; lease expiry; conflicting and ancestor file claims; stale claims cannot authorize writes; done/bail terminal idempotency; peer thread visibility and actual collaboration; artifact active-content isolation; real 30-agent challenge traces and rendered deliverables.

Use a deterministic fake provider for fault injection, but fake-provider tests do not prove requested Opus/GPT model availability or real bills. Final acceptance requires each real specified challenge, with pricing evidence and exact provider/model/reasoning persisted. Opus credentials/cost enforcement are an unresolved admission issue, not an architecture implementation blocker.

## Sources and open questions

Primary local sources:
- `/Users/taylor/.local/share/agent-tools/pi/0.84.1/docs/sdk.md`
- `/Users/taylor/.local/share/agent-tools/pi/0.84.1/docs/extensions.md`
- `/Users/taylor/.local/share/agent-tools/pi/0.84.1/examples/sdk/12-full-control.ts`
- `/Users/taylor/.local/share/agent-tools/pi/0.84.1/examples/extensions/ssh.ts`
- `/Users/taylor/.local/share/agent-tools/pi/0.84.1/examples/extensions/sandbox/index.ts`
- Read-only outputs of `podman machine list`, `podman info`, executable resolution.

Open: video-specific worker boundary/UI details; exact Opus4.8 billing/auth path; trustworthy Cursor request/token bounds; current requested-model tariffs and output/reasoning accounting; whether all intended bash commands need shared mutable workspace semantics; cached browser/build dependencies available in a pinned sandbox image. Parent must capture this research in LearningVault before completion.
