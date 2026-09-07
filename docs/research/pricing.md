# Simple Swarm System: exact-model pricing and budget gates

Observed: 2026-09-07. Scope: `anthropic/claude-opus-4-8` at High and `openai-codex/gpt-5.5` at High, using Pi 0.84.1. This is research, not a live billing or model test. No credentials were read and no inference or token-count request was sent. The parent agent owns LearningVault capture.

## Findings that affect the $50 cap

1. **Reserve before every network inference attempt, atomically across every worker.** An after-response running total cannot enforce a cap during concurrent requests.
2. **Pi 0.84.1 Codex does not emit an output-token ceiling.** Reserve its full possible output, not a requested Pi `maxTokens` value. Also force SSE: automatic transport includes WebSocket retries/fallback outside the ordinary SSE retry setting.
3. **Anthropic token counting is free but is expressly an estimate.** It is useful for planning and context validation; it is not a proven strict upper bound for dollars. A full model-window reservation avoids reliance on an approximate tokenizer.
4. **High is an effort setting, not a token allowance.** The billed output includes hidden reasoning. Exact model IDs must remain fixed; do not silently replace Opus 4.8 with Opus 5 or GPT-5.5 with another model.

## Exact rates and limits

All rates below are USD per 1,000,000 tokens at standard speed, before any tax, negotiated discounts, or account-specific modifiers.

| Model | Uncached input | Cache read | 5-minute cache write | 1-hour cache write | Output |
|---|---:|---:|---:|---:|---:|
| `claude-opus-4-8` | $5 | $0.50 | $6.25 | $10 | $25 |
| `gpt-5.5` | $5 | $0.50 | No separate Codex cache-write charge | No separate Codex cache-write charge | $30 |

