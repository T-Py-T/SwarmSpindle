# Operate SwarmSpindle on one Mac

This guide describes the current implementation. Installation checks, deterministic tests, container tests, and real model acceptance prove different parts of the system. The [delivery ledger](GOAL.md) tracks outstanding release work.

## Prepare the Mac

1. Install Bun and Podman. Install `just` only if you want the recipe shortcuts.
2. From the repository root, install the locked dependencies:

   ```sh
   bun install --frozen-lockfile
   ```

3. Inspect the local Podman machines and connections:

   ```sh
   podman machine list
   podman system connection list
   ```

4. If no machine exists, create the default machine. Then start it:

   ```sh
   podman machine init
   podman machine start
   ```

   If a machine already exists, start that machine only when it is stopped. Reuse a rootless connection. Do not change an unrelated container engine’s global connection settings.

5. If the rootless connection has a different name, set it in every terminal that runs `worker`, `doctor`, or sandbox commands:

   ```sh
   export SWARM_PODMAN_CONNECTION=YOUR_ROOTLESS_CONNECTION
   ```

6. Verify the selected engine. The result must be `true`:

   ```sh
   podman --connection "${SWARM_PODMAN_CONNECTION:-podman-machine-default}" info --format '{{.Host.Security.Rootless}}'
   ```

7. Build the trusted image:

   ```sh
   podman --connection "${SWARM_PODMAN_CONNECTION:-podman-machine-default}" build --tag localhost/simpleswarm-sandbox:1 --file tooling/sandbox/Dockerfile .
   ```

   `just sandbox-build` runs the same recipe. Network access is needed during image construction. The image includes Node, Python, Pillow, CairoSVG, Playwright, and Chromium. The base version and Playwright version are pinned; Debian package downloads are not reproducible byte for byte.

## Authenticate native Pi

The application pins the Pi package family to version 0.84.1. It uses Pi’s native model catalog and credentials. It disables model overlays and personal extension, skill, prompt, theme, and AGENTS-file discovery for swarm sessions.

1. Start the repository’s installed Pi CLI:

   ```sh
   bun run ./node_modules/@earendil-works/pi-coding-agent/dist/cli.js
   ```

2. Enter `/login`. Select the native provider you intend to use. Complete its authentication flow, then leave the Pi CLI without sending a task.
3. Run the readiness check from the same environment as the worker:

   ```sh
   bun run doctor
   ```

Pi normally stores credentials under `~/.pi/agent/auth.json`. `PI_CODING_AGENT_DIR` selects a different Pi configuration directory. Use the same value for the authentication CLI, worker, and doctor. API-key authentication can also use Pi-supported environment variables such as `ANTHROPIC_API_KEY`; keep secrets outside committed files and command examples.

`doctor` checks both exact models, native authentication, the rootless engine, and the image label. Its exit code is nonzero if either supported model is unavailable. Read each provider result: one failed provider does not establish that the other failed. A readiness success sends no inference and therefore does not prove generation entitlement, response identity, artifact quality, or sufficient subscription quota.

Claude Code and Cursor authentication are separate from this application’s Pi provider state. There is no Cursor transport fallback. The worker rejects an unavailable exact model instead of choosing another model.

### Interpret authentication billing correctly

The runtime labels OAuth authentication `subscription-usd-equivalent`, and API-key authentication `metered-usd`. This is a transport classification, not a guarantee about your provider invoice.

Pi 0.84.1’s provider documentation says Claude Pro/Max usage from third-party harnesses uses separately billed extra usage. Codex subscription usage is tracked here using API-equivalent rates rather than a personal API invoice. Inspect the provider’s actual account settings before treating either login as included usage. See [Pi provider documentation](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/providers.md) and [the frozen pricing analysis](research/pricing.md).

## Start the web service and worker independently

Use the repository root as the working directory. Start the web service in the first terminal:

```sh
bun run web
```

Start the worker in a second terminal:

```sh
bun run worker
```

