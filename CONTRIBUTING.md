# Contributing

Thanks for helping improve SwarmSpindle. The project runs local agent swarms
with a web dashboard and a worker, so changes should preserve clear operator
boundaries, reproducible checks, and evidence for claimed behavior.

## Before opening a pull request

- Start from the current `main` branch and use a short branch name that
  describes the change.
- Keep one concern per pull request. Explain which dashboard, worker, sandbox,
  CLI, or documentation behavior is affected.
- Do not commit provider credentials, local data directories, exported swarm
  evidence, generated bundles, or editor settings.
- Keep task prompts, references, and exported artifacts free of private or
  third-party material that you do not have permission to publish.

## Local setup and validation

Install the locked dependencies:

```bash
bun install --frozen-lockfile
```

Run the ordinary checks from the repository root:

```bash
bun run typecheck
bun run build
bun test
```

If you change the sandbox adapter or container behavior, also run the real
container checks with a ready rootless Podman engine and built image:

```bash
SIMPLESWARM_SANDBOX_INTEGRATION=1 bun test tests/sandbox.integration.test.ts
```

For dashboard browser changes, use the documented host-browser check when
Microsoft Edge is installed:

```bash
SIMPLESWARM_BROWSER_INTEGRATION=1 bun test tests/browser.test.ts
```

## Pull requests

1. Describe the user-visible or operator-visible behavior being changed.
2. Include the commands you ran and distinguish deterministic checks from
   container or live-provider checks.
3. Add or update tests for executable behavior and keep documentation aligned
   with the actual CLI and environment variables.
4. Do not include provider tokens, local Pi configuration, swarm database
   files, or real exported task content in a pull request.
5. Wait for the pull-request checks to pass before requesting merge.
