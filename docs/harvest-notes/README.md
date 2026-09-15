# Harvest notes

This directory holds the durable artifacts produced by working through issue #94
("End-to-end GitHub capability harvest"): one *source-understanding note* per
external GitHub source that reaches at least `adapt`/`adopt`/`reference`
triage, plus a running comparison record. It exists so each harvest pass is a
repeatable, low-context-cost cycle instead of a one-off investigation that has
to be redone from scratch.

## Where the queue lives

`training/sources/github-resource-catalog.json` is the priority queue. Every
entry has a `disposition` field:

| value | meaning |
|---|---|
| `untriaged` | not yet run through the workflow below |
| `adopt` | take the dependency/implementation close to as-is (rare; needs strong evidence a native rewrite is worse) |
| `adapt` | reimplement the underlying technique natively, no framework import |
| `reference` | worth understanding, not worth adapting now (record the lesson, stop) |
| `reject` | archived / incompatible license / duplicated / low value |

Each triaged entry (`adapt`/`adopt`/`reference`) links to its
source-understanding note via the `note` field.

## Workflow per source (matches issue #94 section "Required workflow per source")

1. **Verify** — check the source repo's current status, exact revision
   (tag/commit or published package version), and license. Record all three
   on the catalog entry (`verifiedRevision`, `verifiedAt`). Reject on the
   spot if archived, unclear/incompatible license, or clearly redundant.
2. **Understand** — write a source-understanding note in this directory
   (template below) before touching any code. The note must be sufficient
   for another engineer/agent to explain the implementation without
   rereading the external repo.
3. **Compare** — find the closest existing Maxxed capability, and classify:
   Maxxed stronger (retain, capture lesson only) / external stronger (adapt)
   / complementary (merge) / redundant (delete the weaker path after proof).
   Put this in the note's "Comparison vs Maxxed" section — this doubles as
   the capability comparison matrix; there is no separate matrix file to
   keep in sync.
4. **Refactor/compress** — only if `adapt`/`adopt` and the technique is
   small, bounded, and well understood. Implement the smallest Maxxed-native
   version, no framework transplant. If the source turns out to be a large
   framework or lower value than expected, stop at `reference`/`reject` —
   forcing an implementation just to look complete is explicitly against
   the issue's rules.
5. **Prove** — add/extend unit tests, run `npm run validate`, and record
   before/after metrics in the note.
6. **Integrate** — update the catalog entry's `disposition`, remove any
   superseded path, and reference the issue/PR from the commit.

## Source-understanding note template

```markdown
# <source repo> — source-understanding note

- Repo / URL:
- Verified revision (tag/commit/package version):
- License (and required notices):
- Disposition: adopt | adapt | reference | reject

## Problem it solves

## Core algorithm / data flow

## Invariants and failure modes

## Dependencies and hidden coupling

## Why it is stronger than (or equal/weaker than) the current Maxxed implementation

## Comparison vs Maxxed (capability comparison matrix entry)
| dimension | external | Maxxed before | Maxxed after |
|---|---|---|---|

## What was adapted (if adapt/adopt) and what was removed/simplified

## Tests / benchmarks
```

## Adding a new pass

1. Pick the highest-priority `untriaged` entry (add new entries to the
   catalog first if the queue needs to grow for a category in issue #94's
   scope list that isn't represented yet).
2. Run the workflow above.
3. Update the catalog entry's `disposition`, `note`, `verifiedRevision`,
   `verifiedAt`.
4. Open a PR referencing "Relates to #94 (one harvest cycle)" — issue #94
   itself stays open across many passes; do not close it from a single-source
   PR.