Open `http://127.0.0.1:5178`. Use the numeric loopback address: the service validates its Host header. Active artifacts use a separate restricted preview service on port 5179. The services are not configured for remote or multi-user access.

Open the HTTP address rather than `apps/web/index.html` as a local file. The local HTML file cannot load the dashboard bundle or connect to the API. A connected dashboard reports the worker count. Zero missions means this database has no submitted swarms; development agents and isolated test fixtures do not appear in the live queue.

The web process builds its dashboard bundle at startup. The worker polls durable state every 500 ms and maintains its heartbeat. Browser closure, tab navigation, or a web-process restart does not own the worker’s lifetime. Terminal closure or machine sleep can still interrupt a foreground worker.

Two swarms can run concurrently by default. To admit one at a time:

```sh
SWARM_MAX_CONCURRENT=1 bun run worker
```

Multiple workers must share the same database to share a queue. Each worker receives a unique identity and atomically claims queued runs. The default concurrency limit applies to each worker, not to all workers combined. The sandbox adapter permits at most four simultaneous commands per worker instance.

## Queue a task and supply references

The CLI expects a Markdown prompt containing `Final output: relative/path.ext` before a `## Definition of Done` heading. Everything after that heading is the done criteria. All three fields must be nonempty.

```sh
bun run swarm 2 opus48 6 ./task.md --working-target 0.25
```

This queues a real model task. A running worker begins it automatically. Without a worker, it stays queued. The budget is shared across the swarm and accepts positive dollars with at most two decimal places.

The optional `--working-target USD` must be positive and no larger than the hard ceiling. It stops new model requests once shared verified spending reaches the target; requests already in flight can finish above it. Omit the flag for a task governed only by its hard ceiling. The dashboard starts with two agents, a $0.25 target and $6 ceiling. For Codex, use at least $16.26 of admission capacity.

To provide selected local references:

```sh
bun run swarm 2 gpt55 17 ./task.md --seed-dir ./seed-root --working-target 0.25
```

The seed directory is imported recursively before the swarm becomes visible to workers. Paths stay relative to that directory. If the prompt expects `reference/example.png`, place the file at `seed-root/reference/example.png`. Import accepts ordinary files and directories, rejects links and special files, and limits each file to 10 MiB and the import to 48 MiB, with at most 1,000 files and 4,096 directory entries.

Agent commands cannot fetch missing references from the network. Prepare references before launch. Operator file seeding after a run starts is rejected. The dashboard can send operator messages to active threads; a message does not bypass file ownership or the spending cap.

For the requested demo acceptance, run the pelican first with `30 opus48 50`, verify its final artifact, then run the canvas with `30 gpt55 50` and original reference material. The bundled prompt files are independent reconstructions. A submitted run or a successful readiness check is not completed acceptance.

## Follow progress and stop work

```sh
bun run swarm status
bun run swarm status SWARM_ID
bun run swarm stop SWARM_ID
```

The dashboard exposes agents, conversations, file claims, versions, budget records, and trace events. Captured assistant text and tool payloads have explicit size bounds. The ordered trace is not an unlimited copy of every provider byte.

A stop request cancels a queued run immediately. For a running swarm, it records `stopping`; the worker aborts provider and sandbox work on its next poll. An uncertain transmitted request retains liability even after cancellation.

To shut down the worker, press Ctrl+C in its terminal. It stops claiming work, aborts active swarms, waits for runtime cleanup, and records itself offline. Graceful worker shutdown marks active swarms interrupted; it does not requeue them. Stop the web service separately with Ctrl+C. Stopping the web service does not cancel swarms.

### Understand terminal outcomes

| Outcome | Meaning |
| --- | --- |
| `completed` | Every agent explicitly completed and the runtime found the canonical output. Independent artifact acceptance still applies. |
| `bailed` | The run ended without all completion conditions; inspect agent explanations. |
| `failed` | Runtime, preflight, timeout, or agent failure prevented completion. |
| `cancelled` | The operator cancelled the run. |
| `budget_exhausted` | A required request no longer fits the conservative remaining budget. |
| `interrupted` | Worker shutdown or confirmed worker death interrupted execution. |

