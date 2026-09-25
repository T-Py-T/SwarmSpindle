# Open problems and held decisions

**Status:** active inventory. This page is a docs record, not an acceptance gate, scorecard, or release declaration.

SwarmSpindle has useful implementation and integration evidence, but several experimental questions remain open. A passing test at one seam does not turn an unresolved live-model or artifact question into a success. This page deliberately does not assign a score, a `READY` state, or comparative bake-off authority.

## Open items

### Genuine challenge acceptance is incomplete

The two authorized 30-peer challenges were attempted once and did not satisfy their artifact acceptance criteria. The Pelican run left a renderable but unfinished SVG without the required corrected revision and final hash signoffs. The Canvas run did not publish the required final HTML artifact. The recorded run outcomes, ledgers, and traces remain the source of truth; implementation tests and verified model responses do not substitute for those missing acceptance steps.

See [the acceptance record](validation/acceptance.md) and the [requirements ledger](validation/requirements.md#remaining-installation-and-acceptance-limits).

### Historical provider failures remain unexplained

Some challenge requests retained uncertain liability without a trustworthy historical HTTP/SSE failure category. Later bounded transport diagnostics and regression tests improve future observability; they do not identify the cause of those earlier failures. Do not clear the liability, relabel it as ordinary usage, or infer a provider cause from the last tool each peer used.

### Budget-awareness evidence is partial

The approved live budget probe reached its working target but failed its awareness assessment: peers did not provide the required second tool-observed checkpoint and explicit successful completion. The one-shot allocation claim is retained. The probe result is therefore partial evidence, not a passing budget-awareness result, and it does not authorize a retry.

### Reference-fidelity evidence is incomplete

The canvas research retains recovered reference frames, but not a continuous recording of the original reference motion. The isolated verifier's animation, resize, and stability regressions establish verifier behavior only; they are not evidence that a genuine model-produced artifact matches the reference.

### Provider and environment boundaries still matter

Native credentials, the selected Pi model, Microsoft Edge, and a rootless Podman connection are operator prerequisites rather than portable fixtures. Intercepted-provider tests are deterministic contract tests. Opt-in browser and container checks cover their recorded scopes. None is a live-model bake-off, a universal acceptance verifier, or evidence that an unavailable provider path can be substituted safely.

### Name and repository administration are not clearance

The SwarmSpindle name received preliminary screening, not legal or trademark clearance. Retirement of the prior public repository remains an identity-verification task. Neither item is resolved by the rebrand or by passing source tests.

## Held decisions

- Do not start a replacement challenge, spend additional paid budget, or release uncertain liability without a new explicit budget decision.
- Do not weaken the original task, substitute a model, or treat synthetic/intercepted responses as genuine artifact acceptance.
- Do not publish a score, `READY` claim, winner, or bake-off authorization from this inventory.
- Preserve the original run bodies, exports, traces, hashes, and accounting when investigating; historical outcomes are not reset by source or documentation changes.

## Evidence and tip-cite protocol

Use the linked validation receipts for claims about runs, artifacts, tests, and accounting. Keep implementation evidence, live-provider evidence, and artifact acceptance separate. If new evidence changes an item, add the authoritative receipt or artifact reference rather than converting an unresolved item into a summary score.

For ship handoffs, a tip-cite is a trace pointer in the form **at least eight hexadecimal characters of the base main tip plus the PR number**. The Steward resolves that pointer after merge to the new main tip. A tip-cite is not approval and never implies `READY`.

Example format:

> Tip-cite bank: base main `4113224c` + PR #N. Steward resolves; no READY claim.

The README footer carries the ship-specific bank entry. Keep it factual, resolvable, and free of readiness language beyond the explicit no-`READY` caveat.