The Opus row is explicit in the exact-model page and current price list. Opus 4.8 has a 1M context window and 128K maximum output for an ordinary streaming request. The 300K output beta is for Batch API and is outside this design. It is still an active legacy model, with retirement no sooner than May 28, 2027. [Claude Opus 4.8 overview](https://platform.claude.com/docs/de/models/opus-4-8/overview), [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).

Opus 4.8's entire 1M window uses standard token rates; there is no long-context premium. Fast mode doubles the input/output rate and cache multipliers stack on that. Enforce ordinary speed and default global routing, or price any enabled modifier explicitly. Client-side tools have token costs through their definitions, calls and results; server tools may have additional charges. Keep the bounded run to local/client tools unless separate fees are budgeted. [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Claude context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows).

GPT-5.5's public API model page gives 1,050,000 total context and 128,000 maximum output. OpenAI's launch page separately specifies 400K context in Codex; these are distinct products, so do not treat the API context as a proven Codex prompt allowance. [GPT-5.5 API model reference](https://developers.openai.com/api/docs/models/gpt-5.5), [Introducing GPT-5.5](https://openai.com/index/introducing-gpt-5-5/).

The current token-based Enterprise rate card also lists GPT-5.5 at $5/$0.50/$30 and says rates apply at all reasoning levels. Its long-context modifier above 272K input is 2x input/cache-read and 1.5x output, and Fast mode is 2.5x for GPT-5.5. It states Codex does not charge cache writes. Those dollar rates must not be described as a verified bill for a personal included subscription: use them as a conservative API-equivalent accounting rate unless the account's actual billing mode is confirmed. [ChatGPT token-based Enterprise rate card](https://help.openai.com/en/articles/20001415-chatgpt-rate-card-token-based-enterprise-pricing).

## High effort and output ceilings

For Opus 4.8, enable `thinking.type = adaptive` and `output_config.effort = high`. Thinking is off if omitted on this exact model. Its thinking and visible output both consume `max_tokens`; omitted/summarized thinking does not eliminate the underlying output charge. The displayed thinking text is not a reliable billable-token counter. [Claude thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort).

For GPT-5.5, the exact model supports `reasoning.effort = high`. On the public Responses API, `max_output_tokens` limits generated reasoning, visible output, and non-visible formatting tokens together. A response may consume money entirely in reasoning and terminate without visible output. This API field's documented semantics do not establish that the separate Codex backend accepts it. [GPT-5.5 model reference](https://developers.openai.com/api/docs/models/gpt-5.5), [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).

## Anthropic token counting and OAuth

`POST /v1/messages/count_tokens` takes structured input, including system prompts, tools, images and documents. It supports every active model, is free, has independent rate limits, and does not create prompt-cache entries. Anthropic explicitly allows small differences between this estimate and the eventual input count. Models from Claude 4.7 use a different tokenizer; count with `claude-opus-4-8`, not an earlier model. [Token counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting), [Count tokens API reference](https://platform.claude.com/docs/en/api/messages/count_tokens).

Anthropic's maintained API skill documents OAuth bearer authentication with the OAuth beta header, and its token-counting note uses the normal authenticated SDK/CLI. This supports OAuth as an API authentication mechanism. It does **not** explicitly guarantee that every Pro/Max OAuth token issued for Pi has permission to call this endpoint. That exact entitlement remains unverified without a harmless count-only request from the parent. Do not mislabel a 401/403 or missing count as zero tokens. [Anthropic API skill authentication reference](https://raw.githubusercontent.com/anthropics/skills/main/skills/claude-api/SKILL.md), [Anthropic token-counting note](https://raw.githubusercontent.com/anthropics/skills/main/skills/claude-api/shared/token-counting.md).

If counting is used, count the **final transformed outgoing payload**, not raw user text. Include its system instructions, message history, tool schemas, tool results, thinking settings and output configuration where accepted by the count schema. Use a dedicated non-generating count operation; do not test authentication with an inference request. A failed count may either stop the attempt or fall back to the full-window reservation below, never to a smaller guessed amount. This is an implementation recommendation inferred from the count endpoint's scope and estimate caveat.

## Pi 0.84.1: hooks and hidden request paths

Anthropic transport: `onPayload` is awaited after request conversion and before `messages.create`; replacing the payload is supported. `max_tokens` comes from the supplied `maxTokens` or the model default. The Anthropic SDK receives `maxRetries: 0`, but Pi wraps it in `retryProviderRequest` using `options.maxRetries`, so explicitly set that to zero. A supplied `fetch` reaches the SDK. Cache retention defaults to short; explicit `none` removes Pi's cache markers. The stream captures input/cache usage at `message_start` and updates usage later. [Exact Anthropic transport source](https://github.com/earendil-works/pi/blob/v0.84.1/packages/ai/src/api/anthropic-messages.ts).

Codex transport: `onPayload` runs once before serialization and before transport selection. `buildRequestBody` does not set `max_output_tokens`. `maxTokens` is therefore not transmitted as an output cap. Automatic transport can retry failed WebSocket continuation/connection setup and fall back to SSE. Force `transport: sse` and `maxRetries: 0`; SSE then calls the supplied `fetch` once. The body can be zstd-compressed after `onPayload`, so keep a validated payload snapshot or inspect before compression rather than assuming the fetch body is JSON text. [Exact Codex transport source](https://github.com/earendil-works/pi/blob/v0.84.1/packages/ai/src/api/openai-codex-responses.ts).

Recommended placement: the custom stream wrapper selects the pinned model and fixed options; the final `onPayload` validates pricing-relevant fields; the guarded fetch atomically admits each actual inference POST. This arrangement is design guidance, not a Pi built-in budget guarantee. If retries are later enabled, each new inference POST needs a new reservation. Token-count requests use a distinct non-billable operation type. Do not let arbitrary extensions replace the guarded transport or alter the payload after validation.

Disable automatic retry and compaction in the coding-agent session as planned. Also audit summarization, branch summaries, auto-naming and any helper model calls: every generation path must use the same budget gate or be disabled. A wrapper protecting only the main interactive loop does not protect independent provider calls. This is a scope-completeness requirement for the application's cap, rather than a claim that these features are all active by default.

## Conservative reservation policy

The following policy is an engineering inference from the documented ceilings and rates. It assumes pinned models, standard/global routing, no paid server tools, and no transport outside the gate. It limits provider token spending generated by this application, not unrelated account usage or taxes.

Use integer currency units (for example, microdollars) and a durable single-owner ledger or transactional database. The admit invariant is:

`settled_spend + outstanding_reservations + new_reservation <= 50 USD`

Before a request can leave the process, record a unique attempt ID, model, explicit mode, upper token limits, chosen rates, and reservation. Only then hand it to the real transport. Persist the transition to attempted; recovery must never silently reclaim a possibly transmitted attempt.

### Opus 4.8 envelope

For a strict envelope that does not depend on approximate counting, reserve a full 1,000,000 input tokens plus the enforced `max_tokens` output ceiling, even though that overcounts simultaneous context occupancy:

`reserve = 1,000,000 * worst_input_rate / 1,000,000 + max_tokens * 25 / 1,000,000`

With cache retention disabled and a verified marker-free payload, worst input rate is $5/M. With 5-minute caching it is $6.25/M. If 1-hour writes can occur, it is $10/M. Never reserve all input at the cache-read discount in advance.

At an enforced 16,000 output tokens, these envelopes are respectively **$5.40**, **$6.65**, or **$10.40 per attempt**. At the full 128,000 maximum output they are **$8.20**, **$9.45**, or **$13.20**. These are temporary reservations; a clean terminal response can settle to its actual provider-reported usage.

Keeping 5-minute caching while reserving its worst write rate may cost less in practice than disabling caching, because repeated history can hit the much cheaper read rate. Pros: preserves cache savings, strict preflight envelope. Cons: temporarily ties up more of the shared $50 allowance and limits concurrent workers near the end of the budget.

### GPT-5.5 envelope

Because Pi's Codex transport lacks an enforced output cap, reserve the full 128,000 documented output maximum, not 16,000 just because the wrapper requested that number. A safely oversized common bound using the public API's full 1,050,000 context as the input envelope, plus the long-context rates $10/M input and $45/M output, is **$16.26** per attempt. This deliberately over-reserves relative to Codex's advertised 400K total context and is API-equivalent accounting, not proof of a personal subscription dollar charge. If an independently verified tighter Codex bound is adopted, record its evidence and still reserve the full output ceiling.

Do not inject `max_output_tokens` into Codex's payload and assume success proves enforcement: accepted and enforced are different facts. A public OpenAI Responses API provider can use that documented parameter, but switching away from `openai-codex` changes authentication/billing and is outside the assumed subscription configuration.

### Settlement and failures

- Settle a successful terminal response using provider token counts and frozen exact-model prices. Keep input, cache-read, cache-write duration, and output separate. Do not add reasoning again if already included in output.
- An interrupted, timed-out, disconnected or malformed stream does not establish the final bill. Keep its **full reservation consumed/uncertain** until trustworthy reconciliation; do not refund based only on visible text or an early usage event.
- A request rejected locally before transport can release its reservation. Release after a server error only when the response's non-billability is established; the conservative default is to retain it.
- A later retry gets its own reservation, even if its prompt is identical.
- On restart, attempted-but-unsettled entries remain charged against the cap. This prevents crash/restart from reopening the same funds.
- Stop admission before remaining funds are smaller than the next request's envelope. Existing in-flight requests remain covered by their reservations.

## Open questions / explicit limits

- The exact Pi 0.84.1 generated catalog values for `gpt-5.5` and `claude-opus-4-8` need confirmation from the installed SDK package. GitHub tag modules reference generated JSON catalogs absent from the fetched tag paths. Provider public ceilings above remain the authoritative capability references.
- Free token counting is documented; this exact Pi Pro/Max OAuth token's count endpoint permission has not been live-tested.
- Personal Codex included usage is not a USD API invoice. The parent must keep actual paid spending and API-equivalent consumption labels distinct.
- Provider prices and billing modes can change. The run should freeze its observed rate card and reject a model/provider/mode change until repriced.
- A $50 application ledger excludes taxes, fees not modeled above, and spending from other applications. An account-level spending limit is an additional independent control if an invoice-total ceiling is required.

