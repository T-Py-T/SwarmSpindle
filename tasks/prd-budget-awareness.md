# Budget-aware peers and a README that shows the experiment

## Purpose
Make small swarm experiments useful for verifying whether peers understand their shared cost position. Present the project as an engineer's active attempt to understand swarm coordination through one observable dashboard, with real screenshots and a practical starting point.

## User stories
- An agent can distinguish verified spending, temporary reservations and unresolved charges, and make a useful next-work decision.
- An operator can choose a small working target and fewer agents while retaining the separate enforced hard ceiling.
- A reader can see what the app does, why this experiment matters, what differs from a collection of terminals, and how to run it.

## Requirements
1. Extend the existing budget tool; keep raw microdollar fields compatible. Add own spending, working target/remaining amount, next-request reservation, current request capacity, a clear decision and guidance. Persist each observation with its actor and return its trace sequence.
2. Automatically attach a fresh runtime-owned budget snapshot before every inference. Instructions require a budget check before choosing work, costly verification and completion, without repeated wasteful polling.
3. Add optional workingTargetMicros, positive and no greater than the hard cap. Gate new reservations and dispatch once verified shared usage reaches it. Existing requests can finish, so this is a working target, not a guaranteed invoice ceiling. Preserve strict full-liability accounting and all historical records.
4. Classify unfinished work stopped by the working target as bailed with a clear reason. Preserve genuine peer failures and explicit successful completion when the final verified response crosses the target; reaching the target alone proves neither completion nor failure.
5. Expose the optional target in CLI and dashboard. Use two agents, a $0.25 working target and a $6 hard ceiling as the small Opus example; Codex still needs its larger conservative reservation. Actual paid execution awaits the pending budget selection.
6. Test ready, reservation-waiting, target reached, hard cap exhausted and unresolved states. Verify exact target boundaries, in-flight settlement, independent swarms, changing snapshots across actual Pi turns, and links between tool observations and agent conclusions.
7. Provide a bounded live budget-awareness probe that uses the same worker/tools/UI, creates durable attempt evidence, and never silently retries or resets prior challenge budgets. A model's conclusions are checked against the immutable observations it cites. Record whether the working target was actually approached/reached; simulated tests must not be represented as live behavior.
8. Rewrite README in an enthusiastic first-person engineering voice. Include 'So what?', what it does, meaningful differences, real screenshot captions, and tested self-service setup. Keep jargon/provenance/validation concise and linked. Do not imply either original challenge succeeded.

## Scope and assumptions
This adds an agent tool contract and a short instruction routine; it does not load arbitrary external skills into isolated peers. No price heuristics, billing refunds, new providers, relaxed hard ceiling or replacement 30-agent challenge. The pending question offers Opus $6 total hard ceiling, both providers $23 total, or offline only. No paid work proceeds without that selection.

## Verification
Pure and tool tests, real Pi sessions with intercepted transport, spec/CLI/HTTP/browser checks, a bounded live probe only if selected, and visual inspection of public screenshots/README. Preserve state hashes for both prior runs. Audit all workflow files (none currently) and publish through the existing repository workflow.
