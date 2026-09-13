# Validation procedure

All implementation categories remain visible after reaching 100% until they pass the same acceptance suite twice.

## Required execution environment

A validation pass is valid only when it runs on a local self-hosted runner registered at the `Maxxed-Technical-Systems` organization scope. GitHub-hosted runners and repository-scoped self-hosted runners do not count.

The canonical command is:

```bash
npm run validate
```

This executes the complete Node test suite and then validates `planning/completion-tracker.json` against `validation/acceptance-manifest.json`.

## Pass accounting

A pass may increment a category's `validation_passes` only when:

1. the relevant category is implementation-complete at 100%;
2. the canonical acceptance criteria for that category execute successfully;
3. the runner is an approved organization-scoped local runner;
4. the exact commit SHA and validation evidence are recorded;
5. no failed, skipped, stale, hosted-runner, repository-runner, or unverified run is counted.

A category becomes `clear_eligible` only after two genuine passing executions. The row may then be cleared from the active completion board while historical validation evidence remains retained.
