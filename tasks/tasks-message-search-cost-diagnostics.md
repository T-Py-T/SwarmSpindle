# Message search and cost diagnostics tasks

PRD: [requirements](prd-message-search-cost-diagnostics.md)

## Relevant files
- `modules/swarm/contracts.ts`, `store.ts`: search/context contracts and durable projection.
- `apps/web/server.ts`: authenticated search and context routes.
- `apps/web/app.ts`, `message-search.ts`, `index.html`, `styles.css`: board, results/context, export and accounting explanation.
- `modules/runtime/budget.ts`, `pi-runtime.ts`, `pricing.ts`: request failure circuit and session pricing.
- `tests/swarm.test.ts`, `web.test.ts`, `browser.test.ts`, `runtime-budget.test.ts`, `runtime.test.ts`: regression coverage.
- `tooling/replay-image-transport.ts`: isolated image transport evidence.
- `README.md`, `docs/GOAL.md`, `docs/validation/message-search-cost-diagnostics.md`: usage, delivery and validation records.

## Tasks
- [x] 1. Record requirements and evidence-backed assumptions.
- [x] 2. Implement searchable message evidence.
  - [x] 2.1 Add migration-safe search IDs, full-body queries and bounded context.
  - [x] 2.2 Verify pagination, filters, migration, security and literal matching.
- [x] 3. Make conversations and search visible in the dashboard.
  - [x] 3.1 Move conversations alongside threads and collapse starting goal.
  - [x] 3.2 Add matching excerpts, scope/author filters, context links and loaded-result JSONL.
  - [x] 3.3 Verify real browser search, deep links, escaping, export and live editing.
- [x] 4. Address request failures and cost visibility.
  - [x] 4.1 Explain verified/active/unresolved cost separately and preserve failed outcomes.
  - [x] 4.2 Stop new admission after unresolved dispatch and test existing settlements/local failures.
  - [x] 4.3 Preserve session long-context pricing and verify boundaries.
  - [x] 4.4 Run real local image transport replay; record diagnostic limits and research sources.
- [x] 5. Integrate and validate.
  - [x] 5.1 Run typecheck/build and complete relevant regression suite; fix failures.
  - [x] 5.2 Backup live database, restart services together and inspect actual board evidence without inference.
  - [x] 5.3 Capture research in LearningVault, update public documentation and audit all workflow triggers.

Targeted verification: 42 store/HTTP tests, 499 assertions; 55 runtime tests, 421 assertions; typecheck and build passed. Both private image contexts passed local transport replay with zero provider calls. Browser and deployment remain pending.

Final validation: integration job job-mtrz9l5e-c9603440 passed157 and failed4 browser selectors. Added the explicit Scope accessible name; all4 affected cases passed on rerun. All14 browser cases are accounted for, along with12 real Podman cases. Live SQLite backup/backfill preserved both canonical state hashes and indexed52 messages; actual browser rendered50 Pelican posts and21 saddle search hits with7 context messages. Both services were restarted and in-app browser refreshed. Source review found no remaining material issues. No GitHub workflows exist; no provider calls were made.