Agents can additionally be `stalled`, such as after a deadline or inactivity failure. An agent’s completion alone does not prove swarm completion or visual acceptance.

## Recover after a crash

Restart the worker against the existing data directory. Completed records remain inspectable. Queued runs remain eligible for normal claims.

A heartbeat older than 30 seconds triggers investigation, not automatic replay. Recovery requires a definitively absent process. A live or reused PID, permission error, or ambiguous timestamp leaves the old run untouched. Recovery marks a confirmed dead worker’s active runs interrupted and converts outstanding reservations to uncertain liability.

There is no automatic resume or replay of an interrupted run. Starting a replacement is a new swarm with a new budget; it does not cancel possible charges from the original run. Export and inspect the original before deciding to submit another task.

If container cleanup fails, the worker stops accepting new work and reports an error. Check the selected Podman connection first. Cleanup verifies instance ownership labels; do not remove unrelated containers or kill a process based only on a stale PID. A newly started sandbox instance cannot assume ownership of containers from a crashed instance. Residual containers require a separate, identity-verified cleanup decision.

## Export and back up evidence

Use a new destination directory:

```sh
bun run swarm export SWARM_ID ./run-export
```

The export contains `workspace/` with current file versions, `receipt.json` with run, thread, claim, reservation, and file metadata, and `trace.jsonl` with ordered events. It does not export all historical file bodies or native Pi sessions.

For a full backup, gracefully stop every worker and web process that uses the data directory. Copy the entire data directory to a new backup location. Keep the database and any SQLite companion files together. Native Pi credentials live in the separate Pi configuration directory and are not included in the application backup.

Task prompts, conversations, session files, and references may contain private information. Review exported content before publishing it. The source repository’s MIT license does not grant rights to reference media or third-party output.

## Model and configuration reference

| Accepted CLI aliases | Native provider | Exact model | Thinking |
| --- | --- | --- | --- |
| `opus48`, `opus-4.8`, `anthropic/claude-opus-4-8`, `claude-opus-4-8` | `anthropic` | `claude-opus-4-8` | `high` |
| `gpt55`, `gpt-5.5`, `openai-codex/gpt-5.5` | `openai-codex` | `gpt-5.5` | `high` |

| Variable | Default | Purpose |
| --- | --- | --- |
| `SWARM_DATA_DIR` | `~/.local/share/simpleswarmsystem` | Shared application state directory. Contains `swarm.sqlite`, `sessions/`, and `sandbox/`. |
| `SWARM_PORT` | `5178` | Loopback control/dashboard port. |
| `SWARM_PREVIEW_PORT` | `5179` | Separate loopback artifact preview port. Must differ from the control port. |
| `SWARM_MAX_CONCURRENT` | `2` | Active swarm limit per worker; integer from 1 through 16. |
| `SWARM_PODMAN_CONNECTION` | `podman-machine-default` on macOS | Explicit Podman connection used by the sandbox adapter. |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | Pi configuration and native authentication location. |

Ports must be integers from 1024 through 65535. Keep the sandbox directory under a location shared into the Podman VM. Its path must have no symlink components or commas.

Current spec defaults are 100 turns per agent, a one-hour run deadline, a 120-second idle timeout, and 16,000 requested output tokens. The spec accepts 1–100 agents. The CLI deliberately supports only the audited exact models and High reasoning.

The current tariff reserves $5 plus $0.000025 per requested Opus output token, or $5.40 at the default. Codex reserves $16.26 per attempt because its transport does not transmit the requested output ceiling. Under an untouched $50 cap, at most nine default Opus reservations or three Codex reservations fit at once. Actual settlements can release the unused portion. Unknown usage cannot release liability. Prices are frozen in [runtime pricing](../modules/runtime/pricing.ts); changes require a new audit.

## Budget-awareness experiment

