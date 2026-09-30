# Hireability evidence map

> **Status:** reviewer orientation only. This page is not an acceptance gate, scorecard, release declaration, or `READY` signal.

SwarmSpindle is an independent experiment in multi-agent collaboration: a local dashboard, SQLite-backed swarm state, sandboxed tool runs, and recorded conversations and budgets. Use this map to inspect boundaries and evidence without treating any link as a broader readiness claim.

## What to read first

| Topic | Where |
| --- | --- |
| Product intent and screenshots | [Overview](OVERVIEW.md) and the [root README](../README.md) |
| Module ownership (swarm, sandbox, runtime, apps) | Linked from the README **What to inspect first** section — not repeated here |
| Planning boundaries (not architecture) | [Design overview](DESIGN.md) |
| Local setup and checks | [Operations](OPERATIONS.md), [Try it](TRY_IT.md) |
| Requirements vs automated vs live-model evidence | [Validation ledger](validation/requirements.md), [Budget feedback](validation/swarm-budget-feedback.md) |

Incomplete or stopped runs stay documented as incomplete. A passing check in one area does not certify the whole system.

## Stack (implementation surface)

- **Runtime:** Bun, TypeScript workspaces (`modules/swarm`, `modules/sandbox`, `modules/runtime`, `apps/web`, `apps/worker`, `apps/cli`)
- **Agents:** [Pi](https://github.com/earendil-works/pi) coding agent integration
- **Isolation:** Rootless Podman sandbox for command execution
- **Persistence:** SQLite for runs, messages, claims, and budget observations

## License

Project-authored code is under the [MIT License](../LICENSE). Third-party material remains under its own terms; see [Notice](../NOTICE.md) and [public sources](research/public-sources.md).

## Honesty boundary

- Do not infer `READY` from this page, documentation merges, or isolated test results.
- Architecture ownership rules live in [ARCHITECTURE.md](ARCHITECTURE.md); this map only points reviewers at evidence paths.
