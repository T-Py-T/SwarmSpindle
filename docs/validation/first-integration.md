# Initial integration receipt — 2026-09-07

Job: job-mtrqest0-caca9804, failed, exit1, 6.8 seconds.

Dependency installation and dashboard bundle succeeded. Sixteen tests passed, including30 simultaneous independent SQLite connections contending on claims/reservations. Three test files could not resolve workspace packages. Typecheck exposed missing explicit workspace dependencies, mixed Pi0.84.1/0.84.4 transitives, a schema output type mismatch, and a module marker missing from the validation script.

Root fixes awaiting rerun: declare workspace dependency edges, pin the entire audited Pi package family to0.84.1, return the parsed schema's actual type, and mark the validation script as a module. No assertions were removed. Added atomic initial reference seeding and its regression test; added CLI process integration tests.

Sandbox image build job job-mtrqesxw-d61c979d succeeded, exit0. Image SHA:0540714135a515b99483e86ac873ccdaaf672582e8c4e71dda4b656972f94ad1. It includes Chromium145.0.7632.6/Playwright1.58.2 and Python image/SVG tools. Actual containment/render tests remain pending; image build success alone does not prove isolation.

Parallel second pass: worker concurrency/recovery, HTTP security tests, and provider-response identity hardening. The installed Pi transport originally reports requested model IDs, so runtime is being strengthened to check actual server evidence before treating model identity as verified.

## Second integration and corrected render fixture

Job job-mtrqn563-faaa49d6: package installation, TypeScript checking, and dashboard bundling passed. All 52 selected unit/CLI tests passed (267 assertions). Real Podman containment passed 11 tests; the twelfth failed because the test's JavaScript shell quoting prevented PNG production. The fixture now uses a literal Node heredoc and stops on command failure. Its targeted rerun passed with seven assertions, including actual Python and Chromium PNG output. The complete 12-test containment suite will be rerun with the new HTTP, worker, and native-transport tests.

Reference capture job job-mtrqn5aw-f8240920 failed with HTTP 403 in headless Edge. The original page was inspected successfully in the in-app browser, but attempted canvas recordings yielded empty files. No valid 22-second original recording has been recovered. Private source-video frames distinguish the original article from the later generated candidate; reference provenance remains explicit.

## HTTP, scheduler, and complete containment receipt

Job job-mtrr3ot6-5277f4e6 passed all 34 tests with 269 assertions in 13.35 seconds: 12 real rootless Podman tests, 13 actual HTTP/SSE tests, and 9 worker scheduler tests. This includes the corrected Python/Chromium binary render, no host/network/credential access, descendant termination, queued/running cancellation, authentication and CSRF, cross-run isolation, binary downloads, preview headers, paginated/reconnected events, concurrent worker claims, dead-worker recovery without paid replay, and cleanup failure behavior.

The actual empty dashboard was inspected in the in-app browser at http://127.0.0.1:5178. Its cream/monospace/orange presentation and offline-worker state render correctly. Populated browser behavior remains pending the separate six-test Edge suite. Source review subsequently found a provider idle-body timeout gap, an always-terminate-stream error path, and unbounded retained file history; fixes and targeted regression tests are being prepared before live challenge admission.


## Browser and native Pi integration

Initial Edge run job-mtrr7u5t-8e8146dc passed four of six tests. The model selector lacked a concise accessible name; after offline recovery, a stale failed polling response could leave the connection label disconnected. Root added explicit selector naming, bounded HTTP waits, current-selection checks, and connection-state recovery. A CSS rule now honors hidden controls. Follow-up job-mtrra98w-b7d60790 passed all six actual-browser tests and 26 runtime/budget tests, with one error-precedence failure: a later Anthropic usage parser error replaced the earlier server-model mismatch. The observer now preserves its first failure and stops parsing after that failure. No mismatched model was accepted by either version.

The browser suite verifies real local UI, byte-exact download, executing isolated canvas preview, hostile text, confirmed cancellation, phone-width overflow, launch settings, and lossless reconnect. These fixture records are synthetic and are not genuine challenge acceptance.


