# Simple Swarm System — transcript requirements draft

Source: https://www.youtube.com/watch?v=S2sjyokoxeE (auto-generated English captions exported locally). Analysis date: 2026-09-07. This is a behavioral reconstruction, not recovered original source. Screenshots must resolve the missing prompt text, exact tool names/schemas, and visual design before calling requirements complete.

## Research question and scope

What observable behaviors must a public, working recreation of IndyDevDan's Simple Swarm System provide, using Pi and running worker plus web service on the same M4 Max MacBook?

The transcript **explicitly confirms Pi**, rather than merely suggesting it: custom Pi coding agent/harness at 6:31–6:37, and Pi harness recommendation at 31:03–31:08. At 36:55–37:31 the presenter explicitly says he will not open-source this system for the foreseeable future. Related public repositories can inform integration patterns but cannot be represented as the original source.

**User overrides the demonstrated run settings:** first run the pelican challenge with **30 agents, Opus 4.8, High reasoning, aggregate $50 cap**; then run the canvas-from-video challenge with **30 agents, GPT-5.5, High reasoning, aggregate $50 cap**. Verify the actual provider/model identities and accepted reasoning settings; do not silently substitute a model or smaller swarm. The user's two challenges do not refer to the video's separate ray-tracer challenge.

Evidence labels below: **D** = directly described or narrated during demonstration; **R** = presenter states a design requirement/recommendation but no implementation proof; **I** = reconstruction decision/inference requiring implementation and tests; **U** = unresolved from transcript, inspect screenshots.

## Observable requirements

### Launching, execution, and deployment

| ID | Evidence / timestamp | Requirement |
|---|---|---|
| RUN-01 | D 1:56–2:15 | Start a swarm from a terminal/Herder workflow using a prompt, selected model, agent count, and maximum spend. The hello-world run uses one agent called scout and a $0.10 cap. Exact invocation syntax is U. |
| RUN-02 | D 3:42–4:43 | Multiple swarms can run concurrently and appear independently in one UI, each with its own task, model, agent count, and spend limit. |
| RUN-03 | D 1:56–2:22, 4:34–4:40 | Worker execution and browser viewing are separable: demonstration worker runs on an M4 Mini while another Mac views a UI over LAN. User requires both worker and connecting web service on one M4 Max; a separate machine cannot be an installation prerequisite. |
| RUN-04 | D 6:31–6:37, 31:03–31:08 | Pi is the execution harness and its tools/system prompt are customized for the swarm. |
| RUN-05 | D 5:47–6:29 | Every swarm has a persisted starting goal/user prompt with a clear objective and validation steps. |
| RUN-06 | D 6:29–7:08, 29:29–31:08 | The harness refuses to run without a definition of done. Agents receive criteria for success and a way to stop if success cannot be reached. |
| RUN-07 | D 5:23–5:45, 19:47–20:16, 25:40–25:55 | Agents act as peers in a largely unstructured communication network. They choose/deconflict work through messaging and tools. A leader assigning a fixed DAG to passive subagents would not reproduce the demonstrated behavior. Shared prompts and guardrails still guide them. |

### Domain model and UI

| ID | Evidence / timestamp | Requirement |
|---|---|---|
| UI-01 | D 2:22–2:59, 5:37–5:40 | Browse the three visible levels: swarms, messaging threads, and agents. An agent can participate in threads; do not infer exclusive thread ownership from the verbal hierarchy. |
| UI-02 | D 2:35–2:41, 5:47–6:29 | Show the initial goal/prompt and conversation in the thread. |
| UI-03 | D 4:55–5:01, 5:58–6:03, 9:09–9:16 | Display live progress/metrics: agents, cumulative token usage, tool calls, spend, and elapsed run duration. |
| UI-04 | D 7:34–7:45, 11:16–11:34, 13:39–14:35 | Provide full/raw traces showing agent messages, thinking when supplied by the provider, tool calls, and tool results. Inspect individual steps without losing the swarm context. |
| UI-05 | D 13:53–14:04 | Search/find an agent by name (example: Stitch) and filter/drill into that agent's specific calls. |
| UI-06 | D 10:33–10:58 | Conversation has a “show all” expansion to expose otherwise hidden/background activity. Exact behavior and which rows are collapsed are U. |
| UI-07 | D 15:04–15:24 | Display multiple agent-created threads, including abandoned ones. Thread presentation darkens when there has been no recent messaging activity; inactivity must not imply the whole swarm stopped. |
| UI-08 | D 21:55–22:14 | Show a timeline of messaging events; communication gaps and bursts are visible. |
| UI-09 | D 22:26–22:53 | Distinguish inactive/killed/stalled agents from active agents. The demonstrated UI uses question-mark indicators for agents shut down after inactivity/timeouts. Exact state names and icons are U. |
| UI-10 | D 26:00–26:36 | Distinguish agents that explicitly finish (check marks), session-end events, and final swarm completion. Display final spend, tokens, call count, and duration. |
| UI-11 | D 26:39–27:29 | Completed swarms remain inspectable alongside running swarms. |

