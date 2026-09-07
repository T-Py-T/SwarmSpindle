# Tasks: Simple Swarm System

Source: [prd-simple-swarm-system.md](prd-simple-swarm-system.md), revision 2. Updated 2026-09-07.

## Relevant Files

- `tasks/prd-simple-swarm-system.md` — numbered product requirements and acceptance contract.
- `tasks/tasks-prd-simple-swarm-system.md` — execution and verification checklist.
- `docs/GOAL.md` — durable goal, authority, receipts and remaining work.
- `docs/ARCHITECTURE.md` — adopted process/module/isolation design.
- `docs/research/video-requirements.md` — timestamped transcript and screenshot findings.
- `docs/research/public-sources.md` — public source inventory and reuse/provenance constraints.
- `docs/research/runtime-candidates.md` — alternatives and reasons for adopted architecture.
- `docs/research/pricing.md` — exact-model tariff, payload, transport and reservation evidence.
- `docs/research/canvas-reference.md` — exact article and local reference path recovered from screenshots.
- `docs/validation/requirements.md` — requirement-to-test and live-evidence ledger.
- `docs/validation/persistence-scale.md` — measured 30-agent synthetic persistence benchmark and limits.
- `docs/validation/acceptance.md` — real challenge receipts and final artifact review (planned).
- `modules/swarm/contracts.ts` — shared state/domain interface.
- `modules/swarm/index.ts`, `spec.ts`, `state.ts`, `store.ts` — validated specs, transactional durable state, and retained-content quota.
- `modules/sandbox/contracts.ts`, `index.ts` — Podman execution interface and module exports.
- `modules/sandbox/podman.ts`, `process.ts`, `queue.ts`, `snapshot.ts` — isolation, process execution, queue and validated snapshots.
- `tooling/sandbox/Dockerfile`, `runner.mjs`, `README.md` — container recipe, bounded immutable runner and operating notes.
- `modules/runtime/contracts.ts`, `index.ts` — explicit Pi integration interface and exports.
- `modules/runtime/pricing.ts`, `budget.ts`, `tools.ts`, `pi-runtime.ts`, `response-evidence.ts` — frozen rates, request admission, tools, actual provider evidence, and real peer lifecycle.
- `modules/runtime/TRANSPORT.md` — provider transport and liability behavior.
- `apps/shared/config.ts` — private storage and loopback port configuration.
- `apps/shared/seeds.ts` — bounded operator reference import before atomic queue creation.
- `docs/validation/first-integration.md` — initial test failures, passed checks and image build receipt.
- `tooling/capture-reference.ts` — rendered original canvas frame capture (private output).
- `apps/shared/prompt.ts` — DoD prompt/model/budget input parsing.
- `apps/web/server.ts` — HTTP/SSE control boundary and isolated artifact service.
- `apps/web/main.ts` — dashboard startup and assets.
- `apps/web/index.html`, `styles.css`, `app.ts` — dashboard, scoped content search, live conversations, and artifact views.
- `apps/worker/main.ts`, `scheduler.ts` — concurrent queue claims, independent worker lifecycle, recovery, and cleanup.
- `apps/cli/main.ts` — launch/status/stop/export/doctor.
- `tests/swarm.test.ts` — core public state, retained-history quota, and true connection contention tests.
- `tests/sandbox*.test.ts` — adapter and real containment tests.
- `tests/runtime*.test.ts` — admission, tools, actual SDK sessions, intercepted native transport, and provider faults.
- `tests/web.test.ts`, `tests/cli.test.ts`, `tests/browser.test.ts`, `tests/helpers/web-fixture.ts` — operator, HTTP, CLI process, and actual-browser integration.
- `prompts/demo/USER_PROMPT_PELICAN.md`, `USER_PROMPT_CANVAS_FROM_VIDEO.md` — reconstructed challenge criteria with explicit provenance.
- `tooling/verify-artifact.ts` — external artifact measurement and evidence capture; genuine challenge output remains pending.
- `tooling/review-packet.ts` — fixed-source native reviewer request; receipt required before the review gate can pass.
- `tooling/integration-pass.ts`, `swarm-scale.ts` — integrated checks and bounded synthetic persistence measurement.
- `docs/OPERATIONS.md` — native Pi authentication, rootless Podman, configuration, lifecycle, and recovery guide.
- `tooling/first-pass.ts` — initial install/typecheck/module-test/build validation orchestration.
- `.dockerignore` — restrict image build context.
- `tooling/build.ts`, `justfile`, `README.md`, `.gitignore`, `LICENSE`, `package.json`, `tsconfig.json`, `modules/*/package.json` — build/install/launch/public delivery.

