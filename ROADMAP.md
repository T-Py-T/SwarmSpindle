# Roadmap

> **Status:** active, evidence-led plan. This page is not an acceptance gate, scorecard, release declaration, or `READY` signal.
>
> **Tip-cite:** pending — base `main` tip `7df35b75`; resolve to `<8-char-merge-tip> PR#<number>` after merge. This is a provenance pointer only, not approval or release status, and never a `READY` claim.

SwarmSpindle is an independent research experiment. The roadmap records the next questions and evidence needed; it does not turn implementation checks, provider responses, or agent completion claims into product acceptance.

## Current position

- The local dashboard, worker, run lifecycle, sandbox boundary, budget accounting, trace, and artifact workflows are implemented and covered by scoped tests and operator documentation.
- The two authorized 30-peer challenges were attempted once, but both remain incomplete under their original artifact-acceptance criteria. Their receipts, artifacts, traces, and uncertain liabilities remain the source of truth.
- Budget-awareness evidence is partial, historical provider failure causes remain unknown, and reference-fidelity evidence is incomplete. These are open limits, not resolved roadmap items.
- Native credentials, provider selection, Edge, and rootless Podman remain operator prerequisites. Deterministic or intercepted checks do not substitute for live-model or artifact evidence.

See [open problems](docs/OPEN_PROBLEMS.md), the [acceptance receipts](docs/validation/acceptance.md), and the [requirements ledger](docs/validation/requirements.md) for the detailed evidence and boundaries.

## Priorities

### 1. Preserve an honest evidence ledger

Keep implementation checks, live-provider observations, artifact review, and accounting separate. Any future acceptance record must identify the exact artifact revision and definition of done, checks performed, evidence, reviewer, and time. Do not reopen paid work, clear uncertain liability, or replace failed challenge evidence without an explicit budget decision.

### 2. Improve task-specific acceptance

Add or document a review path that can record a verdict against an exact artifact and task definition. Prefer executable or rendered checks suited to the task; an agent's completion claim, a generic judge, or a successful provider response is not sufficient by itself.

### 3. Keep provider and budget boundaries observable

Retain conservative admission, reservations, settlement history, and unresolved liability. Improve safe categorization of future transport failures without guessing the causes of historical failures. Preserve the distinction between a working target, a hard ceiling, and an unresolvable usage state.

### 4. Reproduce before expanding

Maintain the clean-install, rootless-container, browser, and live-provider procedures with their scopes and limitations. Measure real mission behavior before changing persistence or scale assumptions; passing deterministic checks does not establish a live bake-off or universal verifier.

### 5. Resolve administrative questions separately

Treat project-name screening, repository administration, and third-party rights as separate evidence tasks. A rebrand, merged documentation change, or passing source test does not provide legal clearance or release authorization.

## Roadmap guardrails

- Keep failed, stopped, partial, stale, and uncertain outcomes visible.
- Do not publish a score, winner, comparative bake-off authorization, or `READY` claim from this page.
- Do not infer `READY` from a tip-cite, a merged documentation PR, or a passing check outside its stated scope.
- Update this roadmap only when an authoritative receipt, artifact, or decision changes the stated position.