Minimum inferred entities (**I**, do not claim original storage design): `Swarm` (goal, DoD, model/provider/reasoning, count, limit, lifecycle, aggregate usage); `Agent` (stable identity, chosen display name, session and lifecycle, usage); `Thread` (swarm, name/topic, activity, participants); `Message` (thread, author, timestamp, ordered ID); `TraceEvent` (agent, session, type, call/result correlation); `FileClaim` (normalized path, owner, acquired/released state); `FileVersion` (path, author, recoverable content); `Completion` (agent, reason, output paths); `BudgetLedger` (usage, charges/reservations); `Artifact` (output and verification evidence). Use the simplest persistence that supports the behavior; transcript does not establish SQLite, JSONL, HTTP routes, ports, polling versus streaming, frontend framework, or process topology.

### Communication and coordination tools

| ID | Evidence / timestamp | Requirement |
|---|---|---|
| COM-01 | D 5:30–5:45, 19:47–20:16 | Every swarm provides an agent-accessible shared mailbox/message-thread system. |
| COM-02 | D 7:22–8:33 | Agents introduce themselves, choose names, announce intent/work claims, discuss collisions, drop overlapping work, critique, and coordinate through messages. Names are agent-selected, not exclusively preassigned. |
| COM-03 | D 11:35–11:46 | A team-listing tool lets each agent see the others and what is happening. Exact returned fields are U. |
| COM-04 | D 11:48–12:08, 23:17–24:14 | A posting tool broadcasts findings into a thread; an inbox tool returns new messages from that agent's perspective, including an explicit no-new-messages result. Agents can repeatedly check for updates. |
| COM-05 | D 15:04–15:24 | Agents can create additional threads and other agents can join them. Joining and membership semantics are U. |
| COM-06 | D 11:56–12:27, 15:34–16:13, 24:00–24:47, 29:03–29:24 | Support repeated independent verification, concrete critiques, evidence-sharing, canonical output selection, and peer signoff through the shared conversation. These emerge from prompts and peer behavior; no hard-coded fixed reviewer roles are established. |

Spoken tool labels visible/mentioned in trace: **read, bash, post, inbox, list team, check budget, claim file, release file, file history, file restore, done**, and “batch calls.” Preserve this capability set; do not treat spacing/case as exact API spellings. “Full view” at 7:40 could be a UI control rather than a tool. **Write** is behaviorally present at 15:30–15:32, but the exact write/edit tool schema needs screenshot verification.

### Shared filesystem and recovery

| ID | Evidence / timestamp | Requirement |
|---|---|---|
| FILE-01 | D 13:10–13:21, 14:04–14:23 | Agents acquire exclusive claims on files before modifying them and release files afterward. Other agents attempting to modify an owned file encounter claim violations. Shared canonical files are supported. |
| FILE-02 | D 7:40–7:45, 14:02–14:07 | Tools include file history and file restore. Transcript does not show a successful restore or establish version ID semantics; verify from screenshots or implement and test a clearly documented reconstruction. |
| FILE-03 | D 15:30–15:32 | Agents can execute coding work and write output within the worker sandbox. |
| FILE-04 | I from FILE-01 and concurrent run goal | File-claim acquisition must be atomic under 30 peers; claims must not be bypassable by alternate normalized paths or stale ownership checks. Decide and test stale-owner cleanup after a killed agent. |
| FILE-05 | I from FILE-01 | Claimed-file protection needs to cover every supported mutation route, including shell commands, or the lock is advisory only. An implementation that protects one write tool but lets unrestricted shell overwrite canonical files does not substantiate an enforced claim invariant. |