### Notes

- Root owns integration, process execution, dependency installation, all validation jobs and this checklist. Each implementation agent has a separate worktree and exclusive module lease.
- Process independent parent groups in parallel once their shared contracts are fixed; preserve dependency order within each group. No writer shares a checkout.
- A draft file is not a completed task. Mark `[x]` only after the stated verification passes and record the receipt. Synthetic provider responses do not establish genuine challenge participation or artifact acceptance.
- Use Bun public-interface tests, TypeScript checking, actual Podman tests and Playwright browser checks, not the skill template's illustrative Jest command.
- Use Codex Process Jobs for qualifying finite workloads; resume results in a later delivery/goal turn. Never poll a just-launched job in the launch turn.
- Commit/publication follow existing user authority and review gates. No automatic release workflow is assumed; every workflow must be PR-only.

## Tasks

- [x] 1.0 Complete evidence and requirements (FR-01–45; owner root/research)
  - [x] 1.1 Export the transcript through the YouTube browser tool and select relevant timestamps. Verify full 39-minute coverage; receipt: private transcript and timestamped source matrix.
  - [x] 1.2 Inspect selected high-resolution frames for launch syntax, Pi identity, tool names, dashboard, pelican objective and DoD. Verify findings against viewed frames; receipt: screenshot addendum.
  - [x] 1.3 Recover the canvas starting prompt/reference from selected video sections and, if available, Taylor's reference link. Record evidence versus inference and inspect the original motion.
  - [x] 1.4 Establish public-source availability and licenses. Verify original absent/publicly withheld, list reusable MIT precedents and unverified-license exclusions; receipt: public-sources.md.
  - [x] 1.5 Create numbered PRD covering operator, agent, safety, challenges and delivery; verify all research matrix categories and user overrides map to requirements; receipt: revision 1 PRD.
  - [x] 1.6 Generate this task list with owners/dependencies and explicit checks, including work already underway; verification: 45 FR IDs represented in tasks below.
  - [x] 1.7 Import exact-model pricing evidence, capture updated provider readiness and screenshot findings in LearningVault, and verify saved notes via native CLI (FR-22/25/45).
  - [x] 1.8 Write challenge prompt files from recovered evidence; compare each DoD to the source matrix before live use (FR-37–42).

- [x] 2.0 Implement durable swarm state (FR-02/04/05/10/11/15–17/21/23/25–28; owner core then root)
  - [x] 2.1 Validate specs/paths/limits and persist full swarm/agent identities. Check malformed specs, missing DoD and unsupported settings fail without writes.
  - [x] 2.2 Implement names, team state, threads/posts/membership and incremental inbox. Check collision/order/empty/durable/cross-run behavior.
  - [x] 2.3 Implement atomic worker claims, heartbeat and lifecycle transitions. Verify two-worker claim race and terminal state truth table.
  - [x] 2.4 Implement file claims, revisions, all-or-nothing publication, history/diff/restore. Verify 30-way race, stale snapshots, owner release, deletion, lease expiry, binary integrity and no cross-swarm access.
  - [x] 2.5 Implement durable microdollar reservations/settlement/uncertain accounting. Verify 30 independent SQLite connections cannot overreserve and late reconciliation never reduces unknown liability without evidence.
  - [x] 2.6 Test reopen/recovery and persisted-state invariants, invalid states and scale behavior with meaningful artifact history. Review snapshot write amplification before accepting runtime load.
  - [x] 2.7 Import released worktree, run targeted tests/typecheck and fix actual failures; attach core validation receipt.

- [x] 3.0 Implement and prove real command isolation (FR-14/16/18–20; owner sandbox then root)
  - [x] 3.1 Build Podman image with offline Chromium/Playwright, Python/Pillow/SVG tools. Verify architecture and actual render from a clean image.
  - [x] 3.2 Implement read-only snapshot to bounded tmpfs, nonroot/cap-dropped/read-only-root/network-none runner; independently validate exported regular files and revisions.
  - [x] 3.3 Implement global command queue, memory/CPU/PID/output/time/file-byte/count bounds and cancellation. Verify overload, queued abort, timed-out subprocesses and no surviving descendants.
  - [x] 3.4 Exercise real containment against host sentinel files, credentials, sockets, symlinks/special files, traversal and network. Record results, never replace with flag-only assertions.
  - [x] 3.5 Verify write/edit/bash/export cannot bypass live core claims and a conflict leaves canonical files unchanged.
  - [x] 3.6 Import released worktree, run unit + opt-in real tests/typecheck and review cleanup paths. Attach sandbox receipt.

