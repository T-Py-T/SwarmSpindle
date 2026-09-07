# Pinned Pi transport boundary

The implementation is audited against installed `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` **0.84.1**. Pin transitive Pi packages to the same version; mixed package versions can break session construction before a request starts.

## Verified source behavior

- Anthropic's `onPayload` is awaited after OAuth payload conversion and before `messages.create`. OAuth injects Claude Code identity text and bearer headers. With explicit `cacheRetention: none`, its identity, system, message and tool blocks have no cache-control markers. Native client and Pi retries are both disabled explicitly.
- Opus 4.8's installed catalog declares adaptive thinking, a 1M context and 128K output. High maps to `thinking.type: adaptive` and `output_config.effort: high`. `max_tokens` is emitted and validated.
- Codex's awaited payload hook precedes transport selection and its header timeout. Explicit SSE bypasses WebSockets and their fallback/retry paths. The injected fetch is called in the SSE path. `maxRetries: 0` permits one HTTP attempt. Pi does not emit `max_output_tokens`; the reservation covers the full public envelope, regardless of requested output length.
- Both adapters initialize `message.model` from the **requested** model. They do not preserve the server's model in `responseModel`. The runtime therefore independently observes the bounded SSE response stream. It requires the actual server model and final token counts, compares them with Pi's usage, and only then settles. Unverified model aliases fail closed and retain attempted liability.
- Pi custom tools replace same-named built-ins. Every session supplies its complete allowlist, an empty resource loader and in-memory settings. Auto-compaction and retries are disabled; no resume/branch/summary commands are exposed. Session generation is replaced through public `agent.streamFunction`, without global provider or fetch overrides.
- Successful `done` first persists the conclusion, then synchronously aborts the Pi agent loop. Later calls cannot mutate canonical state. It does not buy an extra final model response.

## Admission and shutdown

Admission is FIFO within each swarm, with separate queues for distinct swarm budgets. A queued abort rejects promptly while preserving live caller order. Reservation waiting occurs inside the final-payload hook before provider HTTP timers begin; fetch still requires the validated, admitted request. An abort proven to occur before transmission releases its reservation with zero usage. Once transmission is attempted, uncertainty retains the full ceiling.

Worker deadlines (including Pi runtime time limits) become stalled agents and a failed run. Worker shutdown produces an interrupted run. Operator cancellation remains cancelled. Unknown request costs are never inferred as zero.

Anthropic's SDK timeout ends when response headers arrive, so the runtime observes body progress independently. A body idle timeout aborts the transport, cancels its pending reader, marks the agent stalled, and retains attempted liability. Terminal SSE closes the response even if the server leaves the HTTP connection open; watchdogs and abort listeners are removed on every close/cancel path.

If writing uncertain liability fails, the stream still emits a terminal failure. Existing durable reservations remain held; a failed reconciliation write must never strand the Pi consumer or worker shutdown behind a stream that can no longer finish.

## Verification scope

`runtime-native-transports.test.ts` drives actual pinned Pi provider transports through intercepted HTTP, with synthetic credentials and recorded synthetic SSE responses. It checks OAuth conversion, payload fidelity, retry suppression, server identity, and missing usage. `runtime-session-lifecycle.test.ts` uses real Pi sessions with in-memory synthetic credentials to exercise done, later batch calls, worker abort reasons, and two concurrent runs. These are deterministic integration checks, **not live model acceptance**. The parent process owns test execution and both real 30-agent challenge runs.

Sources: [Anthropic adapter](https://github.com/earendil-works/pi/blob/v0.84.1/packages/ai/src/api/anthropic-messages.ts), [Codex adapter](https://github.com/earendil-works/pi/blob/v0.84.1/packages/ai/src/api/openai-codex-responses.ts), [response parser](https://github.com/earendil-works/pi/blob/v0.84.1/packages/ai/src/api/openai-responses-shared.ts), [SDK session construction](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/sdk.ts), [agent session](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/agent-session.ts).