Do not claim demonstrated automatic restart, checkpoint replay, idempotent message delivery, database crash recovery, cross-machine reconnection, claim leases, or automatic agent replacement: none are established by the transcript. They are reasonable reliability additions and must be labeled as reconstruction features.

### Budgeting, stopping, and failures

| ID | Evidence / timestamp | Requirement |
|---|---|---|
| BUD-01 | D 2:06–2:11, 3:42–4:14 | Configure a maximum token-spend amount per swarm. User's limit is $50 per challenge, not $50 per agent. |
| BUD-02 | D 11:40–11:46, 12:29–12:34, 23:17–23:24 | Agents can query remaining collective budget while working. UI shows aggregate spend and usage. |
| BUD-03 | D 25:03–25:07, 26:26–26:36 | Stop when done even if substantial budget remains. The cap is not a target to consume. |
| BUD-04 | U / I | The demo does not reach its cap and therefore does not prove hard-stop enforcement. Recreated system must prove aggregate concurrency-safe cap enforcement for the user's runs, using authoritative cost data and conservative reservations for in-flight requests. Unknown price/usage cannot be silently treated as zero. Subscription usage and dollar-equivalent estimates need explicit labeling. |
| STOP-01 | D 26:00–26:26 | An agent calls a dedicated done tool with a reason and output file, then its session ends. The swarm can finish when its agents have reached terminal states. Exact quorum/failure aggregation rules are U. |
| STOP-02 | D/R 6:35–7:03, 29:35–30:59 | Agents must have a way to report inability to complete and stop; this is distinct from claiming success. The bailout tool/schema is not named. |
| STOP-03 | D 22:26–22:53 | Agents that stall, become inactive, or time out are shut down and shown as such. Presenter calls this an area needing improvement; do not copy the ambiguity into the new status model. |
| STOP-04 | R 20:50–21:14, 21:32–21:51 | Guardrails should have observable failure conditions and active consequences. Severe failure must be able to stop the sandbox/workload. |
| STOP-05 | I | User/manual cancellation, service restart recovery, timeout cleanup, and killing descendant processes need explicit behavior and tests for unattended use, though exact implementation is not demonstrated. |

### Sandboxing

The video executes on a dedicated Mac Mini and discusses disposable Linux sandboxes as another option (16:47–18:03). It recommends isolation, network control, and shutting down a sandbox on serious failure (20:50–21:51, 33:29–33:41). A separate physical Mac is not the user's available boundary. Worker-on-this-Mac must have a demonstrable sandbox boundary appropriate to local execution; a directory name alone is not sandboxing. Allow the task's legitimate model requests, website/reference acquisition, browser tests, and artifact writes while verifying the worker cannot mutate unrelated host data or steal other agents' credentials. These last controls are **I** from the same-machine deployment requirement, not proof of the presenter's exact mechanism.

## Challenge expectations

### Pelican

- **D 3:42–3:55, 5:47–5:58:** Create the “perfect pelican” riding a bicycle.
- **D 6:25–7:20:** Prompt includes detailed criteria, validation steps, and an explicit DoD; presenter says it is richer than the classic short pelican prompt. **The exact prompt text is not spoken. Recover from video frames; do not invent and call it exact.**
- **D 15:34–16:13, 24:00–24:47, 29:03–29:24:** Repeated independent/adversarial critiques, measurement, revision, and signoff on one canonical asset. Some messages reference versions and a frozen/canonical version.
- **D 28:38–29:03:** Final displayed output is recognizably a pelican on a bicycle and is regarded as a good result. **Output file extension, dimensions, exact required composition/anatomy, and objective geometry checks are U**. The transcript alone does not establish SVG as the required format.
- **User:** exactly 30 Opus 4.8 High agents, aggregate cap $50. Capture selected model identity/reasoning and actual launched agent count in durable run evidence.
- Accepting a text response, placeholder image, or mock trace is insufficient. Inspect/render the actual produced asset, compare to recovered prompt criteria, preserve critiques and independent verification evidence, and report the actual final cost and agent terminal states.

### Canvas from video

