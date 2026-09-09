# Tasks: Budget decisions and visible artifact acceptance

## Relevant Files
- modules/runtime/budget-awareness.ts — admitted request, budget phase and available capacity.
- modules/runtime/pi-runtime.ts — refreshed runtime context and remaining turns.
- tests/runtime-budget-awareness.test.ts, tests/runtime-budget-target.test.ts — budget feedback regressions.
- modules/swarm/contracts.ts, modules/swarm/assessment.ts, modules/swarm/store.ts, modules/swarm/index.ts — separate artifact review persistence.
- tests/artifact-assessment.test.ts — validation, stale evidence, missing output and historical immutability.
- apps/web/overview-model.ts, apps/web/overview.ts, apps/web/styles.css, tests/overview.test.ts — visible reviewed artifact status.
- tooling/budget-probe.ts, tests/budget-probe.test.ts, prompts/budget-probe.md — exact available/cap claim grading.
- tooling/swarm-retest.ts, tests/swarm-retest.test.ts, prompts/retest-pelican.md, prompts/retest-canvas.md — bounded three-task Claude retest.
- tooling/record-assessment.ts — explicit operator review ingestion.
- docs/validation/swarm-budget-feedback.md — before/after evidence and actual run receipts.

## Tasks
- [x] 1.0 Diagnose and plan
  - [x] 1.1 Inspect original Pelican artifact, acceptance and probe records.
  - [x] 1.2 Reproduce available/cap claim grading failures.
  - [x] 1.3 Specify additive feedback, review persistence and three capped Claude retests.
- [x] 2.0 Improve budget decisions
  - [x] 2.1 Separate admitted current work from next-request capacity and expose remaining turns.
  - [x] 2.2 Add wrap-up advice and prove financial gate invariants.
  - [x] 2.3 Reject forged available/cap checkpoints and verify regression.
- [x] 3.0 Make artifact acceptance visible
  - [x] 3.1 Store hash-bound operator reviews without mutating historical run bodies.
  - [x] 3.2 Display criteria and artifact verdict separately from runtime outcome.
  - [x] 3.3 Test stale/missing/forged records and escaped UI output.
- [x] 4.0 Validate and run three Claude experiments
  - [x] 4.1 Add one-shot sequential runner and test allocation/cap constraints.
  - [x] 4.2 Pass appropriate full regression, typecheck/build and browser/sandbox checks.
  - [x] 4.3 Restart updated services and verify historical hashes.
  - [x] 4.4 Run one two-peer Claude swarm for each task and inspect independent evidence.
  - [x] 4.5 Record honest original/new artifact assessments and dashboard screenshots.
- [x] 4.6 Confirm the live guidance gate before increasing budgets; document what was and was not demonstrated.
- [x] 4.7 After confirmation, run Claude-only problem-solving swarms with up to $50 shared per swarm, preserving final verification capacity and original ledgers.
- [ ] 5.0 Deliver
  - [x] 5.1 Review diff, document actual results and remaining limits.
  - [ ] 5.2 Publish validated changes through an owner-authorized pull request.
- [x] 6.0 Explain agent decisions and runtime stops
  - [x] 6.1 Trace larger Canvas failure and reproduce missing diagnostics over HTTP.
  - [x] 6.2 Record safe request/agent-stop/shell outcome events without changing admission.
  - [x] 6.3 Project historical evidence into metrics and contemporaneous stop explanations.
  - [x] 6.4 Expose authenticated insights and verify desktop/phone rendering.
  - [x] 6.5 Document actual larger-run results, remaining limits and screenshots.
