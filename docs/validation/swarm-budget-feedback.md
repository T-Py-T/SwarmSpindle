# Budget feedback and artifact review validation

## Changes and original findings
Current-request context now distinguishes admitted work from another request waiting for capacity. Agents receive shared target remainder, exact available capacity, a wrap-up phase at 80% target consumption and remaining model turns. Closed target or uncertainty gates expose zero admissible new requests; the raw reservation-slot count remains separately labeled.

The probe grader now rejects fabricated cap and available balances. Two tests reproduced the previous false-positive behavior before the fix.

Artifact acceptance is stored separately from the original swarm body, ledger and trace. Reviews bind output path, revision, exact SHA256 and definition-of-done SHA256. Missing files cannot pass and stale reviews are hidden. Both overview and selected-swarm panels display criterion evidence separately from the run outcome.

The original Pelican produced a recognizable, renderable SVG, but its handlebar contact and hidden saddle critique remained unresolved, two final-hash signoffs were absent, and no peer completed. Original Canvas never published the expected HTML. These original runs now carry explicit failed artifact reviews; their spending history was not rewritten.

## Deterministic validation
- Initial targeted regression: 88 tests, 635 assertions, zero failures.
- Full regression: 262 tests, 2160 assertions, zero failures; actual installed Edge browser and Podman sandbox integration enabled.
- Type checking and dashboard build passed.
- Separate SVG and Canvas artifact verifier regression passed actual rendering, 22-second sampling, resize/DPR and 60-second stability checks; synthetic model evidence was correctly rejected. The report now distinguishes artifact mechanical checks from runtime/model provenance.
- Full regression made no paid inference calls. Original run-body SHA256 hashes matched before restart.

## Three live Claude retests
All three used two Claude Opus 4.8 High peers, a $1 working target and a $6 shared hard ceiling. Original Canvas references were copied, without substituting a previous generated output. The durable allocation claim remains consumed; no automatic retry occurred.

| Task | Run | Verified usage | Observed result |
| --- | --- | --- | --- |
| Budget | `59e3b040-4716-492c-b56d-5ebeb03bdc75` | $0.496620 | Completed; both peers cited two distinct, accurate budget observations and sensible actions. |
| Pelican | `1fa1a99d-8c81-45b9-81ae-c93f33acadf9` | $0.964470 | Renderable SVG; wing contact improved, saddle obscured, no published verification or final signoffs. |
| Canvas | `536a5551-5a31-494e-872d-e32ba754a955` | $0.897990 | Candidate rendered in temporary storage but no canonical HTML was published. |

Total verified usage was **$2.359080**, with no reservations or unresolved charges remaining. Pelican and Canvas stopped when remaining capacity could no longer cover the conservative $5.102400 next-request reservation. Canvas missed it by $0.000390. These were budget admission stops, not provider failures.

The budget awareness gate passed; the latest cited balance was only $0.152215, so it did not demonstrate live behavior near the target. Boundary behavior is covered by deterministic tests. The separate artifact review flags a minor prompt failure: its otherwise accurate report has 117 whitespace-separated words rather than fewer than 100. A passing awareness gate is not a claim of perfect artifact compliance.

### Corrections from the traces
Each shell call starts a disposable sandbox. Canvas wrote a draft into `/tmp`, assumed it survived into another call, then rebuilt it without publishing. Runtime and tool descriptions now explain this lifetime and require persistent work in the claimed canonical workspace. Prompts specify the available Node Playwright and Python CairoSVG/Pillow tools, an early canonical draft, actual image inspection, and shared verification bound to the final hash.

Pelican's first write exceeded the 4096-token response cap and was rejected as truncated. Larger challenges permit 16000 output tokens. Both artifact prompts require independent final reviews and explicit completion; Pelican also requires an exposed saddle edge.

Budget feedback now reports headroom before another conservative reservation becomes impossible. Wrap-up starts when at most 20% of the initial headroom remains, alongside target/turn warnings. Temporary reservations do not count as spending. Outstanding requests can consume headroom, so it is guidance, not a promised remaining allowance. A regression reproduces Canvas's pre-final $0.728520 balance and confirms the earlier warning. Financial admission rules and prices remain unchanged.

Targeted validation after these corrections: **56 tests, 430 assertions, zero failures**, plus type checking. This includes real Pi request payloads with intercepted provider responses, not paid inference.

## Larger Claude challenge results
Pelican and Canvas each receive two Claude Opus 4.8 High peers, a $40 working target within a $50 hard ceiling, 16000 output tokens, at most 60 turns per peer and 20 minutes per run. They should stop when verified work is complete rather than spend to the limit. The higher output cap carries a $5.40 conservative reservation.

