# Swarm overview

## Purpose and goals
Make the SWARMS landing view the face of SwarmSpindle: show what is running, what needs review, what stopped, and why. Help the operator decide which conversation or output to inspect next without mistaking activity for success.

## User stories
- As an operator, I can distinguish a completed claim from a verified result.
- I can see budget stops, failures and voluntary bailouts without opening each trace.
- I can compare verified usage and retained liabilities across experiments, then open the relevant board.

## Requirements
1. The landing view shows totals for active/queued/stopping runs, completed claims awaiting review, and terminal incomplete runs. Cards filter the run list; All restores it. Search combines with the outcome filter.
2. Display canonical run status with a readable label and stored reason. Completed means “Completion claimed · review required”; no automatic verified-success badge exists without an acceptance record.
3. Show a separate “Working target reached” indicator when settled usage meets an optional target. Never infer the stop cause from that threshold or override completed/failed/cancelled status.
4. Budget exhaustion explains that capacity may remain but cannot fund another bounded request. Verified spend, reserved capacity, and uncertain liability remain distinct at run and overview levels. Totals describe separate run ledgers, not transferable money.
5. Each run card shows title, model, expected output path (not a claim the file exists), agent counts by status, token/tool activity, creation/start/end times, and an action opening its existing board. Agent counts must not imply task-completion percentage.
6. Existing 3-second refresh updates cards and totals. Filters survive refresh. Search and navigation remain usable on phone and desktop. Zero runs and zero matches have meaningful messages.
7. Existing detail pages also flag completion claims as unverified and expose the target threshold independently of canonical status.
8. Capture the real all-runs overview plus updated board/search screenshots. README leads with the overview and links deeper documentation.

## Design and architecture
Keep the current navy navigation, light canvas and blue/teal palette. Use responsive overview metrics, a separate spending strip, and readable run cards.

Chosen: a pure browser presentation model derives outcome groups and counters from the existing SwarmRecord contract; the overview renderer consumes it. Store and runtime keep ownership of status and budget. No persistence migration or extra artifact-content requests.

Alternative: add persisted acceptance reviews and automated task-specific validators now. Deferred because current records do not carry independent acceptance; arbitrary definitions of done require explicit verifier contracts. The UI must state this limitation rather than manufacture success.

## Non-goals
No paid runs, retries, budget resets, completion-percentage estimates, generic AI verifier, output-existence inference, or worker-death inference. Repository migration remains authorized and follows the existing backup/verify/delete order.

## Validation
Pure model cases cover every status, mixed agent states, empty totals, completed at target, failure at target, positive balance with budget exhaustion, separate liability sums, and input immutability. Edge cases cover totals, filtering/search, live refresh, drilldown, escaping, and mobile overflow. Existing browser tests remain intact. Typecheck/build and targeted suite pass before refreshing the live app.

## Assumptions and next questions
The operator was asked whether completion claims should remain separately labeled or require automated verification. Pending a different answer, this increment explicitly labels claims unverified. A later acceptance workflow should bind verdict, evidence, reviewer and timestamp to a specific artifact revision and definition of done; changing either invalidates the verdict.
