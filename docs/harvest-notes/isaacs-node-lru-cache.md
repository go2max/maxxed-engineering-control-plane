# isaacs/node-lru-cache — source-understanding note

- Repo / URL: https://github.com/isaacs/node-lru-cache (published as npm `lru-cache`)
- Verified revision: npm `lru-cache@11.5.2` (checked 2026-09-15 via package.json on the
  repo's default branch and the npm registry; repo is active, not archived)
- License: BlueOak-1.0.0 (permissive; grants copyright + patent use, requires that
  redistributed copies keep the license text/link, no other notice obligations).
  Compatible with this repo's usage (technique-level adaptation, not code import).
- Disposition: **adapt**

## Problem it solves

A bounded key/value cache that evicts the item that has gone the longest without being
read or written when it is full, plus optional per-item TTL and byte-size-based capacity
(not just entry-count capacity). This is the "keep what's hot, drop what's cold" problem,
as opposed to "keep what's newest" (FIFO) or "keep everything until it expires" (TTL-only).

## Core algorithm / data flow

`lru-cache` maintains a doubly linked list of entries ordered by recency, plus a hash map
from key to list node, giving O(1) get/set/evict:
- `get(key)`: hash lookup, then unlink the node and relink it at the "most recently used"
  end of the list.
- `set(key, value)`: hash lookup/insert, relink at the MRU end; if this pushes the cache
  over capacity (by entry count and/or by a configurable `sizeCalculation` in bytes), pop
  from the "least recently used" end of the list until back under capacity.
- Optional `ttl` per entry, checked lazily on access (an expired entry is treated as a
  miss and evicted then, not swept proactively).
- Optional `dispose`/`disposeAfter` callbacks fired on eviction, for cleanup of resources
  held by evicted values.

The load-bearing idea, stripped of the framework: **eviction order must be driven by last
access time, not by insertion time**, and a plain JS `Map` already tracks insertion order
for free and lets you cheaply move a key to the end by delete+re-set. You don't need a
hand-rolled doubly linked list to get O(1)-amortized LRU semantics for a cache of this
scale — `Map`'s insertion-order iteration plus delete+set on every touch gives the same
list-reordering behavior with far less code.

## Invariants and failure modes

- Invariant: iteration order of the backing structure always reflects recency, oldest
  (least-recently-used) first.
- Failure mode if violated: a hot, frequently-hit key can be evicted ahead of a cold key
  that was merely written more recently — this was exactly the bug being fixed here.
- `lru-cache` handles size-based eviction (bytes, not just count) and stale-while-revalidate
  fetch semantics; those are real capabilities we do **not** adopt because
  `ToolResultCache` has no current requirement for byte-budgeted eviction and already has
  its own TTL + singleflight-coalescing + checksum-based tamper detection, which
  `lru-cache` does not provide at all (out of scope for a generic cache).

## Dependencies and hidden coupling

`lru-cache` itself has zero runtime dependencies. The hidden coupling for an adopter is
the doubly-linked-list internals (TypedArray-backed in recent major versions) — pulling
in the package to get LRU ordering would mean depending on internals we don't need
(size-based capacity, dispose hooks, stale-while-revalidate, AbortController integration)
for one property: recency-ordered eviction.

## Why it is stronger than (or equal/weaker than) the current Maxxed implementation

Stronger on eviction correctness: `src/leverage/tool-result-cache.js`'s `_store()` evicted
via `this.entries.keys().next().value` on a `Map` that was never reordered on read, i.e.
strict FIFO by first-write time. A tool result that is read constantly (e.g. a hot repo's
HEAD sha) had no protection from eviction if it happened to be cached before other,
colder entries. `lru-cache`'s recency-list approach fixes exactly this class of bug.

Weaker/irrelevant here: byte-size capacity, dispose callbacks, stale-while-revalidate —
none of these are needed by `ToolResultCache`'s current callers, and adding them would
grow surface area for no proven benefit (violates the "prefer adaptation over dependency
accumulation" and "shorter is better only when behavior is preserved" rules in #94).

## Comparison vs Maxxed (capability comparison matrix entry)

| dimension | external (`lru-cache@11.5.2`) | Maxxed before | Maxxed after |
|---|---|---|---|
| eviction policy | recency (LRU), O(1) via linked list | insertion order (FIFO) | recency (LRU), O(1) amortized via `Map` reordering |
| capacity dimensions | count and/or byte size | count only | count only (unchanged; no proven need for byte-size budgeting) |
| TTL | per-entry, lazy check on access | per-entry, lazy check on access (unchanged) | unchanged |
| singleflight coalescing | not provided | yes (`inFlight` map) | unchanged (Maxxed-only capability, stronger) |
| tamper/poison detection | not provided | checksum-based quarantine on `verify()`/`restore()` | unchanged (Maxxed-only capability, stronger) |
| runtime dependency added | — | 0 | 0 (technique adapted, package not imported) |
| LOC changed | — | — | +~14 lines in `tool-result-cache.js`, +14 lines test |
| test coverage | upstream has its own suite (not inspected line-by-line; out of scope) | 10 cases | 11 cases (+1 LRU regression test) |

Classification: **complementary/adapt** — Maxxed's singleflight coalescing and
checksum-based poisoning defense are already stronger than what `lru-cache` provides
(it has neither), so the existing implementation is retained; only the eviction-ordering
technique is adapted in, natively, with no new dependency.

## What was adapted and what was removed/simplified

Adapted: recency-based eviction, implemented as `_touch(key, row)` (delete+re-set on a
`Map` to move an entry to the MRU end) called on every cache hit, mirroring what
`_store()` already effectively did for writes (delete-then-set to normalize position).
No linked list, no new class, no dependency — ~10 lines of native code plus a comment
pointing at this note and at issue #94.

Removed/simplified: nothing removed; this is a targeted bug fix to existing eviction
logic, not a parallel implementation, so there is no superseded path to delete.

## Tests / benchmarks

- Added `test/tool-result-cache.test.js`: "eviction is recency-based (LRU), not
  insertion-order (FIFO), on overflow" — writes two entries at `maxEntries: 2`, re-reads
  the first (making the second the true LRU entry), inserts a third, and asserts the
  second (not the first) was evicted. This test fails against the pre-adaptation code
  (it would evict the first-written entry) and passes after.
- Full suite: `npm run validate` green before and after (419 -> 420 tests; see PR).
- No throughput/latency benchmark was run: the change is O(1) amortized before and after
  (one extra `Map` delete+set per hit), and `ToolResultCache` has no existing perf
  benchmark harness to compare against — noted as a gap for a future pass rather than
  fabricating a number.