- **D 4:07–4:31, 9:39–9:48:** Recreate the HTML canvas animation on the OpenAI landing page by inspecting the original reference. Site-access guards were anticipated. Exact original URL and any fallback reference in the launch prompt are U.
- **D 11:56–12:27:** Agents perform Playwright testing and a **22-second, 1-fps capture** to find temporal defects (an agent reports population-brightness collapse). This is observed agent behavior, not proven literal original acceptance wording.
- **D 27:42–28:11:** Presenter compares recreation with original and explicitly inspects the DOM to verify an actual **HTML5 canvas**, not an SVG stand-in. The original is described as slow-moving and flowy; recreation is less so. Temporal motion fidelity matters, not only a static screenshot.
- **U:** Exact canvas prompt, reference asset/download strategy, camera/motion phases, palette, density, speed, dimensions, responsiveness, interactions, and acceptance thresholds require video screenshot inspection.
- **User:** exactly 30 GPT-5.5 High agents, aggregate cap $50, after pelican challenge.
- Verify real canvas DOM/drawing, browser execution without errors, visible nontrivial animation over time, reproducible captures, and comparison to the actual reference. Preserve representative frames and temporal validation findings rather than only final model statements.

### Distinct ray-tracer demo (not the user's second challenge)

At 3:55–4:05 the presenter launches a 20-agent DeepSeek V4 Pro swarm with $40 for an HTML5-canvas ray tracer. At 28:11–28:36 its result supports a camera/zoom, 3D lighting, multiple renders, and visible reflections. File claim/deadlock examples come from this swarm and inform the common system. Do not accidentally replace the user's canvas-from-video challenge with this task.

## Screenshot inspection queue

1. **2:02–2:15:** Single-agent launch command, full hello-world prompt, budget/model argument syntax.
2. **2:18–2:59:** Initial dashboard layout, hierarchy labels, navigation, trace view, scout message and goal.
3. **3:42–4:34:** All three launch commands/prompts, paths and DoD syntax; prioritize pelican and canvas-from-video.
4. **4:36–5:01:** Multi-swarm dashboard cards/table, live counts/status, 10-agent layout.
5. **5:47–7:20:** Full pelican starting goal and explicit DoD (may require several consecutive frames as he scrolls). This is the highest-priority unresolved requirement.
6. **7:22–8:33:** Agent naming, exact messaging tool schemas, work claims/deconfliction, thread structure.
7. **10:21–12:34:** Canvas goal if visible; “show all”; raw trace, list-team/budget/inbox/post fields; 22-second capture report and source specs.
8. **13:10–14:23:** Claim violation, exact file-claim/release calls/results, file history fields, agent search/filter UI.
9. **15:04–15:44:** Extra thread creation/join display, inactive thread styling, critique content.
10. **21:55–22:53:** Messaging timeline, killed-agent/question-mark indicators.
11. **23:17–24:47:** Budget/inbox calls, independent verification/signoff evidence, canonical version references.
12. **26:00–26:36:** Done tool parameters/results, per-agent session end and swarm completion indicators.
13. **26:39–27:29:** Completed-versus-running swarm layout, retained metrics.
14. **27:42–28:11:** Original canvas versus recreation side by side; inspect palette, structure, motion, DOM canvas; capture separated temporal frames.
15. **28:38–29:24:** Final pelican and validation thread; recover output path/extension if visible, compare shape/detail to requirements.

## Completion evidence map

The reconstruction should ship with a requirement-to-test table. Meaningful coverage includes:

- Launch validation: missing/empty DoD, invalid model/reasoning, zero/invalid count or cap, and correct propagation of user settings to every Pi session.
- Real 30-peer execution with all 30 unique sessions demonstrated, not 30 database rows driven by one model call.
- Peer communication: independent agents post/read messages, incremental inbox semantics, no cross-swarm leakage, thread creation/join, peer discovery and self-naming.
- True unstructured coordination: traces show agents announcing work, reacting to another agent, revising/deconflicting, and verifying shared outputs.
- File safety: 30-way claim race, owner-only release, normalized-path conflicts, unclaimed/conflicting mutation denial, successful owner write, release then next-owner write, history retrieval and restore, killed-owner handling.
- Aggregate dollar cap: concurrent request reservations, actual usage reconciliation, requests rejected when remaining cap cannot cover them, terminal stop behavior, unknown price/usage, and cancellation of in-flight work. No overspend claims from mock-only ledger checks.
- Lifecycle: explicit done persists reason/output, failed/impossible/stalled cases never become success, runtime/session cleanup, UI remains accurate when messaging is quiet but work continues.
- Persistence/recovery: service interruption and restart with live worker identity checked, terminal history/metrics preserved, no duplicate expensive replays. This is an added reliability requirement rather than a demonstrated video feature.
- UI integration: list/drilldown, initial goal, real-time event/usage updates, search/filter, message timeline, terminal statuses, historical completed runs and artifact access.
- Sandbox: verify actual prohibited filesystem/network/process capabilities, legitimate task browser/model access, and stopped descendant workloads.
- Pelican and canvas: two real capped model runs with specified exact settings, produced usable artifacts, visual browser/render verification, original criteria checked, and preserved evidence/cost reports.

