# Independent application review

The fixed application packet was reviewed through native Pi by `anthropic/claude-opus-4-8` at Low effort. The trusted SSE observer verified the actual response model. This was a standalone engineering request with no tools or editing rights, separate from both High-effort challenge swarms.

- Job: `job-mtrrwvc6-c288b53c`, completed with exit 0.
- Packet SHA256: `255c075b51e17096e39e86fbb012077eb72750195000b312e5ccb22207e9e89c`.
- Application manifest fingerprint: `45c88067a4911340e0a1e3ddfbf4beb3021238bda4e18fcaae721bd7144c1e05`.
- One provider request; recorded USD-equivalent usage: $0.807005. Together with two earlier truncated review attempts, review usage totals $2.038005. This is not challenge spending.
- Scope: 33 application/source-contract files; durable accounting, native response evidence, file ownership, command containment, worker cancellation, CLI and web/preview boundaries. No independent execution was performed by the reviewer.

The reviewer found no critical unhandled break in the supplied packet and gave a conditional ship verdict. Findings and disposition:

| Finding | Evidence and disposition |
| --- | --- |
| Codex input usage might use a gross convention while our observer uses net input | Resolved by inspecting pinned Pi 0.84.1 `dist/api/openai-responses-shared.js:423–431`: Pi explicitly subtracts cached and cache-write input. The Codex adapter delegates to this shared handler. The existing real-Pi intercepted-HTTP regression already supplies 20 gross input and 3 cached tokens, verifies 17 net input, and settles 147 microdollars. Preserve exact normalized equality; do not weaken it to hide mismatches. Live GPT-5.5 response verification remains part of the actual challenge. |
| The store allowed a reservation marked uncertain to settle later | Added a durable guard: only a reserved request may settle for the first time. Identical settled replay remains idempotent. Added a close/reopen regression proving uncertain liability, budget, usage and events cannot be reduced by a later settlement. Passed in the 128-test, 833-assertion integration run with typecheck and build. |
| A bare heading marker at the start of a valid CLI prompt produced an empty title | Empty derived titles now use `New swarm`. Added a CLI regression checking the complete valid prompt is retained and queued without inference. Passed in the 128-test, 833-assertion integration run with typecheck and build. |

The first finding was a conditional assumption, not a demonstrated defect. The other two were low severity; the reviewer traced no currently reachable normal-runtime path that released uncertain liability.

Separately, source review of the operator-only challenge runner found a possible duplicate launch race and ambiguous identification of a preceding pelican run. The runner now acquires an exclusive persistent per-challenge claim before queue creation, retains it on uncertain failures, and identifies the preceding pelican by its recorded run ID and specification hash. Two actual-process regressions passed in the same integration run. The first genuine pelican attempt subsequently ran and retained its durable claim; see acceptance.md.

Review does not prove artifact quality, actual 30-peer completion, reference motion fidelity, clean installation, or public delivery. Those remain explicit acceptance requirements.

## Subsequent diagnostic delta

A separate source review identified SSE event-name handling that could lose a safe Anthropic error category; that fix passed the137-case suite. After the real canvas failures, further bounded review identified fetch-before-response and empty-stream paths without safe categories. The final adapter records only fixed phases and allowlisted transport codes, rejects incomplete EOF evidence, preserves first failure and retained liability, and introduces no retries. Typecheck plus all46 affected runtime cases/377 assertions passed. Actual historical provider causes remain unknown. Overall release confidence is4/5: broad local execution is covered, but black-box provider failures and both unmet artifact acceptances limit the conclusion.