Targeted rerun after error precedence/history quota integration: 26 core/native tests passed, 247 assertions, 2.23 seconds. Typecheck also passed. The initial independent-review job job-mtrrdima-184417a2 failed before inference because OMP lacked Cursor authentication. It produced no findings and does not satisfy the review gate. Native Pi Claude review is being prepared against the same fixed core source manifest, with one bounded request, no tools, actual server identity verification, and a separate review receipt; it is not one of the challenge swarms.


Native review job job-mtrrgch8-864bbc49 reached the genuine Anthropic server through Pi and verified responseModel claude-opus-4-8 with High reasoning. It used68,077 input and6,000 output tokens, settled490,385 microdollars ($0.490385 equivalent), and returned no final text before its6,000-token output ceiling. Status is truncated, not an approved review. This separate engineering review is not either30-agent challenge and its receipt stays distinct. The next review uses the same fixed source manifest with16,000 output tokens and an explicit concise report request.


## Complete application pass

Job job-mtrro9lo-67232626 passed TypeScript checking, dashboard build, and all123 tests across12files (784assertions) in29.95seconds of test time. Includes17HTTP tests and8realEdge browser tests after content-search/live-conversation changes. Six synthetic-fixture screenshots were saved privately; populated threads, live draft preservation and phone files were inspected visually. No private reference media is included in public source.

Independent native review2 job-mtrrk1bg-c118f8e4 again truncated without final text at16000outputtokens. Verified Opus4.8 usage:68123input/16000output,740615microdollars. Combined native review spend so far:1.231000USD-equivalent. The independent review remains unsatisfied. Next attempt uses a focused Low-effort review of a full fixed application snapshot; this is separate from the High-effort challenge settings.
# Live service and final readiness update

The dashboard and worker now run against the same default database on the M4 Max. Browser inspection at `http://127.0.0.1:5178/` confirmed one worker online and zero missions. Directly opening `apps/web/index.html` is unsupported because it does not load the served bundle/API. No challenge activity has been fabricated from fixture data or implementation agents.

Readiness job `job-mtrryd9q-eb0381d9` completed with exit 0: rootless sandbox image ready; exact native Pi `anthropic/claude-opus-4-8` High and `openai-codex/gpt-5.5` High both ready without inference. This does not prove live challenge success.

The older second native review `job-mtrrk1bg-c118f8e4` was rechecked: one verified Opus response, truncated at its allowance, $0.740615 recorded cost and no final report. The first two reviews total $1.231000, separate from challenge budgets. The focused third review remains a separate engineering check.

## Final integration and clean installation: 2026-09-07

Job `job-mtrssovf-17c3dab4` passed typecheck, build, and 137 tests across 13 files with 1,025 assertions in 50 seconds. This includes 10 actual Edge checks (live raw/agent traces preserve open rows, focus and scroll),12 actual rootless Podman checks, native Pi intercepted HTTP/SSE diagnostics, and 3 actual-process challenge-ordering/duplicate-budget checks. No provider inference was initiated by these tests.

The subsequent clean installation check passed in 7.356 seconds from a copied87-file source snapshot (manifest SHA256 `353c6c8585d32cb1e5cac9bab13af1bb95da8db5ade72a0c4c1d54b2a08af63e`). It installed locked dependencies using a private cache, typechecked and built, served real dashboard assets, verified authenticated API/CLI agreement, started an empty-queue worker, stopped/restarted only the web process while the exact worker heartbeat advanced, and shut all owned processes down gracefully. Fresh data/Pi directories remained free of missions and credentials. This verifies copied-source installation, not a subsequently published Git checkout, image rebuild, or live provider readiness. Private report: simple-swarm-clean-install/report.json.

## Post-challenge diagnostic checks

After the failed canvas run, native fetch rejection and HTTP200 ending without terminal evidence were distinguished with safe fixed categories. Two real-Pi intercepted image-bearing requests prove one admitted attempt, sanitized output and full retained liability for connection rejection and empty SSE. Typecheck and all46 affected runtime tests (377 assertions across5 files,1.68seconds) passed. These fixtures do not identify the historical cause of the two failed GPT requests. No new paid requests, retries, tariff changes or liability releases were made. The preceding137-case full suite remains the complete browser/sandbox integration receipt.
