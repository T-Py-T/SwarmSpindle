# Reading the swarm overview

The SWARMS landing page groups experiments by what the runtime recorded:

- **Active:** queued, running, or stopping. Running can include setup and waiting for request capacity.
- **Review required:** every peer reported completion. This is a completion claim, not independently verified success.
- **Stopped incomplete:** budget exhaustion, bailout, failure, interruption, or cancellation. Each card keeps its specific outcome and recorded reason visible.

Outcome buttons filter the list; text search applies within that group. Totals always describe all saved runs. The page refreshes automatically, and a run title opens its message board, tools, files and starting definition of done.

## Spending and activity

Verified usage is distinct from active reservations and unresolved potential charges. Each run has its own cap: overview totals are accounting summaries, not a shared balance that can be transferred between swarms. A budget stop may leave a positive balance that cannot fit the next conservative request reservation.

“Working target reached” is a separate threshold indicator. A swarm can complete at that threshold, or fail for another reason after reaching it. Read the recorded reason rather than inferring the stop cause from spending alone.

Agent status counts and token/tool counts show participation and activity. They do not measure the percentage of the task completed. Tool starts include failed calls. Expected output is the requested filename, not proof that the file exists or passes review; open the board's files panel to inspect it.

## What verified success needs next

A trustworthy acceptance workflow should record a verdict against the exact artifact revision and definition of done, with checks, evidence, reviewer and time. A newer artifact or changed criteria should require a new review. Automated validators should be specific to the task (for example, executable tests or a rendered artifact check); an agent saying it succeeded is insufficient.

This increment does not add that review store or a generic AI judge. Existing challenge and probe assessments remain in [validation results](validation/acceptance.md) and [budget-awareness evidence](validation/budget-awareness.md). They are not silently converted into successful runs.
