# Message search and cost diagnostics validation

Recorded 2026-09-07 (local time). Message search and the request accounting circuit are deployed on the local dashboard and worker. Research is captured in LearningVault.

## Verified checks

| Check | Result |
| --- | --- |
| Store and HTTP tests | 42 passed; 499 assertions; 3.83 seconds |
| Runtime tests | 55 passed; 421 assertions; 1.64 seconds |
| Type checking | Passed |
| Web build | Passed |
| Complete integration run | 157 passed; four new browser cases initially failed because the scope selector lacked an explicit accessible name |
| Affected browser cases after accessible-name fix | All four passed (1 + 3 targeted runs); context, literal search, export, snapshot paging and stale-response behavior verified |
| Live rollout | Both processes restarted; all 52 historical messages indexed; canonical swarm JSON hashes unchanged |

The integration run included all 14 actual Edge cases and 12 actual rootless Podman cases. Its 157 passing cases plus the four corrected browser cases cover all 161 tests. The final accessible-name-only change was verified with the four affected browser cases and type checking; the entire suite was not repeated. This establishes the tested application behavior, not completion of either real model task.

## Replay of the failed Canvas request contexts

Both actual failed Canvas contexts were replayed through a local loopback HTTP endpoint. Each replay preserved both original PNG payloads, measuring 1,106,215 and 1,123,881 bytes. System instructions and tool definitions were reconstructed, so these were not byte-for-byte reproductions of every field in the original external requests.

| Replay context | Messages | Tool results | Request JSON bytes | Compressed request bytes (zstd) | Reported elapsed time |
| --- | ---: | ---: | ---: | ---: | ---: |
| First failed context | 12 | 9 | 3,007,485 | 2,246,164 | 61 ms |
| Second failed context | 12 | 9 | 3,007,635 | 2,246,190 | 67 ms |

There were four local HTTP requests in total and **zero provider requests**. The two outcomes exercised for each context were:

- A complete synthetic SSE response settled 147 synthetic microdollars.
- A cut response produced `response_incomplete` and retained the full 16,260,000 synthetic microdollar reservation ($16.26).

The replay establishes that these image-bearing contexts can pass through the tested serialization, compression, local HTTP, stream parsing, and liability paths. It does not establish that the original external failures were caused by images, request size, compression, the network, provider load, authentication, or any other particular external condition. No historical external cause has been proved.

## Strict spending limits and uncertain charges

The strict admission rule accounts for verified spending, requests already in flight, and unresolved charges. The amount displayed as verified spending can therefore be much smaller than the amount unavailable for new work.

For the audited GPT-5.5 subscription transport, each request reserves $16.26: the conservative full input and output envelope at the applicable higher rates. A request that ends without trustworthy final usage retains that reservation. A network error, timeout, empty stream, or missing completion is not evidence that the provider processed no tokens.

The new per-swarm admission circuit stops further reservations and dispatch after a dispatched request becomes uncertain. Budget waiters exit promptly, and a peer cannot begin another inference after its current turn. Requests already dispatched are allowed to finish and settle verified usage; opening the circuit does not abort those requests. The resulting run failure explains unverified charges instead of presenting the condition as ordinary budget exhaustion.

Existing uncertain liabilities remain intact. The existing release path applies only when a reservation is known not to have reached dispatch. These changes make no historical refunds, relax no cap, add no provider retries, and make no new paid inference attempts.

GPT-5.5's long-context premium now remains active within the same actual Pi session after verified input, including cached input, exceeds 272,000 tokens. A later smaller context does not reset that session's tariff. Separate sessions keep separate tariff state. Historical ledger records are not rewritten.

## Message search and rollout

Message search uses literal full-body substring matching. ASCII matching is case-insensitive; non-ASCII matching remains case-sensitive. Searches can be scoped by swarm and author. Search cursors are global, while message IDs remain local to their swarm. The context lookup retains the swarm and thread identity of the selected message.

Search responses bound returned body bytes to 1 MiB per page, while permitting at least one message when that message alone exceeds the page target. This bounds ordinary response sizes without silently excluding an individually large matching message.

The rollout includes backfilling existing messages so search covers stored history as well as newly posted messages. Both worker and web processes must use the updated code: the worker writes new messages and the web serves search. Restarting both is part of deployment; passing source checks or building assets alone does not prove that currently running processes have loaded the change. The live rollout backed up SQLite, gracefully stopped both old processes, and started both from the updated source. All 52 messages were backfilled; both canonical swarm JSON hashes matched the backup exactly, including costs/events. An actual browser loaded the 50-message Pelican conversation, found 21 saddle-related messages and opened a seven-message context with no browser errors. The in-app dashboard was refreshed and shows connected with one worker online. No provider requests were initiated.

## Evidence behind the conservative budget policy

| Source | What it establishes | Benefit | Limitation |
| --- | --- | --- | --- |
| [OpenAI token counting guide](https://developers.openai.com/api/docs/guides/token-counting) and [counter reference](https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count) | The standard Responses API offers exact processed input counting, including structured messages, tools, images, and files. The documented endpoint uses API-key authentication. | A documented basis for smaller input reservations on that supported API path. | Does not establish an equivalent counter or tokenization parity for the ChatGPT OAuth backend. Free counting was not confirmed by the reviewed OpenAI pages. |
| [OpenAI Responses output limit](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) | `max_output_tokens` bounds generated tokens, including reasoning, on the documented Responses API. | Supports bounded output reservations where this contract applies. | Does not establish support or enforcement on the Codex subscription backend. |
| [GPT-5.5 model documentation](https://developers.openai.com/api/docs/models/gpt-5.5) | Lists the model envelope and the full-session premium after input exceeds 272K tokens. | Supports the conservative reservation and persistent session tariff. | A maximum model envelope is much larger than ordinary requests. |
| [Anthropic token counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting) | Counts structured input, including tools and images, for free; explicitly describes the result as an estimate. | Useful for planning and prompt sizing. | No documented maximum counting error makes an arbitrary margin a strict guarantee. Subscription OAuth counter support was not established in this audit. |
| [Anthropic Messages reference](https://platform.claude.com/docs/en/api/messages/create) | `max_tokens` is an absolute output maximum; thinking counts toward the limit. | Gives an enforceable output bound on the documented API. | Does not make estimated input counts exact. |
| [Pi 0.84.1 Codex adapter](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/src/api/openai-codex-responses.ts), [Anthropic adapter](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/src/api/anthropic-messages.ts), and [request hooks](https://raw.githubusercontent.com/earendil-works/pi/v0.84.1/packages/ai/src/types.ts) | Final transformed payloads pass through `onPayload` before inference transport. Anthropic emits the requested output ceiling; the Codex request builder omits an output-limit field. | Provides an admission boundary after provider-specific transformations. | A shared SDK option name is not proof that every backend enforces it. Fetch hooks do not cover WebSocket transport; the audited runtime forces SSE and disables retries. |

An exact supported counter plus an enforced output ceiling could improve budget utilization on a separately selected API path. For the current Codex OAuth path, this audit found neither a documented exact counter nor a verified smaller request output ceiling. Local token heuristics, percentages added to estimates, and prior-turn usage must not be described as guaranteed bounds for text, tools, images, and opaque context together.

## Remaining acceptance work

- Browser regressions and live presentation checks passed as recorded above.
- Backfill and coordinated worker/web restart passed without changing historical swarm state.
- Keep the historical external failure cause explicitly unresolved unless new authoritative evidence establishes it.
- Do not infer provider compatibility, model task completion, or artifact quality from synthetic loopback responses.