`bun tooling/budget-probe.ts plan opus48` prints the two-peer configuration without model requests. `launch opus48 NEW_DIRECTORY` starts it with a $0.25 target, $6 hard ceiling, 4,096 requested output tokens, eight turns per peer and two minutes of runtime. The equivalent `gpt55` probe has a $17 hard ceiling. Both require an online worker running the updated code.

Each peer cites immutable `budget_observed` trace records in its board messages. The grader requires two distinct observations with changing verified balances per peer, correctly copied values and sensible actions, explicit successful finishes, and a canonical report. It reports whether the observed balances approached or reached the target separately from its general pass result. It cannot assess the quality of the agents' free-text reasoning.

The runner writes a one-shot claim named `budget-probe-MODEL-v1.json` in `SWARM_DATA_DIR` before queueing. A later launch for that model refuses even with a different output directory. After interruption, inspect the claim and dashboard; do not delete it to retry automatically. `bun tooling/budget-probe.ts verify SWARM_ID NEW_DIRECTORY` saves a new assessment of an existing run without model calls. A claim with a missing run ID can mean interruption during queueing: inspect the dashboard for the named budget-awareness run before deciding on any further experiment.

## Verify changes and troubleshoot

The actual dashboard suite additionally requires Microsoft Edge installed at its standard macOS path. After building, run `SIMPLESWARM_BROWSER_INTEGRATION=1 bun test tests/browser.test.ts`; ordinary tests skip it. Container Chromium does not replace this host browser.

Run the ordinary checks from the repository root:

```sh
bun run typecheck
bun run build
bun test
```

Run real container checks with a ready rootless engine and built image:

```sh
SIMPLESWARM_SANDBOX_INTEGRATION=1 bun test tests/sandbox.integration.test.ts
```

Without the flag, the container integration suite skips its real execution checks. A skip does not prove isolation. Deterministic runtime tests intercept provider transport and do not count as real model acceptance. Retain separate evidence for the requested live swarms, response identities, spending, and final artifact review.

| Symptom | Check or action |
| --- | --- |
| Swarm stays queued | Check worker status, the worker terminal, and matching `SWARM_DATA_DIR` values. |
| Authentication unavailable | Log in through native Pi in the worker’s environment, then rerun `doctor`. |
| Exact model unavailable | Inspect the installed Pi catalog and account access. Do not substitute another model. |
| Budget cannot cover one request | Compare the cap with the model’s conservative reservation. A smaller output request does not reduce the Codex envelope. |
| Agents wait despite remaining budget | Inspect reserved and uncertain amounts. Active reservations reduce available admission capacity. |
| Rootless engine or image check fails | Verify `SWARM_PODMAN_CONNECTION`, rootless status, and image construction on that connection. |
| Sandbox directory rejected | Use an absolute, VM-shared directory without symlink components or commas. |
| Claim or revision conflict | Read the current revision, coordinate ownership, and republish the complete changeset. Do not bypass the claim. |
| Preview misses remote assets | Make the artifact self-contained. The preview and agent containers intentionally block external network access. |
| Dashboard rejects `localhost` | Open the exact `http://127.0.0.1:PORT` address. |

Architecture details are in [ARCHITECTURE.md](ARCHITECTURE.md). Image execution limits and tools are in [the sandbox guide](../tooling/sandbox/README.md). Public-source provenance is in [the research record](research/public-sources.md).


Each swarm retains at most 100 MiB of cumulative historical file contents. Revisions count even after deletion; restoring a nonempty version adds retained bytes. A changeset that would exceed the limit is rejected atomically, while prior history, budget reconciliation, and terminal recording remain available. This is a file-content quota, not a total database-size guarantee.

## Existing installations

SwarmSpindle retains the original internal `@simpleswarm/*` module names, `SWARM_*` settings, sandbox image/protocol identifiers, and `~/.local/share/simpleswarmsystem` data directory for compatibility. Existing experiments and budget liabilities remain visible after upgrading. Changing the public repository and display name does not reset any run or probe allocation.
