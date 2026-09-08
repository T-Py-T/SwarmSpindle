# Budget-awareness validation

The budget tool now reports an actionable snapshot, with an immutable observation number that agents can cite on the message board. Runtime-owned context refreshes before each inference. An optional working target stops new requests when shared verified usage reaches it, while the separate hard ceiling continues to cover all admitted requests.

## Checked behavior

Targeted tests passed for exact target boundaries, dispatch blocking after reservation, waiting peers, in-flight settlement above the target, fresh context across real Pi turns with intercepted HTTP, immutable tool observations, optional-target persistence, CLI validation and the actual dashboard form. These checks use synthetic provider responses and make no paid inference calls.

The probe grader checks original observations rather than later balances. It rejects copied-value errors, inappropriate actions, another peer's observation, repeated or unchanged observations, and citations that occur after their messages. A canonical report and explicit successful peer completion are required. Approaching or reaching the working target is reported separately; a passing short probe alone does not establish either boundary was observed.

The probe runner creates a durable one-shot allocation claim before queueing. A different output directory does not authorize another allocation. Interrupted attempts retain the claim; the verify command inspects an existing run without model calls.

## Live evidence

The approved two-peer Opus 4.8 High probe ran on 2026-09-08 for **38.281 seconds**. Six verified model responses settled to **$0.253640** against the $0.25 working target and $6 hard ceiling. No reservations or uncertain charges remained. No further request was admitted after the target was reached.

The run correctly ended **bailed**, and its awareness assessment failed. Each peer posted one accurate checkpoint, citing original observations at $0.028915 and $0.058805 of shared settled usage. Neither made the required second observation or explicitly finished. A 198-word canonical report was published. The target boundary was reached by final settlement, but neither peer demonstrated a tool-observed near-target or reached-target decision. These are partial awareness results, not a successful awareness test. See the [sanitized result](budget-probe-opus-result.json).

The task spent too many turns on setup and report work before its second budget check. The follow-up prompt prioritizes two observations and batches independent calls, with a shorter report. Source inspection also found that automatic context was captured before a possible admission wait; the fix now captures context after admission. Neither change retroactively alters this run or establishes that a future live probe will pass. The one-shot allocation is retained; no automatic paid retry was made.

The README screenshots show the actual earlier Pelican swarm and searchable conversations. They are not screenshots of the new probe. Neither original 30-agent challenge satisfied its artifact acceptance criteria, and neither historical ledger is reset by these changes.

## Follow-up validation

After moving context capture behind admission, 89 targeted tests passed with 653 assertions across the budget, probe, native transport, runtime and session-lifecycle suites. Type checking passed. The new real-Pi regression verifies that a peer waiting for capacity receives the preceding request's verified settlement in its dispatched context. A separate test ensures early reservation cannot authorize an unvalidated payload. These tests intercept provider requests and incur no paid inference. The worker was restarted with the fix; all three saved swarm records retained identical hashes.

## Original regression and service verification

The complete regression passed: **208 tests, 1,705 assertions, zero failures**, including 16 actual Edge browser cases and 12 real Podman sandbox cases. Type checking and the dashboard build passed. The eight runtime target cases include explicit successful completion exactly at and above the target; the 26 probe cases cover adversarial grading and durable allocation claims.

Both local services were restarted with the tested source. The open dashboard reconnected with one worker online. SHA-256 hashes of both original swarm records match their pre-change values after restart. That regression and restart verification preceded the separately approved live probe described above and made no paid model requests.
