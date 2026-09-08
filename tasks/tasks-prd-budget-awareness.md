# Budget awareness implementation

## Relevant files
- `modules/swarm/contracts.ts`, `spec.ts`: optional working target.
- `modules/runtime/budget-awareness.ts`, `tools.ts`, `budget.ts`, `pi-runtime.ts`: agent explanation, observation records, fresh context and admission.
- `apps/cli/main.ts`, `apps/web/app.ts`, `index.html`: target configuration and display.
- `tests/runtime-budget-awareness.test.ts`, `runtime-tools.test.ts`, `runtime-budget-target.test.ts`, `cli.test.ts`, `swarm.test.ts`, `browser.test.ts`, `budget-probe.test.ts`: behavior and integration validation.
- `tooling/budget-probe.ts`, `prompts/budget-probe.md`: bounded self-service experiment and evidence checks.
- `README.md`, `docs/images/message-board.png`, `message-search.png`: project story and real UI captures.

## Tasks
- [x] 1. Record requirements and clarify paid test selection.
- [x] 2. Improve the agent budget tool and observation evidence; verify all decision states.
- [x] 3. Add optional working target, runtime dispatch gate and refreshed budget context; verify boundaries and existing in-flight settlement.
- [x] 4. Add CLI/UI configuration and validate small-run settings.
- [x] 5.1 Build and verify the bounded probe, including adversarial grading and one-shot allocation protection.
- [x] 5.2 Run the approved two-peer Opus probe and record its outcome: target enforcement passed, awareness assessment incomplete at $0.253640.
- [x] 6. Capture real app screenshots, rewrite README and verify its instructions and links.
- [x] 7. Complete relevant regression checks, restart services safely and capture evidence.

Delivery follows the repository PR workflow. The first live probe is recorded in task 5.2. A follow-up paid run requires a new allocation decision; the original one-shot claim remains retained.
