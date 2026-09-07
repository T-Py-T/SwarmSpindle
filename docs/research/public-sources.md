# Simple Swarm System — public-source investigation

Observed: 2026-09-07. Research question: Is IndyDevDan's demonstrated original swarm public, and which first-party components can inform a faithful reconstruction?

## Original availability

Authoritative public inventory: `gh-axi repo list disler --visibility public --limit 100` returned 53 repositories. Neither `simple-swarm-system` nor `simpleswarmsystem` appeared. `gh-axi repo view disler/simple-swarm-system` returned `REPO_NOT_FOUND`. Exact-name and video-ID web searches yielded no verified original repository. This establishes **not found in the author's public inventory**, not proof that no unpublished/private/renamed copy exists. Author profile: https://github.com/disler . Video: https://www.youtube.com/watch?v=S2sjyokoxeE (web reader failed; video analysis belongs to the parallel video work).

## Pi orchestration and communication — strongest reuse candidate

Repository: https://github.com/disler/pi-vs-claude-code

License verified: MIT, copyright 2026 IndyDevDan. Retain its copyright and permission notice when copying substantial portions. https://raw.githubusercontent.com/disler/pi-vs-claude-code/main/LICENSE

- `extensions/agent-team.ts`: named specialists loaded from Markdown frontmatter; team membership in `.pi/agents/teams.yaml`; orchestrator exposes `dispatch_agent({agent, task})`; specialists run Pi JSON subprocesses and retain per-agent session files. States: idle/running/done/error. Parses text deltas, tool starts, and usage; dashboard includes elapsed time/context. Source: https://raw.githubusercontent.com/disler/pi-vs-claude-code/main/extensions/agent-team.ts
- **Limitations:** this implementation fixes child thinking to off, disables child extensions, inherits orchestrator model, uses the same working directory, lacks an evident hard dollar budget, ignores stderr, and is not by itself a 30-agent isolated swarm service. Its pattern is useful; blindly copying it would miss Taylor's High-thinking and budget requirements.
- `extensions/coms-net.ts`: network peer communication extension; local counterpart `extensions/coms.ts`. Source: https://raw.githubusercontent.com/disler/pi-vs-claude-code/main/extensions/coms-net.ts
- `README.md` confirms four peer tools: list, send, get, await; network version uses a shared Bun HTTP/SSE hub and `coms_net_*` names. Local version uses Unix sockets. The returned message ID supports nonblocking polling or waiting. This peer messaging is complementary to the team/chain orchestrators. Source: https://github.com/disler/pi-vs-claude-code/blob/main/README.md

### Network hub contracts

Source: https://raw.githubusercontent.com/disler/pi-vs-claude-code/main/scripts/coms-net-server.ts

- Public `GET /health`; bearer authorization for `/v1/*`.
- `POST /v1/agents/register`, `GET /v1/agents`, `GET /v1/events` (SSE), `POST /v1/agents/:session_id/heartbeat`, `DELETE /v1/agents/:session_id`.
- `POST /v1/messages`, `GET /v1/messages/:id`, `GET /v1/messages/:id/await`, `POST /v1/messages/:id/response`.
- Message states: queued/delivered/complete/error/timeout. Envelope associates sender/target session IDs, project, prompt, conversation ID, response schema, hops and expiration. Only designated target may submit a response; repeat terminal response receives 409.
- Defaults: loopback, generated auth secret stored mode 0600; explicit token required for nonloopback. 10-second heartbeat; stale after 30 seconds, offline after 60; max hops 5; inbox cap 100; message TTL 30 minutes.
- **Limitations:** maps hold messages/agents in memory; this is communication, not durable job orchestration. README's no-prompt-body logging statement is narrower than actual server logging: `logMessageSend` logs a 50-character prompt preview. Do not assume prompts remain out of logs. Referenced `specs/coms-net-v1.md` returned 404; source is authoritative.

## Pi observability — directly relevant, MIT

Repository: https://github.com/disler/pi-agent-observability

License verified: MIT, copyright 2026 IndyDevDan. https://raw.githubusercontent.com/disler/pi-agent-observability/main/LICENSE

README source: https://raw.githubusercontent.com/disler/pi-agent-observability/main/README.md

- `extension/pi-observability.ts` emits Pi lifecycle telemetry; `apps/observability/server.ts` and `db.ts` ingest into SQLite WAL and stream SSE; `apps/observability/public/` has single, swimlane and race views.
- `POST /events` idempotency keys include `(session_id, seq)`. Extension batches up to 50, retries transient HTTP errors; UI resyncs after reconnect. `scripts/spawn-fleet.sh` and `scripts/validate-swimlane.ts` are useful testing references, **not executed**.
- **Pros:** native Pi telemetry with persistent events and comparative fleet views. **Cons:** observability is not task scheduling, isolation, recovery or spending enforcement; full prompt capture can expose sensitive context.

