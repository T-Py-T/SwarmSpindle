# Product requirements: Simple Swarm System

Status: implementation in progress; acceptance not yet established. Revision 2, 2026-09-07.

## 1. Overview

Build a public, independently authored recreation of the Simple Swarm System demonstrated by IndyDevDan in [this video](https://www.youtube.com/watch?v=S2sjyokoxeE). Taylor should be able to give a group of real Pi agents a task, model, shared spending limit, and definition of done; observe their collaboration; and inspect the resulting files and verification evidence. The worker and web service must both run on Taylor's M4 Max MacBook. A second physical computer is not required.

The original source is not publicly available according to the presenter's statement and the public repository investigation. This product must distinguish observed behavior, user requirements, and reconstruction decisions. Do not claim to have recovered the original source or unobserved implementation details.

This PRD consolidates the user's requirements and completed transcript/screenshot research. A targeted clarification about the exact canvas reference URL is pending. That uncertainty blocks final reference acceptance, not independent implementation. Existing implementation drafts must be checked against this PRD before being marked complete.

## 2. Goals

1. Reproduce the demonstrated launch, peer collaboration, shared files, spend tracking, completion, and dashboard workflows.
2. Create the requested number of independent, genuine Pi sessions using exactly the chosen provider, model, and reasoning level.
3. Prevent concurrent requests from exceeding each run's authorized token-cost envelope; distinguish subscription dollar equivalents from actual invoices.
4. Keep arbitrary agent commands isolated from the Mac's files, credentials, and network while supporting local Chromium/Python artifact verification.
5. Demonstrate working unattended execution, persistence, cancellation, clear failures, and inspection after completion.
6. Pass the user's ordered real acceptance challenges: 30 Opus 4.8 High agents on the recovered pelican task under $50, then 30 GPT-5.5 High agents on the recovered canvas task under a separate $50.
7. Deliver a public repository with reproducible installation, tests, evidence, licensing, and operating instructions.

## 3. User stories

- As an operator, I launch a swarm from the terminal with a prompt file so I can repeat a task with different counts, models, and caps.
- As an operator, I browse swarms, threads, and agents so I can understand what is happening and why agents stopped.
- As an operator, I inspect a goal, conversation, individual calls, file history, and outputs so I can assess the work independently of the agents' claims.
- As an operator, I stop a run and restart the dashboard without losing history or accidentally repeating paid requests.
- As a peer agent, I choose a name, discover teammates, announce work, exchange findings, and join threads so the team can divide work organically.
- As a peer agent, I claim a file and publish a revision so simultaneous work cannot silently overwrite another agent's changes.
- As a peer agent, I query shared funds, verify output, report completion or inability, and stop so the team converges without spending the entire limit unnecessarily.
- As a new repository user, I install and run the system with my own supported Pi login and verify isolation before starting paid work.

## 4. Evidence and interpretation

The timestamped source matrix is [video-requirements.md](../docs/research/video-requirements.md). Public source provenance is [public-sources.md](../docs/research/public-sources.md). Private reference video, transcript, and extracted frames stay outside public Git.

Evidence labels: **D** directly observed in the demo; **U** explicit user requirement; **R** reliability/security reconstruction decision. Unresolved detail must remain visible and cannot be replaced silently with a convenient implementation.

Important anchors: launch 2:02–2:15 and frame 0260; Pi 6:31–6:37 and 31:03–31:08; pelican goal frames 0350/0390/0410/0434; claims frame 0835; done frames 1566/1583; canvas comparison 27:42–28:11; final pelican frame 1730. The original demo detects some shell claim violations after mutation; prevention before canonical publication is an intentional strengthening.

## 5. Functional requirements

### Operator side: launch and deployment

| ID | Requirement | Evidence | Acceptance evidence |
|---|---|---|---|
| FR-01 | Support `just swarm COUNT MODEL BUDGET PROMPT_PATH`, plus documented equivalent CLI; dollar cap is per swarm. | D/U | CLI integration creates a persisted spec with exact values; invalid arguments fail before launch. |
| FR-02 | Require nonempty task, explicit definition of done, canonical final-output path, valid count, supported model/reasoning, and positive cap. | D/R | Validation tests cover missing/empty/malformed fields, dangerous paths, unsupported choices, and bounds. |
| FR-03 | Run web and worker as independent processes on the same Mac; browser closure must not stop work. | D/U | Real worker continues after dashboard/browser disconnect; reconnect shows durable progress. |
| FR-04 | Permit independent concurrent swarms without shared messages, claims, files, or budgets. | D | Two real worker-controlled runs overlap and cross-run isolation tests pass. Ordered challenge runs remain sequential. |
| FR-05 | Queue runs durably and atomically claim each once; expose worker identity, heartbeat, and unavailable-worker state. | R | Two-worker race, offline queue UI, dead-worker recovery, and no duplicated claim tests. |
| FR-06 | Provide status, stop, file export, setup verification, and readable failure messages through CLI. | R | CLI process tests exercise success, invalid input, unavailable dependencies/auth, and export content. |

### Agent side: real peer collaboration

| ID | Requirement | Evidence | Acceptance evidence |
|---|---|---|---|
| FR-07 | Use Pi with one independent session per requested agent; pin provider/model/reasoning with no fallback. | D/U | Session IDs, request model/effort, and successful per-agent provider activity retained for all 30 in each challenge. |
| FR-08 | Load only swarm instructions and explicit tools; never discover personal extensions, skills, AGENTS files, or privileged host tools. | R | SDK configuration test plus hostile personal-resource fixture cannot introduce a tool or prompt. |
| FR-09 | Every agent receives the shared task, DoD, output path, team count, budget policy, and peer coordination guidance. | D | Initial session prompt checks and real traces show identical mission/settings with distinct identities. |
| FR-10 | Agents choose unique display names and list the team with stable identities and current status. | D | Naming collision test, team-list test, and real naming events. |
| FR-11 | Provide `post`, incremental `inbox`, thread creation/join, and persisted member/message history; new inbox can be empty. | D | Ordered/durable inbox tests, cross-swarm denial, thread membership, and real peer responses. |
| FR-12 | Agents choose and deconflict work as peers rather than following a fixed manager-assigned dependency graph. | D/U | Challenge traces demonstrate announcements, responses, critique, and revision decisions by independent sessions. |
| FR-13 | Capture provider-supplied text/thinking, tool invocation/result and correlation, usage, timestamps, and terminal reasons without exposing credentials. | D/R | Trace tests, representative real traces, credential-redaction review. No fabricated hidden thinking. |

### Shared workspace and isolation

| ID | Requirement | Evidence | Acceptance evidence |
|---|---|---|---|
| FR-14 | Provide explicit `read`, `write`, `edit`, and `bash` capability in one canonical workspace per swarm. | D | Real tool integration writes, edits, reads, and executes code producing a visible artifact. |
| FR-15 | Provide atomic `claim_file`/`release_file`, owner identification, lease expiry, and normalized relative paths. | D/R | 30-way claim race has one owner; unauthorized release, aliases/traversal, expired claims, and killed owners covered. |
| FR-16 | All mutation routes enforce ownership and base revisions atomically, including shell-generated changes; a rejected batch publishes nothing. | R | Tests prove shell cannot bypass claims, stale snapshots fail, and mixed-validity changesets have no partial publication. |
| FR-17 | Provide `file_history`, `file_diff`, and claim-protected `file_restore`; retain authorship, reason, revision, and exact bytes. | D/R | Round-trip text/binary revisions, deletion/restore, diff, and cross-run history tests. |
| FR-18 | Model shell executes only inside nonprivileged local Podman containers with read-only root, no network, no credentials, no host sockets, no writable host workspace. | U/R | Actual container tests for identity, mounts, network denial, host sentinel safety, and credential absence. |
| FR-19 | Bound CPU, memory, processes, time, output, workspace bytes/file count, and concurrency; terminate descendants before export and on cancellation. | R | Real overload/timeout/descendant tests and queued cancellation; verify cleanup after failures. |
| FR-20 | Include offline Chromium/Playwright, Python/Pillow and SVG rendering tools; permit deliberate operator reference seeding without exposing arbitrary host paths to agents. | D/R | Real browser render and image measurements in sandbox; seed-file tests with canonical versions. |

### Budget, stopping, and persistence

| ID | Requirement | Evidence | Acceptance evidence |
|---|---|---|---|
| FR-21 | Use a durable per-attempt reservation before inference leaves the worker, covering the maximum priced response; concurrent settled+reserved+uncertain liability never exceeds the cap. | U/R | 30-client ledger contention plus guarded actual transport tests; live receipts retain every attempt and rate card. |
| FR-22 | Freeze exact model rates and validate pricing-relevant request fields, output limits and transport; disable hidden retries, auto-compaction, helper generation, and unsafe fallback. | R | Tests for altered model/effort/mode, retries/fallback, unguarded paths, and Pi actual payload behavior. |
| FR-23 | Settle only trustworthy terminal usage; keep unknown/aborted liability reserved as uncertain, including across restart; never treat missing data as zero. | R | Crash/disconnect/abort/malformed-usage/overshoot tests and restart ledger equality. |
| FR-24 | Fairly wait when reservations temporarily occupy funds; stop admission when a new request cannot fit the remaining budget. Agent count is independent of active streams. | R | Contention/refund/fairness/cancellation tests; no deadlock or false exhaustion solely from temporary reservations. |
| FR-25 | Provide `budget()` and show settled, reserved, uncertain, remaining and cap, clearly labeled as subscription USD-equivalent when appropriate. | D/U/R | UI/CLI/tool totals reconcile to exact ledger; labels never imply verified personal invoices. |
| FR-26 | Provide `done` with explicit `done_reasoning` and output, plus an explicit inability/bail path. Preserve terminal reasons and stop finished sessions. | D | Tool tests and real session traces show no further generation after terminal completion. |
| FR-27 | Distinguish completion, bailout, failure, cancelled, stalled, interrupted, and budget exhaustion. Failed/incomplete agents cannot produce a misleading successful swarm. | D/R | Aggregation truth table, timeout/manual stop, process cleanup, and UI status tests. |
| FR-28 | Keep completed runs inspectable; detect dead workers and retain uncertain spend without automatically replaying potentially billed work. | D/R | Restart tests preserve goals/messages/files/status/usage, and prove no new provider attempt is made automatically. |

### Dashboard side

| ID | Requirement | Evidence | Acceptance evidence |
|---|---|---|---|
| FR-29 | Match the demonstrated compact cream/paper, monospace, orange-accent dashboard with SWARMS / THREADS / AGENTS navigation and colored agent markers. | D/U | Real-browser screenshots compared to frames 0145/0290/0370/0660/1327/1583; document deliberate differences. |
| FR-30 | List running and completed swarms; show model/reasoning, elapsed time, agent count/status, tokens, calls, spend and budget bar. | D | Browser checks against the durable store while running and after completion. |
| FR-31 | Drill into thread goal/conversation and agent traces; search names/content; sort threads by activity/creation/volume/members and filter all/active/dormant. | D | Browser interactions with multiple threads, empty results, changing activity and chosen agent filter. |
| FR-32 | Provide a message/tool activity timeline, expandable full conversation/raw trace, and clear distinction between quiet messaging and stopped execution. | D | Deterministic timeline fixture plus real active run; expansion/filter preserve context. |
| FR-33 | Stream updates, recover after disconnect using event cursors, and retain usable navigation without browser-dependent worker state. | R | SSE reconnect/no-loss/cleanup tests plus browser reconnect and no duplicate displayed events. |
| FR-34 | Show current files, claims and history; download artifacts; preview active HTML/SVG on an isolated origin. | D/R | Browser download bytes match canonical version; preview attempts cannot read/control API or escape sandbox. |
| FR-35 | Provide deliberate launch and stop controls, optional operator messages, accessible forms, responsive layout, empty/error/offline states. | R | Keyboard/browser checks; form validation; stop confirmation in UI with recorded effect; no horizontal overflow. |
| FR-36 | Bind control service to loopback; reject foreign Host/Origin/CSRF and cross-site reads; render all agent text safely. | R | HTTP security matrix and malicious thread/name/artifact tests. |

### Acceptance challenges and delivery

| ID | Requirement | Evidence | Acceptance evidence |
|---|---|---|---|
| FR-37 | First run exactly 30 real `anthropic/claude-opus-4-8` High peers under a $50 aggregate cap, producing `pelican.svg`. | U | Immutable run receipt: all identities/session/provider activity, frozen settings, complete ledger, traces and artifact hash. |
| FR-38 | Pelican: one standalone hand-authored SVG, no raster/external assets, unmistakable bill/pouch/webbed feet/plump white-gray bird, actual riding contacts, complete spoked bicycle, coherent composition. | D | Chromium render, no external requests/errors, actual image inspection against every recovered criterion. |
| FR-39 | Pelican: rough complete canonical draft by approximately 15% budget, measured critiques at least twice, adversarial verification, and two independent signoffs on the same final hash with `verify/pelican.png`. | D | Artifact history/budget timeline and cited peer messages with numerical geometry evidence and final hashes. |
| FR-40 | After pelican, run exactly 30 real `openai-codex/gpt-5.5` High peers under a separate $50 cap, producing `hero.html` from the original OpenAI animation reference. | U/D | Separate immutable receipt, source reference evidence, actual sessions and final artifact hash. |
| FR-41 | Canvas uses real HTML canvas, black/grayscale particle motion with temporal resemblance to the original, not merely a similar still image. | D | Inspect DOM and render loop, compare reference/output frames over 22 seconds at 1 fps; inspect flow/speed/density and brightness stability. |
| FR-42 | Canvas runs without browser errors/external dependencies, survives resize/DPR changes and longer operation; preserve objective measurements and independent visual review. | R | Real Chromium checks for nonblank/moving frames, resizing, DPR1/2, sustained animation and reference comparison. |
| FR-43 | Publish independent source, MIT license, source/provenance notes, configuration reference, installation and operating guide, and reproducible tests. | U | Clean checkout installation and public repository verification, no private logs/credentials/reference media. |
| FR-44 | Audit every GitHub workflow; only pull_request triggers are allowed. Complete independent fixed-artifact review including budget/security before publication. | U/R | Workflow scan and review receipt identifying actual reviewer model and reviewed artifact. |
| FR-45 | Keep research in LearningVault through the native Obsidian CLI and keep this PRD/task list synchronized with verified work. | U | Updated topic overview/software notes and requirement-to-test/evidence links; no unchecked requirement silently omitted. |

## 6. Non-goals

- Recovering private source through unauthorized access or claiming this repository is IndyDevDan's original.
- A centralized planner assigning a fixed task graph to passive agents.
- Replacing either requested challenge with the separate ray-tracer demo, smaller swarms, different models, generated mock traces, or prebuilt answer artifacts.
- Requiring a second Mac, cloud deployment, paid new service subscription, or automatic purchase of credits.
- Giving model shell tools host credentials, unrestricted networking, or the operator's personal directories.
- Exposing the local control service to the internet by default or automatically retrying interrupted paid runs.
- Copying an observed stale LIVE indicator when the swarm is actually terminal.

## 7. Design and technical considerations

Use the original demo as the visual source. Preserve compact navigation, dense rows, thread/member badges, activity timeline, original prompt in conversation, and readable trace inspection. Added controls should fit that visual language. Mobile/responsive layout must retain access to all functions rather than compressing data into unreadable columns.

Adopted implementation: TypeScript/Bun, one SQLite state owner, independent web and worker processes, Pi native OAuth, and a Podman tool adapter. Module contracts and tradeoffs are in [ARCHITECTURE.md](../docs/ARCHITECTURE.md). These are implementation choices, not claimed original internals.

Money is stored as integer microdollars. Pi 0.84.1 Codex does not transmit `max_output_tokens`; its reservation therefore covers the full documented model output bound. Subscription accounting uses a conservative published USD-equivalent tariff. OAuth authentication readiness is not proof of a successful billed request. Both requested providers are now authenticated in Pi, but exact-model live challenge acceptance remains outstanding.

Each command gets a read-only snapshot copied into a bounded temporary container filesystem; only validated claim-protected changes can become canonical. Model/API credentials stay in the trusted worker. The preview origin cannot access the control service. Unknown liabilities survive crashes.

## 8. Success metrics

- 45 numbered requirements have linked tests or real evidence, with unresolved items explicitly open.
- Both ordered challenges record 30 distinct real Pi sessions and actual provider activity per session, exact requested models/High reasoning, and liability at or below each $50 cap.
- No claim bypass, cross-swarm state leak, credential exposure, successful host mutation, or duplicate uncertain paid replay in the relevant test suite.
- Dashboard state and costs reconcile with stored events before/after reconnect and process restart.
- Both generated artifacts satisfy their recovered task criteria through external verification, not agent self-report alone.
- A new checkout follows documentation to start web, worker, isolation check and an authorized run.

## 9. Validation and testing

Validation layers are complementary. Core public-interface tests prove transactions and lifecycle rules; sandbox tests exercise real containment; runtime tests exercise actual request admission and tool integration; HTTP/browser tests prove operator workflows; real acceptance runs prove the chosen models can collaborate to deliver the requested work. Passing one layer cannot substitute for another.

Every implementation task must list its PRD IDs and exact validation receipt. Tests must fail for the wrong behavior and may not be weakened to meet a schedule. Fault-injected provider responses are allowed for failure-path testing and must be clearly separate from the two genuine challenge runs. Record commands, dates, results, model identities, budget snapshots, hashes, screenshots and limitations in `docs/validation/` with sensitive data excluded.

## 10. Assumptions and open questions

1. **Exact canvas source/starting prompt:** frame1676 identifies [the original article hero](https://openai.com/index/hugging-face-incident-and-the-road-ahead/), correcting the earlier homepage description. Media asset URL and full starting prompt/DoD remain unrecovered; ask Taylor for a known link while investigating the transcript-selected section. Agent-reported dimensions/timing in frame 0660 are secondary evidence until the actual clip is inspected. Do not call an inferred prompt verbatim original.
2. **Original tool schemas:** visible names/capabilities are recovered; missing parameter details use documented public contracts. Behavior and fidelity matter more than inventing exact unpublished JSON.
3. **Price/account basis:** both OAuth logins may consume included subscriptions. The application cap is an explicitly labeled conservative token-value envelope, not a promise about a private billing invoice. All billable transport paths must remain inside it.
4. **Concurrency:** 30 genuine sessions need not mean 30 simultaneous HTTP streams or Chromium processes. Shared financial/resource limits may queue requests fairly; this cannot reduce the actual participating count.
5. **Completion correctness:** an agent calling done is evidence of its claim, not proof that visual criteria pass. Final operator-side validation remains mandatory.

## 11. Change log

- Revision 1: consolidated user settings, transcript and inspected screenshots; mapped each product side to explicit validation. Recorded existing code as drafts awaiting validation and left canvas reference recovery open.

- Revision 2: corrected canvas reference to the exact OpenAI article recovered from frame1676; media and full original prompt remain open. Rootless Podman connection was verified available without changing system defaults.
