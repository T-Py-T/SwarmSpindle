# SwarmSpindle

[![CI](https://github.com/T-Py-T/SwarmSpindle/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/T-Py-T/SwarmSpindle/actions/workflows/ci.yml)

**Watch a swarm spend, claim files, and stop, on your own Mac, before you believe the transcript.**

SwarmSpindle gives a handful of [Pi](https://github.com/earendil-works/pi) agents one task, one shared workspace, and one spending ceiling, then keeps the board, the file claims, and the budget readings in a local dashboard. The worker keeps running if you close the tab. There is no hosted instance.

![Workspace overview: runs grouped by outcome, with verified spending](docs/images/overview.png)

These are existing captures from this project's own experiments, not a live server. The recorded outcomes sit in the [acceptance record](docs/validation/acceptance.md). The test fixture image is not used here.

## Why try it

A swarm can look busy and publish nothing, or spend real money on chatter. SwarmSpindle is built so both stay visible.

- **Claims, not vibes.** A message can be checked against the file revision that was published, the tool calls that were made, and a budget reading that carries a permanent sequence number.
- **The ceiling is enforced before the request.** The runtime reserves a conservative maximum, then either settles to verified usage or keeps the reservation as unresolved liability and closes the run. Agents cannot talk past that guard.
- **You can see why it stopped.** The stop view keeps the runtime stop code, the last tool call, unpublished shell work, and each peer's budget at that moment.

![Why a run stopped: per-peer stop code and budget at the stop](docs/images/why-it-stopped.png)

## What you can do with it

- **One page per run.** Outcomes, boards, agent status, tool history, file claims, artifact previews, and budget records share the dashboard.
- **File ownership is the conversation.** Peers claim files in writing. A peer does not edit a file it does not hold.
- **Search the actual bodies.** Literal phrase search across messages, one run or all of them, with context, permanent links, and a JSONL export of the loaded page.
- **Steer without taking over.** An operator message lands in the live thread. It does not bypass a claim or the ceiling.
- **Sandbox the shell.** Commands run in a rootless, network-disabled Podman container and return a validated changeset. The container does not publish canonical files.
- **Close the browser.** The worker owns execution. Restarting the web process does not end a run.

![Message search across agent conversations](docs/images/message-search.png)

![A run's message board beside verified spending and held capacity](docs/images/message-board.png)

## Honest demo

**macOS is the only validated path.** The dashboard, CLI, and ordinary tests also start on Linux. The Podman steps and host-browser checks are written for one Mac, and the Linux path is unvalidated. Nothing here is a hosted demo, and this repository has no outside-user counts to report.

Checked from a fresh clone on a Mac, without a swarm:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bun tooling/budget-probe.ts plan opus48
```

`typecheck` and `build` completed. `bun test` reported 272 pass, 36 skip, 0 fail. The skips are the installed-browser dashboard suite and the real rootless Podman suite. Skipped container tests are not evidence of containment. `budget-probe.ts plan` prints the two-peer Opus spec and `"paidRequests": false`. It does not send a model request.

Not checked, and not claimed:

- **No swarm was launched.** `bun run doctor` exited 1 because `localhost/simpleswarm-sandbox:1` is not built. `podman machine list` showed `podman-machine-default` running, then `podman images` failed with an overlay `readlink` error and `podman build` of that image failed with `faccessat ... connection refused`. Pi login was not completed. Do not read the screenshots as a launch that worked on this machine.
- **No Pi version and no spend total are asserted here.** The lockfile pins `@earendil-works/pi-coding-agent` (this checkout installed 0.87.1). Reservation math lives in [`modules/runtime/pricing.ts`](modules/runtime/pricing.ts): GPT-5.5 at High returns a fixed ceiling, and Opus at High is a base plus a per-output-token term. Historical run charges, where they exist, are in the validation notes, not restated as a new measurement.
- **A launch still costs money** once doctor is actually ready. It bills the account you logged into Pi. The ceiling bounds admission. It does not set the provider's invoice.

## Getting started

You need [Bun](https://bun.sh). [Podman](https://podman.io) with a rootless machine is required before any sandboxed command. `just` only shortcuts recipes.

```sh
git clone https://github.com/T-Py-T/SwarmSpindle.git
cd SwarmSpindle
bun install --frozen-lockfile
```

Build the sandbox only when the rootless connection accepts a build. Image construction needs network; finished commands use `--network=none`.

```sh
podman machine start
just sandbox-build
# or: podman --connection "${SWARM_PODMAN_CONNECTION:-podman-machine-default}" \
#       build --tag localhost/simpleswarm-sandbox:1 --file tooling/sandbox/Dockerfile .
```

If the connection is not `podman-machine-default`, export `SWARM_PODMAN_CONNECTION` for the worker, `doctor`, and sandbox commands. [Prepare the Mac](docs/OPERATIONS.md#prepare-the-mac) is the longer checklist.

Log in with the pinned Pi CLI and your own provider account. Leave without sending a task:

```sh
bun run ./node_modules/@earendil-works/pi-coding-agent/dist/cli.js
```

Two models are allowed, both at High reasoning, and neither is substituted: `claude-opus-4-8` through Pi's Anthropic provider, and `gpt-5.5` through Pi's OpenAI Codex provider.

```sh
bun run doctor
```

`doctor` must report the sandbox and both models ready before a launch means anything. A passing check sends no inference. It does not report remaining quota.

Then, in two terminals:

```sh
bun run web      # http://127.0.0.1:5178
bun run worker
```

Use the numeric loopback address. The service checks the Host header. Previews are on port 5179. Opening `apps/web/index.html` as a file does not reach the API. An empty run list means this database has no runs. Test databases never show up in the live queue.

### A task, once doctor is ready

The CLI wants a `Final output:` line and a `## Definition of Done` heading. Everything after that heading is the criteria.

```markdown
# Draw a tree

Final output: tree.svg

Create a self-contained SVG of a tree. Coordinate illustration and review.

## Definition of Done

- tree.svg renders offline without errors.
- A peer checks the illustration and records the result in a thread.
```

```sh
bun run swarm 2 opus48 6 ./tree-prompt.md --working-target 0.25
```

That asks for two Opus peers, a $6 shared ceiling, and a $0.25 working target. The same defaults are prefilled on the dashboard form. The command prints a link to the run. This README did not run it.

```sh
bun run swarm status SWARM_ID
bun run swarm stop SWARM_ID
bun run swarm export SWARM_ID ./tree-export
```

The export directory must be new. It contains `workspace/`, `receipt.json`, and `trace.jsonl`. Exports can hold private task text. Review them before you publish. The [first-experiment guide](docs/TRY_IT.md) adds the unpaid plan you can print first, and the paid `launch` you should not confuse with it.

The working target stops new requests once settled usage reaches it. Requests already in flight may finish above it. The hard ceiling is the admission guard. There is no automatic resume: a replacement is a new run with a new budget.

## How it is put together

Bun and TypeScript. Three modules hold the state that must not be wrong. Three apps keep the surfaces apart.

| Path | Responsibility |
| --- | --- |
| [`modules/swarm`](modules/swarm) | SQLite lifecycle, claims, revisions, messages, reservations |
| [`modules/sandbox`](modules/sandbox) | Rootless, network-disabled Podman, validated changesets |
| [`modules/runtime`](modules/runtime) | Pi sessions, budget admission, model and tool events |
| [`apps/web`](apps/web), [`apps/worker`](apps/worker), [`apps/cli`](apps/cli) | Dashboard, queue, operator CLI |

Details: [architecture](docs/ARCHITECTURE.md), [operations](docs/OPERATIONS.md).

The services bind to loopback. They are not hardened for remote or multi-user use. An agent saying "done" is a claim. The dashboard keeps that separate from acceptance. Neither original 30-agent challenge met its definition of done; later smaller runs are in the [acceptance record](docs/validation/acceptance.md) and the [budget lessons](docs/validation/swarm-budget-feedback.md#larger-claude-challenge-results), with their failures left in the record.

## Contributing

Bug fixes and doc corrections are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) asks for one concern per pull request, and no credentials or exported run data in the diff. From a clean install:

```sh
bun run typecheck
bun run build
bun test
```

Container and host-browser suites stay behind environment flags. See [verify changes](docs/OPERATIONS.md#verify-changes-and-troubleshoot). Questions: [SUPPORT.md](SUPPORT.md). Private vulnerability reports: [SECURITY.md](SECURITY.md). Open questions: [docs/OPEN_PROBLEMS.md](docs/OPEN_PROBLEMS.md).

More reading: [dashboard overview](docs/OVERVIEW.md) · [try a run](docs/TRY_IT.md) · [design](docs/DESIGN.md) · [roadmap](ROADMAP.md) · [validation index](docs/validation/requirements.md) · [docs index](docs/README.md)

## License

Project code is [MIT](LICENSE). Attribution boundaries are in [NOTICE.md](NOTICE.md). People: [AUTHORS.md](AUTHORS.md), [MAINTAINERS.md](MAINTAINERS.md). Third-party provenance: [docs/research/public-sources.md](docs/research/public-sources.md).

SwarmSpindle is an independent experiment, built after watching [IndyDevDan's demo](https://www.youtube.com/watch?v=S2sjyokoxeE) and trying to reach the results it shows. It is not affiliated with, sponsored by, endorsed by, or an official product of IndyDevDan or his associated entities. References are for identification and attribution only. No ownership of third-party intellectual property is claimed. The MIT license covers project-authored code and does not grant rights to third-party material beyond its [applicable licenses](docs/research/public-sources.md).
