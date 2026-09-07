# Adopted runtime and public contracts

Candidate A from `research/runtime-candidates.md` is selected: separate trusted web and Pi worker processes on the Mac, with all model-controlled shell operations inside a network-disabled, nonprivileged local Podman container. Pi does not discover personal tools, skills, prompts, AGENTS files, or extensions. Only explicit swarm tools are available. The model transport uses native Pi authentication; commands receive neither credentials nor host filesystem access.

The web process queues runs and reads state through `@simpleswarm/swarm`. The worker independently claims queued runs, registers its identity and heartbeat, starts the requested number of actual Pi sessions, and records their events. SQLite provides the shared durable transaction boundary. No browser connection is required for the worker to continue.

## Ownership

- `modules/swarm`: public contracts, validated specifications, SQLite persistence, lifecycle, messages/threads, atomic file claims/versioned contents, request reservations and accounting. One logical owner for durable swarm state.
- `modules/sandbox`: explicit Podman execution adapter. Materializes a snapshot into an isolated command workspace and returns a validated changeset. It cannot publish canonical files.
- `modules/runtime`: explicit Pi session/tool integration and budget-gated model transport. Calls swarm and sandbox public contracts. Never implements a second ledger.
- `apps/web`: loopback HTTP/SSE and dashboard composition. User state changes require same-origin protection. Active artifacts use a separate sandboxed preview origin without access to the control API.
- `apps/worker`: worker process lifecycle, scheduling and signal handling.
- `apps/cli`: launch/status/stop/export/doctor interface. Supports the demonstrated `just swarm COUNT MODEL BUDGET PROMPT` experience.

## File mutation

Canonical files are versioned records owned by the swarm module. Read/write/edit/restore and shell changes use the same claims and optimistic base revisions. A command gets a disposable snapshot, not a writable mount of canonical files. All changes publish atomically only when each changed path has a live claim held by that agent and its base revision is current. Any collision rejects the complete changeset. Symlinks and special files are rejected at the sandbox boundary. This deliberately strengthens the original's visible after-the-fact shell claim-violation detection.

## Money

Use integer microdollars. Reserve an authoritative worst-case ceiling before each provider attempt. Force no transport retry and disable unbudgeted auto-compaction. Unknown/aborted responses retain full reserved liability. Concurrent reservation refusal may wait when other requests can release liability; actual insufficient remaining funds stop the run. Never treat unknown rates or usage as zero. Codex subscription usage is labeled USD-equivalent, distinct from a metered Anthropic invoice. Do not assume Pi's `maxTokens` limits Codex: verify its actual request semantics and otherwise reserve the documented model maximum.

## Test seams

The user's requested feature testing is exercised at the public swarm module, the real Podman execution boundary, worker-to-Pi provider boundary, HTTP/SSE interface, actual dashboard user paths, and the two real model challenge runs. Tests must not depend on private implementation methods or replace the final real runs with fake outputs. Deterministic fault injection is allowed only for failure-path coverage, clearly separate from live acceptance evidence.

## Initial scope of implementation packets

Core, sandbox, and Pi runtime are independent writers in isolated worktrees using the contracts in `modules/*/contracts.ts`. The coordinator owns web/CLI composition and integration. API changes must be proposed to the coordinator before altering shared contracts. All work remains unpublished until independent review and appropriate validation pass.