`swarm-retest.ts launch-large` recomputes the awareness prerequisite from the stored observations and board messages, requires verified Claude responses from both peers and settled usage without uncertainty, and claims a separate one-shot allocation for the two artifact challenges. It does not reset the smaller batch. Export and external verification ran after each challenge.

Full regression before launch: **268 tests, 2222 assertions, zero failures**, including installed Edge and Podman integration. Type checking and build passed.

| Task | Run | Verified usage | Unresolved liability | Result |
| --- | --- | --- | --- | --- |
| Pelican | `18fc4b92-0761-4ee5-bd98-3141987238a4` | $6.118410 | $0 | Completed; external mechanical checks and operator artifact review passed. |
| Canvas | `58efd803-27b8-4033-8697-9aa1e5e7d52d` | $1.045850 | $5.400000 | Runtime failed; published HTML passes mechanical checks, but required agent verification and reviews are incomplete. |

Pelican published SVG revision 1, SHA256 `0bee4cb67643d2d8aa47ff82b3c01c1fe628e81d98150f31dc2bacd75f73dad7`, plus its rendered image and verification report. Both peers read the image, posted independent reviews of the same hash, and explicitly completed. The operator inspected the rendered contacts, exposed saddle, rider and bicycle. This is a passing two-peer challenge, not a retroactive pass for the original 30-peer run.

Canvas published HTML revision 1, SHA256 `155093a4f4d4515f23b4f537eb381bab032536b89f05c575afce135faab68d71`. The external browser verifier passed the artifact checks. The agents did not publish their required capture sequence/report or final reviews, so artifact acceptance remains failed.

### Why larger Canvas stopped
1. Weaver published the canonical draft at trace event 131.
2. Its next request reserved $5.40 at event 134, then hit `ECONNRESET` before an HTTP response. The request had been handed to transport; absence of a response cannot prove zero server usage.
3. Event 135 retained that reservation as unresolved liability. Event 137 records Weaver's transport failure.
4. Vega's already-dispatched request settled at event 138. The unresolved-usage gate prevented its next request, recorded by event 144.
5. Event 145 ended the swarm as failed. Neither peer voluntarily bailed, and the $50 ceiling was not exhausted.

The retained $5.40 is potential liability, not a confirmed bill. No retry or replacement allocation was made, and no historical liability was erased. The failure sequence exposed the need for a first-class diagnostics view instead of relying on manually reading the raw trace.

## Run insights

Select a swarm and open **Why it stopped** (or **Run insights** while active). The view separates agent decisions from runtime stops and shows each peer's recorded reason, exact available/settled/reserved/uncertain balances at the stop, the last tool result, and evidence event numbers. Its JSON download supports later analysis without exporting raw assistant text or image payloads.

New runs record safe `request_failed`, `agent_stop`, and shell `tool_result` metadata. Request records include known transport/HTTP categories, attempted turn, elapsed time and reservation identity when available. Shell outcomes include nonzero exits even when the framework reports `isError:false`, plus the number of published files. A command publishing zero files is a signal to inspect, not automatically a failure.

Historical runs are projected from existing events. Exact known runtime reasons and validated ledger replay establish older stop sources and snapshots; missing evidence stays unknown. A last successful response is not presented as the failed request's turn. These projections do not rewrite old traces or reconcile old liabilities.

The endpoint reads the history once per report, then limits analysis to 10000 events and 16 MiB of relevant payloads, with an explicit partial-history notice. Only the latest 100 issue summaries are displayed. The existing store still decodes a whole run for that single read; moving event storage into its own indexed table remains a potential improvement for very large runs. Optional diagnostic persistence cannot interrupt authoritative accounting or lifecycle operations.

Validation includes actual Pi sessions with intercepted HTTP 429, SSE rate-limit errors, connection resets, incomplete streams, admission rejection and turn limits; explicit done/bail decisions; shell exit 7 with successful tool delivery; concurrent settlement after a stop; safe metadata filtering; and authenticated HTTP access. The original missing-diagnostics HTTP test failed before implementation and passed afterward. A browser test verifies the real dialog on desktop and a 390px phone viewport, including hostile text escaping.

The full default suite passed **272 tests, 2097 assertions**; 36 opt-in browser/sandbox checks were excluded from that run. The targeted real browser diagnostics check passed separately. Subsequent targeted checks passed **63 tests, 462 assertions** after the single-read performance correction and reviewed-outcome label fix. Type checking and build passed. No new paid model requests were used for diagnostics testing.

The live dashboard projection was checked against Canvas's original ledger: Weaver stopped with $0.906055 settled, $5.40 reserved for Vega, and $5.40 unresolved; Vega later stopped with $1.045850 settled, zero reserved, and the same unresolved liability. The report finds 12 verified model responses, 30 tool calls, one tool failure and one shell call with no published files. [Actual dashboard screenshot](../images/why-it-stopped.png).
