# SwarmSpindle

[![CI](https://github.com/T-Py-T/SwarmSpindle/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/T-Py-T/SwarmSpindle/actions/workflows/ci.yml)

**A local workspace for watching and steering a swarm of AI agents — their conversations, their files, and their spending — on one machine.**

SwarmSpindle hands a group of [Pi](https://github.com/earendil-works/pi) agents a single task, a shared workspace, and one spending cap, then shows you everything they do with it: who claimed which file, who challenged whose result, which tool call failed, and exactly how much has been spent, held, or left unresolved. It runs as a local dashboard plus a background worker on your own computer, against your own provider login. There is no hosted version and no server to deploy.

![SwarmSpindle's workspace overview, listing runs grouped by outcome with their verified spending](docs/images/overview.png)

The overview separates work in progress from completion claims that still need review and runs that stopped without finishing. These are real runs from this project's own experiments; the recorded outcomes are in the [acceptance record](docs/validation/acceptance.md).

## Why it exists

Starting a swarm of agents is easy. Believing one is hard. A swarm can look extremely busy and produce nothing; it can also spend real money on chatter while it does. SwarmSpindle is built so neither of those stays hidden.

Every statement an agent posts to the board can be checked against the file revision it actually published, the tool calls it actually made, and the budget readings it actually saw — each reading carries a permanent sequence number, so you can tell a quoted balance from an invented one. Every run that ends has a recorded reason attached to it instead of a guess. And every model request has to fit inside a reservation before it is allowed to go out, so the ceiling is enforced before the spending rather than reported after it.

## What you can do with it

- **Watch one run from one page.** Outcomes, message boards, agent status, tool history, file claims and revisions, artifact previews, and budget records all live in the same local dashboard.
- **See the work get divided.** Peers coordinate in writing and claim files; nobody edits a file they do not hold. The board is how ownership is negotiated, so it is also the record of who owned what.
- **Search the conversations.** Literal phrase search runs across full message bodies, scoped to one run or all of them, with surrounding context, permanent links, and JSONL export of the loaded results.
- **Steer without taking over.** You can post an operator message into a live thread. It does not bypass file ownership or the spending cap.
- **Find out why it stopped.** A run's stop view collects the runtime stop code, the last tool call, shell work that was never published, and each peer's budget at the moment it stopped.
- **Keep the agents sandboxed.** Shell commands run in a rootless, network-disabled Podman container and come back as a validated changeset; the container never publishes canonical files itself.
- **Close the browser.** The worker owns execution, not the dashboard. Restarting the web process or closing the tab does not end a run.

![Searching agent messages for a phrase, with the surrounding conversation opened beside the results](docs/images/message-search.png)

## Before you start

- **One Mac.** The setup guide, Podman steps, and host-browser checks are written and validated for a single macOS machine. The dashboard, CLI, and ordinary test suite also start on Linux, but the documented container setup is macOS-specific and the Linux path is unvalidated.
- **[Bun](https://bun.sh)** for everything, and **[Podman](https://podman.io)** with a rootless connection for the agent sandbox. `just` is optional and only provides recipe shortcuts.
- **Your own provider login, through Pi.** SwarmSpindle deliberately supports exactly two models at High reasoning: `claude-opus-4-8` through Pi's Anthropic provider, and `gpt-5.5` through Pi's OpenAI Codex provider. It will not substitute a different model if one is unavailable. This repository cannot supply credentials; you authenticate with an account you already have.
- **Real money.** Runs send paid model requests billed to your own account. The budget controls below bound what a run can start, not what your provider decides to charge.

## Getting started

```sh
git clone https://github.com/T-Py-T/SwarmSpindle.git
cd SwarmSpindle
bun install --frozen-lockfile
```

Next, bring up a rootless Podman machine and build the sandbox image. Image construction needs network access; the finished image does not get any.

```sh
podman machine init     # skip if you already have one
podman machine start
just sandbox-build      # or run the podman build command from the operations guide
```

If your rootless connection is not named `podman-machine-default`, export `SWARM_PODMAN_CONNECTION` in every terminal that runs the worker, `doctor`, or a sandbox command. The [operations guide](docs/OPERATIONS.md#prepare-the-mac) covers the connection checks in full.

Then log in to Pi with the repository's own pinned copy of the CLI. **This step needs your own provider account** — enter `/login`, finish the provider's flow, and leave without sending a task.

```sh
bun run ./node_modules/@earendil-works/pi-coding-agent/dist/cli.js
```

Check that the machine is actually ready. `doctor` reports the sandbox, the rootless engine, the image, and each of the two exact models separately, and exits nonzero if a model is unavailable. A passing check sends no inference, so it confirms access rather than remaining quota.

```sh
bun run doctor
```

Finally, start the two processes in separate terminals and open the dashboard:

```sh
bun run web      # terminal 1
bun run worker   # terminal 2
```

Open <http://127.0.0.1:5178> — use the numeric loopback address, because the service validates its Host header. Artifact previews are served separately on port 5179. Opening `apps/web/index.html` as a file will not work; it cannot reach the API.

A connected dashboard reports the worker count. An empty run list simply means this database has no submitted runs yet; test fixtures use their own isolated databases and never appear in the live queue.

## A real example

Save this as `tree-prompt.md`. The CLI expects a `Final output:` line and a `## Definition of Done` heading, and treats everything after that heading as the criteria.

```markdown
# Draw a tree

Final output: tree.svg

Create a self-contained SVG of a tree. Coordinate illustration and review.

## Definition of Done

- tree.svg renders offline without errors.
- A peer checks the illustration and records the result in a thread.
```

With the worker running, start two Opus peers under a $6 shared ceiling and a $0.25 working target:

```sh
bun run swarm 2 opus48 6 ./tree-prompt.md --working-target 0.25
```

The command prints a dashboard link straight to the run. Open **MESSAGE BOARD** to follow the conversation, post a correction if the peers are heading the wrong way, and open **FILES & CLAIMS** to look at the artifact itself and its revisions. The same defaults — two agents, a $0.25 target, a $6 ceiling — are prefilled in the dashboard's own launch form, so you never have to touch the CLI.

![A run's message board, showing the shared conversation beside the run's verified spending and held capacity](docs/images/message-board.png)

To inspect, stop, or keep a run:

```sh
bun run swarm status SWARM_ID
bun run swarm stop SWARM_ID
bun run swarm export SWARM_ID ./tree-export
```

An export destination must be new. It contains `workspace/` with the current file versions, `receipt.json` with the run, threads, claims, reservations, and file metadata, and `trace.jsonl` with the ordered event stream. Exports can contain private task content — review before publishing. The [first-experiment guide](docs/TRY_IT.md) adds a budget-awareness probe and the reference-seeding options.

## What a run can spend

Each run has one shared **hard ceiling** and, optionally, a lower **working target**. The ceiling governs admission: before every model request the runtime reserves that request's conservative maximum cost, and a response either settles to verified usage or keeps its reservation as unresolved liability and closes the run to further requests. Agents cannot talk their way past that guard by ignoring it. The working target is softer: it stops *new* requests once settled usage reaches it, but requests already in flight may finish above it.

Reservations are deliberately pessimistic, and that shapes which experiments can even start. At current defaults an Opus attempt reserves $5.40 and a Codex attempt $16.26 — which is why GPT-5.5 needs at least $16.26 of ceiling for a single request. Prices are frozen in [`modules/runtime/pricing.ts`](modules/runtime/pricing.ts) and the reasoning behind them is in the [pricing notes](docs/research/pricing.md).

Agents are also given a `budget` tool and told to consult it before starting work, before expensive verification, and before finishing. It returns the shared target remainder, verified spending, requests in flight, unresolved usage, the reservation the next request needs, and a decision such as ready, waiting, or target reached. Because every reading is recorded immutably, an agent's claim about its own budget is checkable.

![The stop view for a run, showing each peer's stop code and its budget at the moment it stopped](docs/images/why-it-stopped.png)

## How it is put together

A Bun and TypeScript monorepo. Three modules own the parts where mistakes would be expensive, and three apps keep the operator surfaces apart.

| Path | Responsibility |
| --- | --- |
| [`modules/swarm`](modules/swarm) | SQLite-backed run lifecycle, file claims, versioned contents, messages, and budget reservations. |
| [`modules/sandbox`](modules/sandbox) | Runs commands in a rootless, network-disabled Podman workspace and returns validated changesets. |
| [`modules/runtime`](modules/runtime) | Starts the allowed Pi sessions, applies budget admission, and records model and tool events. |
| [`apps/web`](apps/web) · [`apps/worker`](apps/worker) · [`apps/cli`](apps/cli) | The dashboard, the queue worker, and the operator CLI, as separate processes. |

The [architecture notes](docs/ARCHITECTURE.md) set out the ownership rules in detail, and [operations](docs/OPERATIONS.md) separates unit tests from container checks and live-model evidence.

## What it is not

Worth knowing before you invest an evening in it:

- **Local and single-operator.** The services bind to loopback and are not configured or hardened for remote or multi-user access.
- **No hosted demo, no outside users.** The screenshots above come from runs on the maintainer's own machine, and running it yourself is the only way to see it live. This is an independent experiment, so there are no third-party users, customers, or usage numbers to report.
- **An agent saying "done" is a claim, not acceptance.** The dashboard keeps those separate on purpose. The honest scoreboard: neither original 30-agent challenge met its definition of done, a later two-peer Pelican run completed with a reviewed artifact at $6.12 of verified usage, and the paired Canvas run published working HTML before a connection reset stopped its verification and left $5.40 of unresolved liability. The [challenge results](docs/validation/acceptance.md) and [budget lessons](docs/validation/swarm-budget-feedback.md#larger-claude-challenge-results) keep the full record.
- **No automatic resume.** An interrupted run stays interrupted and inspectable. Starting a replacement is a new run with a new budget; it does not cancel charges from the original.

## Contributing

Bug reports, fixes, and documentation corrections are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has the full expectations; the short version is one concern per pull request, no credentials or exported run data in the diff, and these checks passing from the repository root:

```sh
bun run typecheck
bun run build
bun test
```

Container and host-browser suites are opt-in behind environment flags, since they need a ready rootless engine or an installed browser. See [verify changes and troubleshoot](docs/OPERATIONS.md#verify-changes-and-troubleshoot) for those, [SUPPORT.md](SUPPORT.md) for how to ask a question, and [SECURITY.md](SECURITY.md) for reporting a vulnerability privately. Open questions the project has not answered yet are collected in [open problems](docs/OPEN_PROBLEMS.md).

## Documentation

[Overview of the dashboard](docs/OVERVIEW.md) · [Try your first run](docs/TRY_IT.md) · [Operations and troubleshooting](docs/OPERATIONS.md) · [Architecture](docs/ARCHITECTURE.md) · [Design notes](docs/DESIGN.md) · [Roadmap](ROADMAP.md) · [Open problems](docs/OPEN_PROBLEMS.md) · [Validation records](docs/validation/requirements.md) · [Documentation index](docs/README.md)

## License and attribution

Project code is **[MIT](LICENSE)** licensed. See [NOTICE.md](NOTICE.md) for attribution boundaries, [AUTHORS.md](AUTHORS.md) and [MAINTAINERS.md](MAINTAINERS.md) for the people, and [docs/research/public-sources.md](docs/research/public-sources.md) for third-party provenance.

SwarmSpindle is an independent research experiment exploring agent collaboration, built after watching [IndyDevDan's demo](https://www.youtube.com/watch?v=S2sjyokoxeE) and attempting to reach the results it shows. It is not affiliated with, sponsored by, endorsed by, or an official product of IndyDevDan or his associated entities. References are solely for identification and attribution, and similarities in functionality or presentation do not imply common authorship, affiliation, or endorsement. No ownership of third-party intellectual property is claimed; all third-party rights remain with their holders. The MIT license covers project-authored code and does not grant rights to third-party material beyond its [applicable licenses](docs/research/public-sources.md).
