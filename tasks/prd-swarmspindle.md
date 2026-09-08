# SwarmSpindle identity and independent interface

## Outcome

Publish the project as SwarmSpindle in a new public T-Py-T/SwarmSpindle repository, with a distinct dashboard, short README and current screenshots. After verified delivery and backup, delete T-Py-T/simpleswarmsystem as explicitly requested. Preserve all local experiments, liabilities and one-shot probe allocations.

## Chosen design

Keep runtime contracts, package imports, database location, sandbox protocol/image names and existing environment variables compatible. Replace the product name, navigation composition, typography, spacing and palette. Use a dark navigation rail with a cool light workspace and blue/teal accents, independent station icon and stronger separation of run status and conversations. Keep all user workflows and accessibility hooks functional, with mobile reflow.

Alternative: rename every package, data path and sandbox identifier. Rejected for this delivery because it adds data migration and container compatibility risk without improving the user-facing identity. A future internal migration needs its own backward-compatible plan.

## Requirements and acceptance

- SwarmSpindle is the browser title, dashboard identity, CLI heading, live peer identity and README name.
- Desktop navigation is a sidebar; mobile layout remains usable with no horizontal overflow, including open conversation and launch dialog.
- Preserve launch, stop, search/filter/context/export, thread posting, artifact viewing, cost display and worker connection behavior.
- Update README screenshots from actual saved run data after applying the design; keep them honest about incomplete artifacts.
- Keep legal non-affiliation and source/license attribution; redesign is not legal clearance.
- Create the new public repository and copy verified Git history. Audit every workflow file; only pull_request triggers are allowed (none currently exist).
- Before old repository deletion, retain a local mirror and public repository/PR metadata, verify the new default branch and screenshots, and compare historical run hashes.
- Delete only the explicitly named old GitHub repository. Preserve local working files, runtime database, credentials and evidence.

## Validation

Typecheck/build, complete unit/integration/browser suite, desktop/mobile screenshots and visual review, real saved-run reconnect, all historical hashes unchanged, new public repository tree verified, old repository absence confirmed after explicit deletion.
