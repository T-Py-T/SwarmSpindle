# Requirement-to-evidence ledger

Updated 2026-09-07. A passed synthetic test is not genuine challenge acceptance. This ledger distinguishes implementation checks from live evidence and keeps incomplete requirements visible. Detailed receipts: [integration](first-integration.md), [scale](persistence-scale.md).

Latest full integration `job-mtrssovf-17c3dab4` passed typecheck/build and 137 tests/1,025 assertions, including 10 actual Edge,17 HTTP,12 actual rootless Podman checks and native Pi lifecycle/transport cases with intercepted responses. A fresh 87-file source copy installed locked dependencies, built, served authenticated web/CLI data, preserved an actual worker across web restart, and shut down cleanly. See [integration](first-integration.md).

Both exact models now have genuine30-peer evidence: the pelican ended budget_exhausted with all 30 Opus responses; the canvas ended budget_exhausted after 61 verified responses across all 30 GPT-5.5 peers, without publishing final HTML. The independent native Opus review completed and its findings were resolved/tested. Artifact acceptance remains separate; see [acceptance](acceptance.md) and [independent review](independent-review.md).

| Requirement | Behavior | Evidence | Current result |
| --- | --- | --- | --- |
| FR-01 | CLI + just launch | tests/cli.test.ts | CLI passed; recipe delegates to the same command |
| FR-02 | Strict mission settings | tests/swarm.test.ts; tests/web.test.ts; tests/cli.test.ts | Passed |
| FR-03 | Independent worker and web | apps/worker/main.ts; apps/web/main.ts; tests/worker.test.ts; tests/browser.test.ts | Passed deterministic recovery, actual browser closure during pelican progress, and actual web-process restart with the same worker heartbeat in a fresh installation. |
| FR-04 | Concurrent isolated swarms | tests/worker.test.ts; tests/web.test.ts; tests/runtime-session-lifecycle.test.ts | Scheduler overlap/atomic claims and two real SDK sessions with intercepted responses passed. Genuine worker-controlled provider overlap remains pending. |
| FR-05 | Atomic queue and worker identity | tests/swarm.test.ts; tests/worker.test.ts | Passed |
| FR-06 | Operator CLI and readiness | tests/cli.test.ts; apps/cli/main.ts; docs/validation/first-integration.md | CLI launch/status/stop/export passed. Both Pi OAuth providers ready; freeze final pre-challenge readiness with run settings. |
| FR-07 | Exact genuine Pi sessions | tests/runtime-native-transports.test.ts; tests/runtime-session-lifecycle.test.ts; docs/validation/first-integration.md | Passed pinned SDK guards; both genuine challenges reached30 distinct actual Pi sessions and30 server-verified responses using their exact requested models/High settings. |
| FR-08 | No personal resource discovery | tests/runtime-session-lifecycle.test.ts | Hostile AGENTS/SYSTEM/extension fixture passed |
| FR-09 | Shared mission to each peer | tests/runtime-session-lifecycle.test.ts; modules/runtime/pi-runtime.ts | Shared mission/tool payload checks passed. Both genuine30-peer rosters reached30 actual distinct sessions. |
| FR-10 | Names and roster | tests/swarm.test.ts; tests/runtime-tools.test.ts | Passed; genuine peers chose names and coordinated in the pelican and canvas runs. |
| FR-11 | Threads and incremental inbox | tests/swarm.test.ts; tests/web.test.ts | Passed; pelican retained50 genuine shared messages with incremental inbox/tool activity. |
| FR-12 | Peer-selected collaboration | modules/runtime/pi-runtime.ts; prompts/demo/ | Genuine pelican peers selected roles and file ownership; duplicated roles and stale coordination limited completion. Canvas also ended budget_exhausted. |
| FR-13 | Truthful correlated traces | tests/runtime-session-lifecycle.test.ts; tests/browser.test.ts | Passed fixture and genuine live traces; publication excludes private traces/sessions. Final source privacy audit remains required. |
| FR-14 | Read/write/edit/bash | tests/runtime-tools.test.ts; tests/sandbox.integration.test.ts | Passed; real pelican peers used file and isolated shell tools to publish canonical SVG and Chromium render. |
| FR-15 | Exclusive file claims | tests/swarm.test.ts | 30-connection race, expiry and owner checks passed |
| FR-16 | Atomic mutation ownership | tests/runtime-tools.test.ts; tests/swarm.test.ts | Structured and shell changeset rejection passed |
| FR-17 | History/diff/restore | tests/swarm.test.ts; tests/runtime-tools.test.ts | Passed, including retained-history quota |
| FR-18 | Actual command containment | tests/sandbox.integration.test.ts | All 12 actual Podman checks passed |
| FR-19 | Resource bounds and cleanup | tests/sandbox.test.ts; tests/sandbox.integration.test.ts; tests/worker.test.ts; tests/swarm.test.ts | Real bounds/cancellation/descendant checks passed. Retained binary-history quota defaults to 100 MiB; reduced-quota regression and upper-limit validation passed. Trace/zero-byte revision metadata remain outside that byte quota; command concurrency is per worker adapter. |
| FR-20 | Offline rendering and references | tests/sandbox.integration.test.ts; tests/swarm.test.ts | Chromium/Python render and atomic seed passed |
| FR-21 | Durable worst-case reservation | tests/swarm.test.ts; tests/runtime-budget.test.ts; tests/runtime-native-transports.test.ts | Passed; pelican retained$21.60 uncertain liability, stopped admission within its original$50 cap, and preserved its ledger. |
| FR-22 | Fixed rates and request policy | tests/runtime-pricing.test.ts; tests/runtime-native-transports.test.ts | Passed |
| FR-23 | Trustworthy usage and uncertainty | tests/runtime-budget.test.ts; tests/runtime-session-lifecycle.test.ts | Malformed/aborted/ledger-failure and retained-liability checks passed |
| FR-24 | Fair budget waiting | tests/runtime-budget.test.ts | FIFO, cancellation, refund, and independent budgets passed |
| FR-25 | Budget displays reconcile | tests/browser.test.ts; tests/runtime-tools.test.ts | Fixture totals passed; final pelican dashboard matches$23.219985 settled/$21.60 uncertain/$5.180015 available. Canvas final ledger is$1.585418 settled/$32.52 uncertain/$15.894582 available. |
| FR-26 | Done/bail stops generation | tests/runtime-session-lifecycle.test.ts; tests/runtime-tools.test.ts | Passed with actual Pi sessions and synthetic transport |
| FR-27 | Accurate lifecycle states | tests/worker.test.ts; tests/runtime-session-lifecycle.test.ts | Deadline/shutdown/stop/failure distinctions passed |
| FR-28 | Recovery without paid replay | tests/worker.test.ts; tests/web.test.ts | Passed |
| FR-29 | Demo visual fidelity | tests/browser.test.ts; apps/web/styles.css; docs/research/video-requirements.md | Actual screenshot/source-frame comparison recorded in dashboard-comparison.md, including deliberate font/logo/markdown differences. |
| FR-30 | Swarm statistics | tests/browser.test.ts | Rendered fixture metrics passed |
| FR-31 | Thread/agent drilldown and search | tests/web.test.ts; tests/browser.test.ts; apps/web/app.ts | Passed full earlier-message search, paging, empty results, drilldown, all four sort modes and all three activity filters in actual Edge. |
| FR-32 | Live conversations and trace expansion | tests/browser.test.ts; apps/web/app.ts | Passed live conversation and raw/agent trace append with expanded DOM, focus, draft, selection and scroll preserved; genuine pelican timeline observed. |
| FR-33 | Cursor-based reconnection | tests/web.test.ts; tests/browser.test.ts | HTTP paging/reconnect and real browser offline recovery passed |
| FR-34 | Files/history/download/preview | tests/web.test.ts; tests/browser.test.ts | Exact bytes and executing isolated canvas with parent/cookie denial passed |
| FR-35 | Accessible controls and layout | tests/browser.test.ts | Launch validation, confirmed stop, phone layout and keyboard checks passed |
| FR-36 | Loopback and hostile input | tests/web.test.ts; tests/browser.test.ts | Host/Origin/CSRF/escaping and preview separation passed |
| FR-37 | 30 Opus pelican peers, $50 | prompts/demo/USER_PROMPT_PELICAN.md | Executed once:30 Opus4.8 High, all 30 verified responses, original$50 cap preserved; ended budget_exhausted. |
| FR-38 | Pelican artifact quality | prompts/demo/USER_PROMPT_PELICAN.md | Failed acceptance: valid self-contained SVG renders, but wing/handlebar contact gap remains uncorrected. |
| FR-39 | Early draft and independent critiques | prompts/demo/USER_PROMPT_PELICAN.md | Failed acceptance: draft after$10.225310 settled missed~15% target; two quantitative critiques exist, but no corrected revision or two final-hash signoffs. |
| FR-40 | 30 GPT-5.5 canvas peers, separate $50 | prompts/demo/USER_PROMPT_CANVAS_FROM_VIDEO.md | Launched after the terminal pelican attempt:30 GPT-5.5 High, separate$50 cap; all 30 actual responses verified; ended budget_exhausted with no final artifact. |
| FR-41 | Actual canvas and temporal fidelity | docs/research/canvas-reference.md | Two original video frames recovered; continuous original recording unavailable; output comparison pending |
| FR-42 | Canvas stability and resize | tooling/verify-artifact.ts; prompts/demo/USER_PROMPT_CANVAS_FROM_VIDEO.md | Verifier passed actual isolated animated-canvas22-second/DPR1/2/resize/60-second regressions; genuine canvas output verification remains pending. |
| FR-43 | Public reproducible delivery | README.md; docs/OPERATIONS.md; LICENSE; bun.lock | Locked install and fresh-data web/worker startup/restart/shutdown passed from a clean source copy. Public Git checkout and publication verification remain pending. |
| FR-44 | Independent review and PR-only workflows | docs/validation/first-integration.md; root .github inventory | Native independent fixed-source review completed, findings resolved and covered by passing integration. Subsequent sanitized-diagnostic delta independently source-reviewed and tested. No workflows exist; final publication audit pending. |
| FR-45 | Durable research and task evidence | tasks/; LearningVault/4-Research/Codex/Simple Swarm System/ | Research updates saved and read back; final synchronization pending |

