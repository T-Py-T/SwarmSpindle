<!-- Keep this PR docs-only; never invent scores or readiness. -->
<!-- Reversible: remove the tip-cite bank blockquote and the dependabot bullet below without changing checklist behavior. -->

> **Tip-cite bank:** base main `a93b4b8` + ship 295 (PR-template discoverability; dependabot schedules unchanged on `main`). Resolve to `<8-char-merge-tip> PR#<number>` after merge. Provenance pointer only; never `READY`.
> Wayfinder: https://github.com/T-Py-T/SwarmSpindle/issues/44

## Pull request checklist

- [ ] Scope is focused and the description explains the change.
- [ ] Relevant tests or documentation checks were run.
- [ ] No secrets, generated noise, or unrelated changes are included.

## Tip-cite protocol

Record the verified merge tip and pull request number in exactly this form:

`Tip-cite: <8-char-main-tip> PR#<number> — <short description>`

- `<8-char-main-tip>` is the first eight hexadecimal characters of the merge commit on `main`.
- `PR#<number>` is the GitHub pull request that produced that merge commit.
- Before merge, leave the tip-cite pending; do not substitute a branch, head, or invented SHA.
- Supply-chain update schedules live in [`.github/dependabot.yml`](.github/dependabot.yml) (github-actions, npm, docker); hygiene only—not approval, release certification, or `READY`.
- This is a provenance pointer, not approval or release certification.

Status is `NOT READY` until the merge tip and PR number are verified. Never invent or imply `READY`; blocked or untested work is not `READY`.
