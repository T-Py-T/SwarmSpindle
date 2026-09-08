# Simple Swarm System

I wanted a single pane of glass for a swarm experiment: give a group of agents a task, watch them figure out how to work together, and inspect what they actually produce.

[IndyDevDan’s swarm demo](https://www.youtube.com/watch?v=S2sjyokoxeE) got me interested in building this. His demonstrated source is unpublished, so this is my independent recreation of the behavior, built on [Pi](https://github.com/earendil-works/pi).

The interesting part for me is the conversation. Who takes ownership? Does another agent challenge a weak result? Are they making progress, repeating themselves, or spending the budget talking about the work? I want to be able to see that and join in.

![The message board from the live Pelican swarm experiment](docs/images/message-board.png)

*The actual Pelican experiment: agents, shared threads, and a conversation beside the board. The run produced an unfinished SVG and stopped at its budget guard.*

## So what?

This is a local workspace for experimenting with peer agents. Each agent has its own Pi session. They share message threads and workspace files, claim files before changing them, publish revisions, and explicitly finish or bail out.

The dashboard puts their conversations, spending, tools, file history, and artifact preview in one place. You can post an operator message while they work. The worker runs separately, so closing the browser does not stop the swarm.

What makes this useful to me is being able to inspect the collaboration itself. Search the full message history across one swarm or all swarms, filter by author, open the surrounding replies, and follow a permanent link back to an idea. Download the loaded results as JSONL with complete message bodies and their origins.

![Searching conversations from the live Pelican experiment](docs/images/message-search.png)

*Finding an earlier discussion in the Pelican run and opening nearby messages. These conversations are evidence of the experiment, not a claim that its illustration was finished.*

To try it, start with one small task and an explicit definition of done. Watch the board, read what the agents tell each other, and compare their claims with the actual file. A bigger agent count is another variable to test, not a guarantee of a better result.

## What is different here?

I am using this as a place to study coordination, not just collect final answers:

- **Peers choose the work.** Shared conversations and file claims make ownership visible.
- **The conversation is part of the result.** Search across boards, recover context, and export evidence for the next experiment's guidelines.
- **Progress has a paper trail.** File revisions, tool events, and spending sit alongside what the agents claim happened.
- **The experiment keeps running.** A separate worker owns execution while the browser is the place to observe and steer.

That is the part I am excited about: getting enough visibility to improve how the next swarm works together.

## Start locally

Install Bun and Podman on your Mac. From the repository root:

```sh
bun install --frozen-lockfile
```

If you do not already have a Podman machine, create one with `podman machine init`. Start your stopped machine with `podman machine start`, then build the sandbox image:

```sh
podman --connection "${SWARM_PODMAN_CONNECTION:-podman-machine-default}" build --tag localhost/simpleswarm-sandbox:1 --file tooling/sandbox/Dockerfile .
```

Use a rootless connection. Set `SWARM_PODMAN_CONNECTION` if yours has a different name. Agents run shell commands inside these containers without network access.

Authenticate through the installed Pi CLI:

```sh
bun run ./node_modules/@earendil-works/pi-coding-agent/dist/cli.js
```

Enter `/login`, select your provider, and complete the login. Exit Pi, then check the setup:

```sh
bun run doctor
```

`doctor` checks native Pi authentication, both exact models, and the sandbox without sending an inference request. Claude Code and Cursor logins do not automatically authenticate Pi. This project supports `opus48` for Anthropic `claude-opus-4-8` and `gpt55` for OpenAI Codex `gpt-5.5`, both with High reasoning.

Start the dashboard:

```sh
bun run web
```

In another terminal, start the worker:

```sh
bun run worker
```

Open [http://127.0.0.1:5178](http://127.0.0.1:5178). If you set `SWARM_DATA_DIR`, use the same value in both terminals. See [setup and authentication](docs/OPERATIONS.md#prepare-the-mac) for the full instructions.

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

The export includes workspace files, conversations, budget records, and an ordered trace. The destination must be new. Reference files can be supplied at launch with `--seed-dir ./references`; see [operations](docs/OPERATIONS.md).

## Give agents a budget they can act on

This needs a **tool and a short operating routine**. The `budget` tool explains the shared working target, verified spending, requests still in flight, unresolved usage, and the reservation needed for the next request. It returns a decision such as ready, waiting for reservations, or working target reached, with guidance for acting on it.

Each model request also receives a fresh budget snapshot. Agents are instructed to check before starting work, expensive verification, and completion. Every tool observation has a permanent sequence number, so their statements on the board can be checked against what they actually saw at the time.

The working target stops new model requests once settled usage reaches it. It does not interrupt existing requests or guarantee a final charge equal to the target. The hard ceiling separately controls all request admission.

The runtime enforces the ceiling before each model request by reserving its conservative maximum cost. A successful response settles to verified usage. An unresolved response retains its reservation and closes admission to further requests in that swarm. Agents cannot spend past the admission guard by ignoring the tool.

Reservations can be much larger than a short response’s eventual cost. At the current defaults, an Opus attempt reserves $5.40 and a Codex attempt $16.26. That affects which experiments can start and how many requests can run together. [Pricing and reservation details](docs/research/pricing.md)

Codex subscription costs here are USD-equivalent usage, not a personal API invoice. Pi documents Anthropic subscription access through third-party harnesses as separately billed extra usage. Check [authentication and billing](docs/OPERATIONS.md#interpret-authentication-billing-correctly) before your first paid experiment.

## What has been tested?

Both 30-agent rosters have returned real responses from their requested models. Neither live challenge met its definition of done: the Pelican run left an unfinished SVG, and the canvas run produced no final artifact. Those outcomes are part of what this system lets me inspect. See the [challenge results](docs/validation/acceptance.md), [message search and cost checks](docs/validation/message-search-cost-diagnostics.md), and [budget-awareness validation](docs/validation/budget-awareness.md).

To run the local checks:

```sh
bun run typecheck
bun run build
bun test
SIMPLESWARM_SANDBOX_INTEGRATION=1 bun test tests/sandbox.integration.test.ts
SIMPLESWARM_BROWSER_INTEGRATION=1 bun test tests/browser.test.ts
```

The browser checks use Microsoft Edge at its standard macOS path. The sandbox checks start real containers. These checks do not send paid model requests or establish that an agent-produced artifact meets its visual requirements.

For implementation details, see the [requirements](tasks/prd-simple-swarm-system.md), [architecture](docs/ARCHITECTURE.md), and [operations guide](docs/OPERATIONS.md).

## Provenance and license

This is an independent reconstruction inspired by IndyDevDan, not his unpublished original source or an endorsed project. The [video requirements](docs/research/video-requirements.md) separate demonstrated behavior from reconstruction decisions. His public [pi-vs-claude-code](https://github.com/disler/pi-vs-claude-code), [pi-agent-observability](https://github.com/disler/pi-agent-observability), and [mac-mini-agent](https://github.com/disler/mac-mini-agent) repositories also informed the research.

Project-authored code is [MIT licensed](LICENSE). Dependencies and third-party reference material retain their own licenses. See [public-source research](docs/research/public-sources.md) for the source and license evidence.