## Pros, cons, assumptions, and open questions

**Pros supported by demo:** peer messaging permits flexible division of work; multiple independent reviewers surface defects; trace visibility makes coordination inspectable; shared budget and explicit done allow early completion; file claims enable shared canonical outputs.

**Cons supported by demo:** initialization/coordination burns tokens; many agents initially duplicate work; coordination can deadlock; threads can be abandoned; some agents stall; more agents do not guarantee fidelity (canvas motion diverges); sandbox and cost enforcement need substantial harness engineering.

**Assumptions to label:** same-machine separation can retain the worker/web-service model; robust storage and cleanup mechanics may be chosen independently; screenshot gaps can be filled only with openly documented reconstruction decisions after extracting available evidence.

**Open questions:** exact launch prompts and DoD; exact tools and their schemas; format/output locations; model/pricing/authentication availability for the requested runs; how a hard cap accounts for in-flight requests; original claim enforcement across shell writes; original persistence/restart semantics; original UI component/layout details; actual original reference canvas URL/asset and whether still publicly accessible.

## Screenshot addendum — verified frame evidence

Inspected original extracted PNG frames in `.research-staging/simple-swarm-video/frames/`. Frame filenames are seconds from the video, zero-padded. This addendum resolves/corrects earlier transcript-only uncertainties. Prompt criteria below are paraphrased rather than a transcription of the presenter's prose.

### Pelican requirements now recovered

Frames **0350, 0434, 0390, 0410** collectively show the goal, objective, quality criteria, method, validation, suggested work division, budget guidance, and complete DoD.

**Deliverable:** one hand-authored, self-contained `pelican.svg` at `final_output_file`, rendering directly in a browser. No raster images, external assets, or libraries. Valid standalone SVG, and zero external requests. Final visual inspection in **1730** confirms an SVG file was opened directly in Chrome.

**Recognizable subject:** long bill with conspicuous throat pouch below it; webbed feet; rounded/plump body; white/gray plumage. Pelican identity must survive adversarial visual scrutiny rather than merely a textual label or SVG element name.

**Actual riding posture:** wings contact handlebars, body sits over saddle, feet contact pedals, and supporting bicycle geometry is plausible. Bird must not merely float near the bike.

**Recognizable bicycle:** two spoked wheels, triangular frame structure, chain, handlebars, saddle, and pedals.

**Craft:** deliberate composition and coherent palette, correct layering, and ground line or contextual scene hint. Style is left to the swarm, with consistent execution expected.

**Method guidance:** use grouped SVG elements for editable anatomy/bike components; render in Chromium through Playwright; inspect pixels/geometry with Python/PIL. Assess bounding boxes, color regions, wheel symmetry, pouch/bill position, and feet-versus-pedal positions. Iterate through render, measurement, shared defect report with coordinates, and correction in short cycles.

**Validation obligations:**

1. After meaningful changes, render headlessly and save `verify/pelican.png`; ensure a nonblank result and no Chromium console errors.
2. Post at least two measured critiques during the mission. Include numerical/coordinate evidence for wheel circularity and relative size, pelican/saddle alignment, bill/pouch presence, and wing/handlebar contact.
3. At least one verification must try to disprove correctness, report what was challenged, and state what the pixels demonstrated.
4. Obtain two independent signoffs on the final SVG with rendered evidence in `verify/`, including an adversarial signoff, then stop repeating verification.
5. Keep authorship/contributions and measured critiques in thread history.
6. Remove stray candidate files from the shared workspace's top level before `done()`.

