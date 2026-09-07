# Goal and delivery ledger

Status: active — implementation contracts adopted; first implementation wave.
Updated: 2026-09-07.

## Objective and authority

Deliver a complete, functioning public `simpleswarmsystem` repository that faithfully reconstructs the video’s demonstrated features. Run worker and web service on Taylor’s M4 Max MacBook, with real local isolation for agent commands. Use parallel bounded agents for implementation and review. User authorizes two ordered challenge runs, capped at $50 each: 30 Opus 4.8 High agents for pelican, then 30 GPT-5.5 High agents for canvas-from-video. Do not silently substitute models, lower counts, weaken tests, or call a mock run the final acceptance run.

Public repository creation/publishing is requested. Upstream repositories remain read-only. Every GitHub workflow must have pull_request as its only trigger. No workflow exists in this repository at initialization; audit again whenever workflows are added or changed and before delivery.

## Read first

- docs/research/video-requirements.md
- docs/research/public-sources.md
- This ledger and subsequently adopted architecture/contracts
- User’s Personal Codex Defaults in the parent conversation (research capture, upstream restriction, PR-only Actions)

## Completion contract

- [ ] Inspect transcript plus relevant video screenshots; resolve prompt/UI/tool evidence gaps and retain timestamped requirements.
- [ ] Implement real Pi peer sessions, web service, worker, live dashboard, CLI, configuration and installation.
- [ ] Require definition of done; enforce names/mailboxes/threads, team discovery, budget queries, claim/release, read/write/bash, history/restore, done and bail.
- [ ] Enforce aggregate request reservations and reconciliation; unknown billing information cannot be zero; prove no shell claim bypass.
- [ ] Verify Podman isolation, shutdown, no unrelated host-file access, no host credentials exposed to shell commands, and bounded network access.
- [ ] Verify real browser workflows, streaming/reconnection, persistence, errors, timeouts/cancellation, final output access and status accuracy.
- [ ] Run 30 actual Opus 4.8 High agents on recovered pelican criteria under $50; retain identity/count/cost/trace evidence and render/review the SVG artifact.
- [ ] Subsequently run 30 actual GPT-5.5 High agents on recovered canvas-from-video criteria under a separate $50; retain identity/count/cost/trace evidence, real canvas DOM, temporal captures, and reference comparison.
- [ ] Complete independent fixed-artifact review, security/budget review, relevant tests/type checks/build, installation check, licensing/provenance, public publishing and clean handoff.
- [ ] Capture research in LearningVault/4-Research/Codex/Simple Swarm System via native Obsidian CLI.

A successful test at one seam never proves unrelated requirements. Do not delete, skip, weaken, or narrow tests to satisfy this contract. Any unavailable required model or absent authentication remains an open requirement while independent implementation proceeds.

## Current evidence

- Pi 0.84.1 installed. Native openai-codex/gpt-5.6-luna passed an actual no-tool request. GPT-5.5 is in the catalog but not yet live-tested here.
- Pi Anthropic credentials absent; Claude CLI reports logged out. Cursor CLI is authenticated and advertises claude-opus-4-8-high; its raw bridge costs are not yet trustworthy for a hard dollar cap. No Opus challenge launched.
- Podman machine is running locally, libkrun, 8 CPUs, about 20 GB memory. No tool-isolation test yet. Docker’s default Colima socket is unavailable.
- Pi confirmed by demo narration at 6:31–6:37 and 31:03–31:08.
- Presenter states at 36:55–37:31 that original will not be open-source in the foreseeable future. No matching repository in author’s 53-public-repo inventory.
- Video at 5:52 visually shows the pelican requirement as one self-contained SVG, final_output_file pelican.svg. Larger frames still needed for complete criteria.
- Full transcript privately retained outside this repository at ../.research-staging/simple-swarm-video/transcript.txt.
- Video download is a durable goal process: job-mtrpn4vg-2cd79a26. Do not restart due to observation timeout. On later continuation use Codex Process Jobs result/status skills and validated job state.

## Risk and ownership

Risk: high, security-sensitive. Triggers: real money caps, concurrent shared-file mutation, process execution on daily-use Mac, authentication, durable state and cancellation. Main agent owns the only implementation checkout writer lease. Research agents have only dedicated staging-file write authority. Implementation leases will be granted after contracts are adopted; review requires a fixed artifact and a demonstrably different model family before publication.

Routing scan: 2026-09-07T20:43:00Z. Main Codex session remains primary; configured CLI role fallbacks are not a reason to abandon it. Independent review routes exist through Cursor/OMP and must verify actual returned model identity.

## Research receipts

- demo_requirements: completed timestamped behavior and validation mapping; screenshots outstanding.
- public_swarm_sources: completed source inventory, verified MIT candidates, contracts and reuse limitations.
- runtime_architecture: two designs and budget/sandbox contract analysis in progress.

## Updated verification

Video download completed with exit 0; file verified and 20 timestamped 1080p frames extracted. Detailed screenshots confirm pelican.svg, measured render critiques, two final signoffs, explicit done_reasoning, and the file_diff tool. Native Anthropic OAuth is now present and ready, with claude-opus-4-8 in the available catalog; this supersedes the earlier missing-auth observation. No billable challenge request has been made. Architecture candidate A is adopted in docs/ARCHITECTURE.md, with isolated command snapshots and atomic claim-protected publication.

## Next steps

Read the video download’s terminal result in a later continuation, extract/read key frames, adopt a runtime design, scaffold a narrow end-to-end Pi-backed slice with public-interface tests, then expand along the full requirements matrix. Resolve Anthropic/Cursor Opus authentication and authoritative spend accounting before the pelican run. Do not wait for that dependency before implementing independent system features.
