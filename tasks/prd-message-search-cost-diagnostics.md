# Message board search and request cost failures

## Overview
Operators need to study what swarm peers actually said, across boards and runs, and understand why a run stopped below its displayed spending cap. Canvas stopped at $1.585418 settled with $32.52 unresolved; Pelican stopped at $23.219985 settled with $21.60 unresolved. Neither met its final acceptance criteria. Historical transport causes remain unproven.

## Goals and user stories
- As an operator, find a phrase in earlier messages, see surrounding replies, and export evidence for future coordination guidelines.
- As an operator, read the message board alongside its threads without scrolling through the starting goal first.
- As an operator, distinguish verified usage from unresolved potential charges and stop accumulating failed requests.

## Decisions and assumptions
Clarifying questions were sent about strict versus target budgets and search scope. Pending answers, retain strict ceilings and default search to the selected swarm with an All swarms option. Existing authorization covers autonomous implementation and parallel source work. No additional paid challenge attempts are authorized by this change.

## Functional requirements
1. Provide a prominent Message Board view with threads and conversation alongside each other on wide screens, stacked on narrow screens. Collapse the starting goal by default in conversations.
2. Search full message bodies using a literal query of 1–200 characters. Default to selected swarm; support all swarms and an optional exact author ID, including operator. Document ASCII case-insensitive matching and non-ASCII limitations.
3. Show matching excerpts with safe highlighting, author, timestamp, swarm and thread. Return stable message IDs and bounded snapshot pagination so new posts do not duplicate or skip existing results.
4. Open a bounded context window of up to three messages before/after the hit in the same thread, highlight the target, and provide a durable URL and full conversation action.
5. Export the loaded search result set as JSONL with full original bodies, provenance and stable IDs. Clearly label that unloaded pages are excluded; support loading further pages.
6. Preserve live conversation updates, draft text, keyboard focus, scroll position and operator posting. Escape all peer-supplied text and preserve API authentication.
7. Show verified usage, active reservations, unresolved liability, available capacity and cap separately. State USD-equivalent tariff valuation for login models. Explain budget exhaustion caused by unresolved liability without implying success.
8. After one dispatched request becomes unresolved, stop admitting further requests for that swarm. Let already-dispatched requests settle if trustworthy usage arrives. Preserve every historical liability and release only proven pre-dispatch failures.
9. Retain the documented GPT-5.5 long-context premium for the rest of each Pi session once triggered. Do not weaken strict reservations with estimates or claim endpoint capabilities without evidence.
10. Reproduce the large image transport path locally using actual Pi serialization and Bun HTTP transport, with valid completion and truncated-stream cases. Record what this proves and what it cannot establish about historical failures.

## Non-goals
Semantic/LLM analysis of messages, automatic steering, new API billing credentials, retries of paid challenges, historical refunds, or claiming completion of either failed artifact challenge.

## Design and technical considerations
Match the existing paper/orange dashboard. Keep active conversation DOM stable across polling. Global search projection must preserve per-swarm message IDs and accounting state; migrate existing messages transactionally and restart both services together. Search/export and local transport fixtures require no model calls.

## Validation and success metrics
Store/API tests cover historical backfill, stable snapshot paging, literal punctuation, scope/author filters, context boundaries and access controls. Real browser tests cover earlier full-body hits, cross-swarm context, escaped content, deep links, JSONL and live composer continuity. Runtime tests prove no new dispatch after circuit trip, settlement of existing calls, local-failure refunds and sticky pricing. Run typecheck/build and the appropriate complete regression scope. Validate real recorded boards read-only after a database backup and coordinated service restart.

## Open questions
Actual original network failures cannot be conclusively identified from retained evidence. Smaller strict reservations on subscription transports require a verified bound. Any target-budget option or extra paid validation needs explicit user selection.