**Coordination guidance:** suggested independent areas include bicycle geometry, pelican anatomy, composition/palette/scene, render/measurement tooling, assembly/canonicalization, and skeptical verification. Agents select unclaimed work themselves. A rough but complete canonical drawing must exist within about the first **15% of the shared budget**, followed by in-place improvement. Post discoveries and failed attempts early; do not leave canonical output empty while privately refining candidates. Check `budget()` and converge before funds are low. These are directly recovered task requirements/guidance, not assumptions.

The example final image in **1730** is a flat illustrated white pelican with a large orange bill/pouch, gray shading, red bicycle, spoked black wheels, brown legs, cream scene, yellow sun, ground line and motion accents. **This specific palette/composition is an output example, not a required exact target**, since the recovered prompt leaves style open.

### Canvas evidence now recovered (full starting prompt remains unresolved)

Frame **0260** reveals exact invocation structure:

```text
just swarm 30 gemini37-flash 30 prompts/demo/USER_PROMPT_CANVAS_FROM_VIDEO.md
```

This establishes `just swarm <count> <model-alias> <dollar-limit> <prompt-file>` as the demonstrated launch interface. Frame **0246** independently confirms this order for the separate ray tracer (`20`, `dsv4-pro`, `40`, `prompts/demo/USER_PROMPT_RAYTACER.md`; the visible filename is spelled RAYTACER). These are demo aliases, not the user's required live models.

Frame **0660** shows agents expecting the canonical file at **`shared/hero.html`**, and a quantitative analysis posted by agent `drift`. This is **a demonstrated agent report, not independently verified ground truth or the starting prompt**:

- Reference video measured at **1600×892**, **25 fps**, **20.0 seconds / 500 frames**.
- Black background (`#000000`), grayscale white particle cores with dim gray antialiasing/trails, no colored hues.
- Reported active particle population approximately **8,000–12,000**, soft antialiased disks/point sprites; median particle area roughly 7 pixels; radii roughly 0.8–1.8 pixels.
- Reported mass center approximately `(0.488 W, 0.473 H)`, spread approximately `(0.178 W, 0.157 H)`.
- Reported average particle velocity around **45–50 px/s**, median approximately 30 px/s and 90th percentile approximately 125 px/s at the reference resolution.
- Agent interprets motion as toroidal/elliptical 3D circulation perturbed by multiscale curl/simplex noise. This **is an agent hypothesis about implementation**, not proof of the original's algorithm.
- Task scope is described by the agent as the particle murmuration only, on a full-screen black field; reference headline/buttons/site UI are static surrounding UI and should not be drawn into the deliverable canvas.

The same frame shows verifier agents planning **1-fps Playwright frame differences**, perceptual/MSE/SSIM comparisons against reference frames, DPR/resize tests, delta-time and 30/60/120-Hz consistency, long-run memory/particle stability, and absence of external dependencies. These are useful fidelity checks and observed workflow, but exact original prompt thresholds are not yet recovered.

Frame **1680** shows the finished HTML animation as bright white particle ribbons/loops/murmuration against black in Chrome, with the final output file named `hero-gemini37flash.html` in a `tmp/demo/` export directory. The visible inspector is open, but this particular frame does not show a readable canvas element; actual canvas use is explicitly stated in the transcript at 27:58–28:11. Capture a nearby inspector frame to prove the DOM visually if needed. The local exported filename is not the canonical required output filename; canonical `shared/hero.html` is shown in the agents' report.

### Exact tool identifiers and schema fragments

Frame **0462** resolves these exact trace labels:

| Tool/event | Visible argument fields or behavior |
|---|---|
| `bash` | `command`; frame1566 also shows `timeout` |
| `file_history` | `path` |
| `read` | `path` |
| `file_restore` | `path`, `reason`; remainder is clipped |
| `file_diff` | `from`, `path`, `to`; revisions look like abbreviated hashes |
| `inbox` | empty object shown |
| `edit` | `edits` array with `newText` visible; other fields clipped |
| `post` | `body`, with destination rendered as `#mission`; remaining schema not visible |
| `thinking` | event containing thinking text, not itself evidence of a callable tool |

