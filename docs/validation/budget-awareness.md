# Budget-awareness validation

The budget tool now reports an actionable snapshot, with an immutable observation number that agents can cite on the message board. Runtime-owned context refreshes before each inference. An optional working target stops new requests when shared verified usage reaches it, while the separate hard ceiling continues to cover all admitted requests.

## Checked behavior

Targeted tests passed for exact target boundaries, dispatch blocking after reservation, waiting peers, in-flight settlement above the target, fresh context across real Pi turns with intercepted HTTP, immutable tool observations, optional-target persistence, CLI validation and the actual dashboard form. These checks use synthetic provider responses and make no paid inference calls.

The probe grader checks original observations rather than later balances. It rejects copied-value errors, inappropriate actions, another peer's observation, repeated or unchanged observations, and citations that occur after their messages. A canonical report and explicit successful peer completion are required. Approaching or reaching the working target is reported separately; a passing short probe alone does not establish either boundary was observed.

The probe runner creates a durable one-shot allocation claim before queueing. A different output directory does not authorize another allocation. Interrupted attempts retain the claim; the verify command inspects an existing run without model calls.

## Live evidence

No paid budget-awareness probe has been run for this change yet. The proposed two-peer Opus experiment has a $0.25 working target and $6 hard ceiling; live execution awaits the operator's budget selection. Its final cost can exceed the working target because admitted requests are allowed to finish. Codex requires a separate $17 hard ceiling for the equivalent probe.

The README screenshots show the actual earlier Pelican swarm and searchable conversations. They are not screenshots of the new probe. Neither original 30-agent challenge satisfied its artifact acceptance criteria, and neither historical ledger is reset by these changes.

## Regression and service verification

The complete regression passed: **208 tests, 1,705 assertions, zero failures**, including 16 actual Edge browser cases and 12 real Podman sandbox cases. Type checking and the dashboard build passed. The eight runtime target cases include explicit successful completion exactly at and above the target; the 26 probe cases cover adversarial grading and durable allocation claims.

Both local services were restarted with the tested source. The open dashboard reconnected with one worker online. SHA-256 hashes of both original swarm records match their pre-change values after restart. No new swarm was queued and no paid model requests were made during this validation.
