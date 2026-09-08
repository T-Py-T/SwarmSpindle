# Try a small swarm

Complete [setup and authentication](OPERATIONS.md#prepare-the-mac), then start the [dashboard and worker](OPERATIONS.md#start-the-web-service-and-worker-independently).

## Try a small experiment

The dashboard starts with **two agents, a $0.25 working target, and a $6 hard ceiling**. The target stops new requests once verified usage reaches it. Requests already in flight may finish above the target, within the separate ceiling.

There is a small budget-awareness experiment you can inspect before spending anything:

```sh
bun tooling/budget-probe.ts plan opus48
```

With the updated worker running, this command starts the paid experiment:

```sh
mkdir -p .artifacts
bun tooling/budget-probe.ts launch opus48 ./.artifacts/budget-probe-opus
```

Two Opus peers inspect their budget, post checkable observations on the board, and write a short shared report. The probe allows at most eight turns per peer and two minutes of runtime. It checks each peer's reported numbers against the original tool observations and saves an assessment plus evidence in the output directory. A failed or incomplete experiment is reported as such. Finishing below the target does not prove the agents observed its boundary.

The runner permits one allocation per model and data directory, including after an interrupted launch. To assess that existing run again without new model requests, use `bun tooling/budget-probe.ts verify SWARM_ID NEW_DIRECTORY`. Regular experiments remain available through the dashboard and CLI.

For a regular task, create `tree-prompt.md`:

```markdown
# Draw a tree

Final output: tree.svg

Create a self-contained SVG of a tree. Coordinate illustration and review.

## Definition of Done

- tree.svg renders offline without errors.
- A peer checks the illustration and records the result in a thread.
```

With the worker running, this starts two Opus agents with a $0.25 working target and shared $6 hard ceiling:

```sh
bun run swarm 2 opus48 6 ./tree-prompt.md --working-target 0.25
```

The command prints a dashboard link. Open **MESSAGE BOARD**, follow a conversation, and post a correction if needed. Inspect the artifact under **FILES & CLAIMS**. To inspect or stop the run and save its results:

```sh
bun run swarm status SWARM_ID
bun run swarm stop SWARM_ID
bun run swarm export SWARM_ID ./new-export-directory
```

The export includes workspace files, conversations, budget records, and an ordered trace. The destination must be new. Reference files can be supplied at launch with `--seed-dir ./references`; see [operations](OPERATIONS.md).

## Give agents a budget they can act on

This needs a **tool and a short operating routine**. The `budget` tool explains the shared working target, verified spending, requests still in flight, unresolved usage, and the reservation needed for the next request. It returns a decision such as ready, waiting for reservations, or working target reached, with guidance for acting on it.

Each model request also receives a fresh budget snapshot. Agents are instructed to check before starting work, expensive verification, and completion. Every tool observation has a permanent sequence number, so their statements on the board can be checked against what they actually saw at the time.

The working target stops new model requests once settled usage reaches it. It does not interrupt existing requests or guarantee a final charge equal to the target. The hard ceiling separately controls all request admission.

The runtime enforces the ceiling before each model request by reserving its conservative maximum cost. A successful response settles to verified usage. An unresolved response retains its reservation and closes admission to further requests in that swarm. Agents cannot spend past the admission guard by ignoring the tool.

Reservations can be much larger than a short response’s eventual cost. At the current defaults, an Opus attempt reserves $5.40 and a Codex attempt $16.26. That affects which experiments can start and how many requests can run together. [Pricing and reservation details](research/pricing.md)

Codex subscription costs here are USD-equivalent usage, not a personal API invoice. Pi documents Anthropic subscription access through third-party harnesses as separately billed extra usage. Check [authentication and billing](OPERATIONS.md#interpret-authentication-billing-correctly) before your first paid experiment.

