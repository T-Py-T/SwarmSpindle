# PRD: Budget decisions and visible artifact acceptance

## Overview and goals
Taylor needs peers to understand the resources still available and needs to distinguish a rendered draft from a passed task. Retest budget awareness, Pelican, and Canvas using Claude Opus 4.8 exclusively. Existing runs and their financial history must remain intact.

## Evidence and assumptions
- Original Pelican has a renderable canonical SVG but unresolved riding-contact findings, no final-hash signoffs, and no completed agents.
- The previous awareness probe produced only one valid checkpoint per agent before its $0.25 working target stopped new requests.
- A current admitted request sees its own reservation reduce free capacity and can incorrectly receive wait guidance.
- Reproduced two grader failures: forged capMicros and availableMicros pass the original assessment.
- This change keeps audited tariffs and conservative admission unchanged. A smaller working target is not a guaranteed final bill; current requests can settle above it.

## User stories
- As an agent, I know this request is already funded, how much shared usage remains before the target, and how many turns remain.
- As an operator, I see execution outcome separately from a reviewed artifact and its failed criteria.
- As an operator, I can run three small Claude-only experiments without automatic replacement budgets.

## Functional requirements
1. Budget feedback separates this admitted request from next-request availability, preserving every ledger field.
2. At 80% of a working target, or on the last permitted turn, advise finishing useful work and reporting evidence. Do not change the financial admission gate.
3. Closed target or uncertainty gates report zero admissible new requests; expose raw reservation slots separately.
4. Grade immutable cap and available balance observations, rejecting forged values as well as stale/foreign citations.
5. Record operator artifact assessments in separate storage, bound to output path, exact revision/hash and definition-of-done hash. Derive verdict from nonempty criteria. Missing outputs cannot pass; changed artifacts invalidate prior reviews.
6. Dashboard cards display artifact review and criterion evidence independently of execution status and spending. Render all review text safely.
7. Preserve original run bodies, artifacts, reservations and traces during review and regression testing.
8. Run one new two-peer Opus 4.8 High swarm per task, sequentially, with $1 working target, $6 hard ceiling, max4096 output tokens, 12 turns per agent and 5-minute deadline. Total planned working targets $3; aggregate hard ceilings $18. Never spend to exhaust a target and never retry automatically.
9. Capture provider-verified usage, actual artifacts, independent browser checks, peer messages and honest review outcomes. Do not substitute operator-authored finals or claim original 30-peer challenges passed from smaller retests.

## Alternatives and decision
A prompt-only budget reminder cannot distinguish own admitted liability or support durable reviewed outcomes. Changing request reservation pricing could allow lower hard caps but requires a separately audited transport envelope and creates financial risk. Choose additive structured feedback and separately stored acceptance; defer tariff changes.

## Architecture
Runtime owns admitted-request context and budget advice. Swarm store owns validated assessment persistence in a separate SQLite table. Existing read APIs carry optional assessment data to overview cards. Tooling owns one-shot retest allocation and external result collection. Agents cannot submit operator assessments.

## Validation
Run deterministic regression cases for cap forgery, admission-time own hold, threshold boundaries, turn limits, blocked gates, stale artifact hashes, missing outputs, immutable historical records, and safe UI rendering. Run full existing checks, isolated actual browser/sandbox tests, then three actual Claude swarms. Publish actual costs and separate mechanical, visual and execution results.

## Non-goals
No provider/tariff changes, no billing reconciliation by guesswork, no resetting old liabilities, no unrestricted runs, no automatic natural-language quality oracle.

## Failure insights extension

Taylor requested direct insight into decisions and early stops. The larger Canvas run demonstrated why: an `ECONNRESET` before HTTP response caused a retained request liability, which blocked the other peer. This must be distinct from an agent deciding to bail, a tool command failure, a working-target stop, and true hard-cap exhaustion.

- Record structured, bounded request failure facts: internal error code, model turn, elapsed time, available HTTP/transport classification, request identity and contemporaneous budget. Never record raw provider headers, bodies or credentials.
- Record explicit agent completion/bail decisions separately from runtime-enforced stops, retaining the agent's stated explanation. Do not infer unrecorded motivations.
- Record shell exit status, duration and published-file count independently of the framework's tool-error flag. A shell command can fail while `isError` remains false, and exit zero does not prove useful files were published.
- Provide authenticated run insights with metrics, per-peer stop source/reason, budget at the stop, recent tool outcome, budget observation references and evidence event numbers. Keep current balances separately labeled because other requests may settle after a peer stops.
- Interpret existing traces without rewriting history; mark incomplete evidence and unavailable fields explicitly. Keep the report bounded and provide the raw trace for further investigation.
- Validate historical Canvas-style failures, agent bail versus runtime stop, concurrent late settlement, output truncation, no double counting, missing evidence, escaped rendering, HTTP access controls and the actual desktop/phone UI.

## Open questions and assumptions
No blocking clarification: user explicitly requested autonomous adjustments and three Claude swarms. Treat the three tasks as the existing budget-awareness, Pelican and Canvas cases. These are smaller regression experiments with explicit criteria, not a 30-peer reproduction claim.

## Authorized larger-budget stage

Taylor subsequently authorized larger shared budgets, up to $50 per swarm, once improved guidance is confirmed. Keep the initial three two-peer Claude Opus 4.8 retests as the evidence gate. Before expansion, verify accurate distinct budget observations, separation of current admission from new-request capacity, and appropriate completion or handoff decisions; deterministic tests cover precise cutoff states not observed live. Report any live behavior not demonstrated rather than treating a larger allocation as its fix.

After that gate passes, use Claude Opus 4.8 for larger problem-solving attempts, retain a small coordinated peer count, and treat $50 as the shared ceiling rather than a per-agent allowance or a spending target. Preserve capacity for final verification and corrections. Each new allocation must have a durable identity; no resetting original ledgers or duplicating an interrupted allocation. The earlier $18 aggregate ceiling describes only the initial small-test batch, not this separately authorized later stage.