## Completion checks

- [x] Record the full passing implementation suite, typecheck, and build with its actual scope.
- [x] Link all 45 requirements to current source/tests or explicitly missing live evidence.
- [x] Preserve independent evidence for actual HTTP, Edge, Podman, and intercepted Pi SDK tests.
- [x] Verify one requested 30-peer mission reaches 30 distinct actual Pi sessions with every shared setting.
- [x] Assert all thread sort orders and activity filters over distinguishable multi-thread browser fixtures.
- [x] Observe actual worker-process progress while the browser is closed and after web restart.
- [x] Compare populated UI screenshots with the original timestamped demo frames and record differences.
- [x] Complete a fixed-artifact independent review and resolve its findings.
- [ ] Complete both ordered genuine challenges with actual provider response/activity, immutable per-run ledgers, artifact hashes, and external visual acceptance.
- [ ] Verify clean-checkout installation and independent startup with a fresh data directory.
- [ ] Audit the final public file set and PR-only workflow triggers, publish the authorized destination, and inspect remote contents.
- [ ] Synchronize final research, task, requirement, and goal records.

## Remaining installation and acceptance limits

Clean copied-source installation and fresh-data web/worker lifecycle passed. A published Git checkout has not yet been installed or verified. The host browser prerequisite is Microsoft Edge; actual browser checks passed with the explicit opt-in documented in README. The container image and native authentication readiness were verified separately from the empty-Pi-directory installation check.

Both authorized real challenges were attempted once and failed artifact acceptance. Preserve those results and their uncertain liabilities. Neither the passing implementation suite nor the all 30 model responses makes their missing quality/signoff requirements pass. Remaining publication verification must inspect exact remote contents and PR-only workflow policy; no workflow files exist in the current source.
