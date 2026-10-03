# Design overview

> **Status:** active planning and decision record. This page is not an architecture rewrite, acceptance gate, scorecard, release declaration, or `READY` signal.
>
> **Tip-cite:** pending — base `main` tip `c25e9d00`; resolve to `<8-char-merge-tip> PR#<number>` after merge. This is a provenance pointer only, not approval or release status, and never a `READY` claim.

SwarmSpindle documents planning choices, held boundaries, and the evidence that informs them. This page summarizes *why* certain directions were chosen and what remains open. It does not restate module ownership, runtime contracts, or isolation mechanics — see the [architecture notes](ARCHITECTURE.md) for those boundaries.

## What this page is

- A planning and decision overview for reviewers, contributors, and context.
- A map from design questions to authoritative receipts, tasks, and validation records.
- An honesty boundary: documentation records intent and evidence; it does not certify acceptance.

## What this page is not

- An architecture rewrite. Eng hold applies to `ARCHITECTURE.md`; do not expand or redo it from here.
- A substitute for live-model receipts, artifact review, or accounting ledgers.
- A score, winner, comparative bake-off, or `READY` claim.

## Design principles

1. **Evidence stays separate.** Implementation checks, live-provider observations, artifact acceptance, and accounting each prove only their stated scope. A passing check at one seam does not convert an open question elsewhere into success.
2. **Peers, not managers.** Agents coordinate through messages, file claims, and shared artifacts rather than a fixed dependency graph assigned by a central planner.
3. **Canonical state is centralized.** One SQLite-backed swarm module owns durable lifecycle, claims, versioned contents, messages, and budget reservations. Other modules call its public contracts; they do not maintain a second ledger.
4. **Commands are isolated.** Model-controlled shell work runs in a network-disabled, rootless Podman workspace against a disposable snapshot. Canonical files publish only through validated, claim-checked changesets.
5. **Money is conservative.** Integer microdollars, worst-case reservations before each provider attempt, and explicit retention of uncertain liability. Unknown or aborted usage is never treated as zero.
6. **Honest outcomes stay visible.** Incomplete, stopped, partial, and uncertain runs remain documented as such. Documentation changes do not reset historical receipts.

## Adopted decisions

These are the current design directions. Each links to the authoritative source; this page does not duplicate contract detail.

| Decision | Rationale | Authoritative source |
| --- | --- | --- |
| Separate trusted web and Pi worker processes on one Mac | Matches the demonstrated control plane; browser is not required for worker progress | [Architecture](ARCHITECTURE.md); [runtime candidates](research/runtime-candidates.md) |
| SQLite as the shared durable boundary | Single transaction owner for swarm state; web and worker read/write through `@simpleswarm/swarm` | [Architecture](ARCHITECTURE.md); `modules/swarm/contracts.ts` |
| Podman sandbox for agent commands | Rootless, network-disabled execution; no host credentials or writable canonical mounts | [Architecture](ARCHITECTURE.md); [operations](OPERATIONS.md) |
| Native Pi transport with explicit tool surface | No personal tool/skill discovery; only swarm-provided tools | [Architecture](ARCHITECTURE.md); `modules/runtime/contracts.ts` |
| Artifact acceptance is task-specific | Agent completion claims and provider responses are insufficient without a recorded verdict against the exact artifact and definition of done | [Overview](OVERVIEW.md); [acceptance receipts](validation/acceptance.md) |
| SwarmSpindle identity without package rename | Distinct product surface while keeping runtime contracts and data paths compatible for this delivery | `tasks/prd-swarmspindle.md` |
| Budget stops are categorized | Distinguish agent bail, tool failure, working-target threshold, hard cap, transport failure, and retained liability | `tasks/prd-swarm-budget-feedback.md`; [budget feedback](validation/swarm-budget-feedback.md) |

## Held and open design questions

These items remain active. A merged documentation PR or tip-cite does not resolve them.

- **Genuine challenge acceptance** — the two authorized 30-peer challenges did not satisfy their artifact criteria. See [open problems](OPEN_PROBLEMS.md) and [acceptance](validation/acceptance.md).
- **Historical provider failures** — some requests retain uncertain liability without a trustworthy failure category. Later diagnostics improve observability; they do not identify earlier causes.
- **Budget-awareness completeness** — the live probe reached its working target but failed its awareness assessment. Partial evidence is not a passing result.
- **Reference fidelity** — recovered reference frames exist; continuous reference motion does not. Verifier regressions prove verifier behavior only.
- **Administrative clearance** — name screening and repository retirement are separate from design or source-test success.

See the [roadmap](../ROADMAP.md) for prioritized next questions and the [requirements ledger](validation/requirements.md) for requirement-to-evidence mapping.

## Related documents

| Document | Role |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module ownership, runtime boundaries, and public contracts — not repeated here |
| [OVERVIEW.md](OVERVIEW.md) | How to read the dashboard and what verified success requires |
| [OPEN_PROBLEMS.md](OPEN_PROBLEMS.md) | Active inventory of unresolved experimental questions |
| [OPERATIONS.md](OPERATIONS.md) | Reproduce local checks, container tests, and operator setup |
| [GOAL.md](GOAL.md) | Delivery chronology and completion contract |
| [validation/](validation/) | Receipts for runs, tests, accounting, and acceptance |

## Honesty boundary

- Documentation records planning intent, adopted directions, and links to evidence. It is not proof that every path is implemented, tested, secure, portable, or accepted.
- Do not infer `READY` from this page, a tip-cite, a merged documentation PR, or a passing check outside its stated scope.
- Do not publish a score, winner, or comparative bake-off authorization from this overview.
- When new evidence changes a decision, update the authoritative receipt or artifact reference rather than converting an open item into a summary score.

## Evidence and tip-cite protocol

For ship handoffs, a tip-cite is a trace pointer in the form **at least eight hexadecimal characters of the base main tip plus the PR number**. The Steward resolves that pointer after merge to the new main tip. A tip-cite is provenance only: it is not approval and never implies `READY`.

For Ship 184, the handoff starts from fetched main tip `c25e9d00`; the PR number is filled in only after GitHub assigns it:

> Tip-cite bank: base main `c25e9d00` + PR #39. Steward resolves; no `READY` claim.

Do not replace an unresolved item with a tip-cite. Keep the cite factual, resolvable, and separate from readiness language.

---

> **Honesty footer:** This design overview is a planning and decision record for contributor context. It makes no release certification, acceptance, score, or `READY` claim.
