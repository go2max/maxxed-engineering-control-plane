<!--
Reuse-first engineering gate (ADR 0006, issue #50). Every PR must state exactly one `reuse:` line
below before merge. `npm run validate:reuse-gate` (also run in CI) parses this file for that line
and fails the build if it is missing or malformed. See docs/REUSE_FIRST_CHECKLIST.md.
-->

## Summary

<!-- What does this change do, and why? -->

## Reuse-first review

Search order followed per ADR 0006 / docs/REUSE_FIRST_CHECKLIST.md: existing Maxxed code first,
then mature public GitHub projects, before any net-new infrastructure or framework-level code.

Exactly one of the following (delete the other three):

```
reuse: internal
reused-component: <path or module reused unchanged>
```

```
reuse: external
source-repo: <owner/repo>
source-ref: <path/commit-or-tag>
license: <SPDX id>
adapted-as: copied | adapted | ported | inspired-by
```

```
reuse: synthesized-top-25
candidate-pool: <link to the research record, e.g. a DECISIONS doc or issue comment>
extracted-mechanisms: <one line summary of what was extracted from the pool>
```

```
reuse: none
reason: <why no suitable existing implementation was found or applicable>
```

If external code materially influenced this change, list regression tests added around the
adapted behavior:

- <test file(s)>

Estimated avoided engineering time / LOC / maintenance surface (optional, when meaningful):

- <e.g. "~2 engineer-days avoided by adapting X instead of building a new scheduler">

## Duplicate-implementation check

- [ ] I searched for an existing Maxxed implementation of this mechanism and did not find a
      near-duplicate, OR this PR is itself a refactor consolidating a duplicate found during that
      search (link the duplicate below).

<!-- If a duplicate was found: -->

## Tests

- [ ] `npm test` passes
- [ ] `npm run validate` passes (test + completion-tracker + training-data validation)
- [ ] New/adapted behavior has regression test coverage

Closes #