Frame **0835** additionally confirms exact `write` trace label with a `content` field fragment. Frame **1566** confirms exact `budget` (empty object shown), `done` with **`done_reasoning`**, and `session end` event. Done-call text discusses the canonical file and its hash; a separate output-file argument is not visible in this frame. Do not invent exact `done` schema beyond the field observed.

**New required capability:** `file_diff` was missing from transcript's spoken enumeration and must be included in the reconstruction's tool coverage.

**Important correction to claim interpretation:** Frame **0835** shows a system warning saying one agent's **bash call modified `raytracer.html` while another agent held a live claim**. This proves detection/reporting of shell claim violations; it does **not** prove preventative denial. The recreation should implement/test its chosen policy clearly. If it enforces stronger prevention, describe this as a reliability improvement, not behavior already proven by the original. The transcript-only FILE-01 claim of encountering violations remains valid; preventative enforcement remains inferred.

### UI design and interaction details now observed

Frames **0145, 0290, 0370, 0462, 1327, 1566, 1583** establish:

- Warm cream/paper background, thin muted separators, rust/orange accent, nearly black condensed uppercase headings, monospaced dense data/body text, restrained green live/done badges, per-agent colors. Small network/node logo next to the product title.
- Main top navigation: **SWARMS / THREADS / AGENTS**, with the selected tab emphasized and underlined in rust. Breadcrumb beneath shows swarm and view.
- Search field placeholder **“find a signal… ( / )”** indicates a slash shortcut affordance; actual keyboard behavior still needs implementation/test if copied.
- Top-right telemetry: elapsed time, agent count, live indicator, actual swarm model name, four-decimal dollar cost, token/call totals, budget progress bar, remaining versus maximum spend.
- Swarm list rows show live state, timestamp, name, model chip, agent/thread/message/call/token totals, cost relative to cap, and duration.
- Threads have sort choices **ACTIVITY / CREATED / VOLUME / MEMBERS**, and state filter **ALL / ACTIVE / DORMANT**. A primary-thread badge distinguishes the mission thread.
- Thread rows contain colored agent chips with per-agent numeric counters, activity dots/lines, message total at right, and a latest-message preview. Exact meaning of each chip counter is not proven in the screenshots.
- Thread detail opens as a large cream modal over a dimmed dashboard. Messages have timestamps, colored author name and left border, collapse/expand affordance, and character count while collapsed. Starting goal has a distinct badge and rendered headings. **LATEST** button moves to recent content (direction appears upward because newest messages are above the goal); confirm ordering in implementation.
- Raw trace page lists a total event count, **ALL** and per-agent filter chips containing count and spend, and rows with timestamp, agent, colored tool/event label, argument summary, and duration in milliseconds. Event totals are distinct from tool-call totals.
- Persistent bottom activity strip shows time range, message/tool-call totals, and dense colored activity marks/bars.
- Frame **1583** shows primary thread **DONE**, eight checkmarked agents, and two question-mark agents, while top-right still says **LIVE**. Therefore original UI may retain a running run/supervisor indicator after task completion; do not copy misleading lifecycle aggregation. Distinguish worker/service liveness from task outcome in the reconstruction.
- Visible routes include `/missions?run=...`, `/threads?run=...`, `/threads/12?run=...`, and `/trace?run=...`, served on port **5178**. These establish original URLs, not a requirement to preserve framework or storage internals.

### Remaining evidence gaps and targeted next frames

**Resolved:** Pi foundation; pelican output format and full visible criteria/DoD; major UI visual structure and sort/filter controls; positional launch interface; canvas canonical output filename and agent-reported quantitative reference; `file_diff` and several exact tool/schema fragments; done reasoning field; shell claim violation detection.

**Still unresolved:** full canvas starting prompt and its literal DoD; reference asset URL/download path; independent validation of agent-reported video measurements; `claim_file`/release, team-listing, thread-create/join exact tool identifiers/schemas; restore revision selection schema; complete done schema; original hard-cap and crash-recovery mechanism; precise private/shared workspace access policy.

Suggested additional extraction: **630–655 seconds** to see whether canvas goal appears as he scrolls/expands; **840–863 seconds** for claim/release call details; **126–134 seconds** for hello-world command; **225–235 seconds** for pelican launch alias/path; **1682–1690 seconds** for readable canvas DOM. If canvas goal never appears in the recording, explicitly call that remaining prompt reconstruction an inference instead of claiming recovered source.