- [x] 4.0 Integrate genuine Pi peers and money gates (FR-07–14/20–28; owner runtime then root; depends core/sandbox)
  - [x] 4.1 Pin exact SDK/model/reasoning, native auth and explicit empty discovery. Test hostile personal-resource fixture and unavailable auth/model messages.
  - [x] 4.2 Create one persisted session per requested agent with identical mission and distinct identity. Verify all required prompt/settings reach every actual session.
    - Current evidence: actual SDK tests cover one session and two concurrent one-agent swarms, including hostile-resource rejection and mission/tool payloads. The genuine pelican run now proves 30 distinct actual sessions and 30 server-verified Opus responses; see acceptance.md.
  - [x] 4.3 Connect custom peer/file/budget/done/bail tools to public module contracts. Test argument errors, output shape, safe failures and real sandbox publication.
  - [x] 4.4 Gate every inference POST before network; validate final payload and fixed rate card. Verify Anthropic output bound and Codex SSE/full-output reservation, with no retry/fallback/helper escape.
  - [x] 4.5 Settle trustworthy usage, retain abort/disconnect/unknown liability, and fairly queue budget contention. Fault tests cover refund wakeup, cancellation, starvation, true exhaustion and crash recovery.
  - [x] 4.6 Trace messages/provider thinking/tool IDs/usage without secrets and terminate finished sessions. Verify no generation after done, failed/bail distinction, idle/turn/run bounds.
  - [x] 4.7 Validate actual native model request identity through the guarded integration before counting acceptance. No unapproved separate spending beyond the authorized challenge envelope.
    - Both native Pi OAuth providers are ready. A third independent review completed. Both genuine challenge rosters now prove 30 actual sessions and server-verified exact-model responses. Artifact acceptance remains separate.
  - [x] 4.8 Import released worktree, run runtime targeted tests/typecheck and independent budget/security review. Attach receipt before challenge admission.

- [x] 5.0 Build operator dashboard, service and CLI (FR-01–06/25/27–36; owner root)
  - [x] 5.1 Compose durable queue worker and independent loopback web service. Support concurrent independent runs with bounded resource use; check no double claims or state leakage.
  - [x] 5.2 Implement launch/prompt parsing/status/stop/export/doctor and `just swarm` compatibility. CLI tests verify exact model/count/cap/DoD propagation, errors and byte-exact export.
  - [x] 5.3 Implement authenticated same-origin HTTP API, bounded bodies, SSE cursors/cleanup and active artifact isolation. Test foreign Host/Origin/CSRF, malicious content, disconnect/reconnect and preview escape attempts.
  - [x] 5.4 Build demo-style SWARMS/THREADS/AGENTS views with statistics, budget liability and terminal/worker state. Check rendered metrics against stored records.
  - [x] 5.5 Implement original-goal conversation, search, activity/creation/volume/member sort, all/active/dormant filters, agent trace filtering and full/raw expansion. Check empty/multiple-thread cases in browser.
    - Passed: earlier-message content search, empty results, goal/DoD inclusion, agent details, expansion, and live composer/cursor/scroll preservation. The 128-test integration receipt additionally covers the complete ordering/filter matrix over distinguishable threads in actual Edge. The newer automatic live-trace regression remains pending.
  - [x] 5.6 Add timeline, claims/files/history/download/isolated preview, operator post, deliberate launch and stop. Verify keyboard/forms, responsive layout and safe agent-generated text.
  - [x] 5.7 Test browser closure while worker runs, service restart, dead worker handling and uncertain-paid-work nonreplay. Verify retained completed swarms and offline/error states.
    - HTTP service/database reopen, browser offline/reconnect, and deterministic scheduler death/recovery tests passed. The genuine pelican worker also survived closure of both HTTP dashboard tabs: calls advanced302→340 over64.583seconds with the same worker identity/PID and a newer heartbeat. Reopening restored conversation/trace; private browser-closure receipts are referenced in acceptance.md.
  - [x] 5.8 Compare actual dashboard screenshots to selected original frames. Fix substantive visual/behavior gaps and record deliberate improvements.

