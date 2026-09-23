# Security policy

## Supported code

The current `main` branch is the only supported version. SwarmSpindle is a local Bun and Pi swarm workspace; it does not operate a hosted service.

## Report a vulnerability

Do not open a public issue for an unpatched vulnerability.

Email the repository owner at [tnt850910@aol.com](mailto:tnt850910@aol.com). When the repository Security tab offers it, you may also use GitHub's private vulnerability reporting.

Include the affected commit, the vulnerable path, the impact, and the smallest reproduction that does not expose sensitive data. You can expect an acknowledgment within seven days. A fix schedule depends on the severity and the affected component.

## Keep reports and evidence safe

- Do not send or commit API keys, Pi credentials, provider tokens, authentication seeds, spend ledgers with secrets, or personal data.
- Do not attach unredacted agent transcripts, Podman sandbox contents, raw SQLite databases, or host-specific evidence packets.
- Use synthetic prompts, credentials, and local fixtures when reproducing execution defects.
- Treat captured third-party output under its original license and terms.

## Repository boundary

Runtime secrets and provider credentials belong outside the repository. Never commit a secret value, decrypted configuration, private backup, or unredacted run export.

`bun run doctor`, `bun run web`, and `bun run worker` are local operator tools. They help you prepare and inspect a swarm on your own machine. They do not certify third-party agents, model providers, or generated artifacts as secure.

The deterministic test gate uses disposable databases, synthetic credentials, and skipped integration suites unless explicitly enabled. Local checks do not certify a harness, provider, sandbox image, or generated change as secure.
