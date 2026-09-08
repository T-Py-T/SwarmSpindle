# Swarm overview tasks

## Relevant Files
- apps/web/overview-model.ts — pure status, grouping and accounting presentation.
- apps/web/overview.ts — dashboard summary and run-card rendering.
- apps/web/app.ts — integrate refresh, filtering and navigation.
- apps/web/styles.css — responsive overview layout.
- tests/overview.test.ts — truthful outcome/accounting regressions.
- tests/browser.test.ts — actual dashboard workflow regressions.
- README.md and docs/images/ — actual screenshots and short introduction.

## Tasks
- [x] 1. Ground requirements in durable status/accounting semantics.
  - [x] 1.1 Inspect runtime completion and target precedence; record assumptions and rejected alternative.
- [x] 2. Build deterministic outcome presentation.
  - [x] 2.1 Implement status labels, grouping, threshold indicator and exact totals.
  - [x] 2.2 Verify edge cases without mutating stored records.
- [x] 3. Build the landing dashboard.
  - [x] 3.1 Render outcome filters, separate ledger totals and readable run cards.
  - [x] 3.2 Integrate search, refresh, detail outcomes and existing drilldown.
- [ ] 4. Validate and deliver.
  - [x] 4.1 Run model and Edge regressions, typecheck/build, inspect desktop/mobile screenshots.
  - [ ] 4.2 Refresh README screenshots, preserve historical hashes and complete new-repository delivery.