- [ ] 6.0 Run ordered genuine challenge acceptance (FR-07/12/21–28/37–42; owner root; depends 1–5)
  - [x] 6.1 Freeze code/settings/prompts/pricing/test receipts and verify readiness before requesting model work. Record hashes and authorized per-run cap.
  - [x] 6.2 Launch exactly 30 Opus 4.8 High Pi agents for pelican under $50. Verify distinct real sessions and provider activity, not merely database rows.
  - [ ] 6.3 Render produced SVG externally; check every anatomy/bike/riding/composition/no-external criterion and measured critiques. Verify early complete canonical draft and two independent same-hash signoffs with adversarial evidence.
  - [x] 6.4 Preserve pelican artifact/hash/traces/status/usage/ledger/verification receipt. Do not claim success if criteria or actual participating count fail.
  - [x] 6.5 Subsequently launch exactly 30 GPT-5.5 High Pi agents for canvas under its own $50. Preserve same identity/settings/budget evidence.
  - [ ] 6.6 Inspect actual canvas DOM and compare to recovered original across 22 seconds at 1 fps. Measure nonblank/motion/brightness, inspect flow and density, test resize/DPR and longer stability.
  - [x] 6.7 Preserve canvas artifact/reference provenance/hash/traces/ledger/visual review. Record defects honestly and fix authorized system faults without silently resetting spent budget or rerunning beyond authority.

- [x] 7.0 Review, publish and hand off (FR-43–45; owner root + independent reviewer; depends all)
  - [x] 7.1 Run appropriate complete suite, typecheck and build after integration; investigate failures without weakening assertions. Fill all FR-to-evidence rows.
  - [x] 7.2 Complete fixed-artifact independent review with actual different-family model identity, focusing on state, money, isolation, transport, lifecycle and UI. Resolve findings and rerun affected checks.
  - [x] 7.3 Write README/setup/configuration/operation/troubleshooting, MIT license and provenance; verify clean checkout installation and fresh private data directory.
  - [x] 7.4 Audit every `.github/workflows/` file for PR-only triggers, repository secrets/private logs/media and ignored runtime data before public publication.
  - [x] 7.5 Publish authorized public repository and verify remote contents and required checks; do not affect upstream repositories.
  - [x] 7.6 Update LearningVault and final requirements/task/goal receipts; deliver running local service links, repository link, how to launch, both challenge results/costs and honest limitations.

## Latest execution receipt

Full integration `job-mtrssovf-17c3dab4` passed typecheck/build and 137 tests across 13 files with 1,025 assertions in 50 seconds. This includes 10 actual Edge cases,17 HTTP cases,12 rootless Podman cases, native Pi lifecycle/transport regressions, and 3 actual-process challenge-runner checks. The independent Opus code review completed, findings were resolved, and affected checks passed. See [integration](../docs/validation/first-integration.md) and [review](../docs/validation/independent-review.md).

A clean 87-file source copy installed locked dependencies, typechecked/built, started the actual authenticated dashboard and an empty-queue worker, preserved the same worker across web shutdown/restart, and shut down gracefully. No provider requests were made by the installation check. The subsequent public-checkout install passed in job-mtrt69e3-41b82993; see public-delivery.md. The sandbox image was built and tested separately; the clean-install check did not rebuild it or authenticate providers.

Both ordered genuine challenges reached30 distinct actual Pi sessions and30 server-verified responses with exact model/High settings. Both ended budget_exhausted within their own $50 cap. Pelican: $23.219985 settled+$21.600000 uncertain, valid SVG but uncorrected contact/signoff defects. Canvas: $1.585418 settled+$32.520000 uncertain, no final HTML. [Acceptance](../docs/validation/acceptance.md) records all missing criteria without calling either run successful. No extra spending or replacement run is authorized.

## Remaining release and acceptance work

- Historical provider causes remain unknown; source investigation and sanitized diagnostic improvements passed46 affected runtime tests without inference or modifying historical liability.
- Preserve failed quality, temporal and final-signoff requirements; do not substitute synthetic or operator-authored output for a genuine challenge.
- Audit the final publication file set and workflows, publish only the authorized repository, and verify a checkout of its published contents.
- Synchronize LearningVault, requirements, task and goal receipts; hand off the running services, source, actual costs and limitations.

## Public delivery receipt

Repository https://github.com/T-Py-T/simpleswarmsystem is public on main. Published application commitb23594e0453a23eeab93904b4fe9bd4f1223a90c matched a fresh public clone and passed locked install, typecheck/build and18 isolated web/worker lifecycle checks. No workflows or Actions runs; no private references, credentials, real sessions or databases published. See [public-delivery.md](../docs/validation/public-delivery.md). Successful artifact acceptance remains open without further authorized budget.