Canonical schema source: https://raw.githubusercontent.com/disler/pi-agent-observability/main/shared/types.ts

- Envelope includes event ID, timestamp, type, session ID/file, cwd, agent name, pool/tags, provider/model, payload and monotonic seq.
- Event union: session start/shutdown, agent start/end, turn start/end, user/assistant message, tool call/result, model change, thinking, error, custom, compaction, branch navigation.
- Usage carries input/output/cache read/cache write/total tokens/cost total. Tool call IDs link starts/results. Truncation is explicit; text/result limits 32,000 bytes, args 16,000; server request limit 4 MiB.
- Types describe truncation while README claims uncapped first boot snapshot; verify implementation before claiming a specific prompt-capture limit.

## Earlier Claude observability — architectural reference; reuse license unverified

Source: https://github.com/disler/claude-code-hooks-multi-agent-observability

Architecture is Claude hooks → HTTP POST → Bun → SQLite → WebSocket → Vue. Paths: `.claude/hooks/send_event.py`, `apps/server/src/index.ts`, `db.ts`, `types.ts`; client `EventTimeline.vue`, `EventRow.vue`, `ChatTranscriptModal.vue`, `LivePulseChart.vue`. Endpoints `POST /events`, `GET /events/recent`, `GET /events/filter-options`, `WS /stream`. Features include 12 hook events, session/app/type filtering and transcripts. Useful prior art for timeline UX; it is Claude-specific and does not supply the requested worker/swarm control system. Root `LICENSE` and `LICENSE.md` fetches failed; no license verified, so treat as research reference rather than copy-ready material.

## Mac Mini Agent — closest worker/webservice precedent

Source: https://raw.githubusercontent.com/disler/mac-mini-agent/main/README.md

`apps/listen/` is a FastAPI job manager that starts Claude worker processes, persists YAML job state, and exposes `POST /job`, `GET /job/{id}`, `GET /jobs`, `DELETE /job/{id}`. `apps/listen/worker.py` is the worker spawner. `apps/direct/` supplies start/get/list/latest/stop CLI commands. `apps/drive/` controls tmux; sentinel markers encode command completion and exit code. `apps/steer/` is Swift GUI control. Original setup separates agent Mac Mini and primary machine; Taylor's same-Mac deployment should keep logical boundaries but use loopback.

**Pros:** concrete dispatch/worker separation and command-completion pattern. **Cons:** Claude-specific worker and GUI control do not prove Pi swarm behavior or sandbox isolation. Root LICENSE and LICENSE.md fetches failed; licensing unverified, so do not copy code assuming MIT.

## Herdr — terminal runtime, distinct from swarm logic

First-party repo: https://github.com/herdrdev/herdr

License: Apache-2.0: https://raw.githubusercontent.com/herdrdev/herdr/master/LICENSE

Docs: https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/quick-start.mdx

IndyDevDan's actual public recipe: https://github.com/disler/fixing-smartass-opus-5/blob/main/justfile . It creates a workspace, splits panes, renames them, then runs Pi or Claude commands in each pane with `herdr pane run`. This is evidence of a preferred terminal control surface, not evidence that Herdr implements Simple Swarm System. **Pros:** persistent terminal panes and inspectable agent execution. **Cons:** additional runtime dependency; terminal persistence is not durable task semantics, safe spending, or sandboxing. Do not infer that laptop sleep permits local agents to compute.

## Reconstruction implications and open questions

1. Separate confirmed video requirements from these related-source patterns. None of these repositories is verified as the original demo.
2. Best reusable licensed foundations: Pi communication/orchestration extension patterns and Pi observability wire model. Preserve provenance/license if incorporated.
3. Build and test explicit job lifecycle, per-agent sessions/workspaces, model + High reasoning selection, bounded parallelism, 30-agent support, budget admission/reservation, cancellation, recovery and artifact delivery; the related sources do not prove those complete.
4. Same-machine worker + webservice is feasible as deployment composition; actual isolation requires a real boundary and must not be claimed from separate folders alone.
5. Open: complete video-derived UI/actions, challenge prompts and success criteria; exact model IDs/auth availability; precise original's persistence and agent communication design.

Capture note: this staging file is for the parent agent to merge into LearningVault using the native Obsidian CLI, preserving existing topic/software notes and templates.
