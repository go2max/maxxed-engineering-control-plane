# Multi-Agent Orchestration Playbook

How a driving session (this doc's author role) should run a large batch of engineering work
across parallel subagents, based on the 2026-09-15 launch-prep sweep (issues #47, #48, #50,
#65, #67-#72 implemented + wired live across PRs #74-#85, plus #994 in Maxxed-Tech-Site).
Reuse this pattern for future multi-issue batches in any repo.

## The shape of the work

Split into two waves, never one:

1. **Primitive wave** — implement each issue as tested, additive, self-contained code.
   Explicitly defer wiring it into the live path. This keeps each PR small, independently
   reviewable, and safe to land on a deadline. Every "deliberately deferred" note in a PR
   body is a contract for wave 2, not a thing to forget.
2. **Wiring wave** — a second pass of agents connects each primitive into the real
   dispatch/scheduling/acceptance path and turns it on live (no feature flags hiding it,
   unless the user explicitly asked for shadow mode). This is where the actual risk is, so
   it deserves its own review pass separate from wave 1's.

Never collapse the two waves into one agent run — a primitive that's both newly-written and
newly-wired in the same PR is much harder to review and much riskier to revert.

## Dispatch pattern

- One agent per coherent unit of work (usually 1-2 related issues), each in its own git
  **worktree** (`isolation: "worktree"`) so parallel agents never collide on the working
  directory.
- Give every agent the *why*, not just the *what*: point it at the exact files it needs to
  read first, name the real call sites it must find (don't assume a path), and state the
  acceptance bar ("all pre-existing tests must still pass", "no interface change to X").
- Tell each agent explicitly what's out of scope and why (e.g. "no live frontier-provider
  adapter — that's a separate reviewable decision"). Agents that don't get this boundary will
  guess, and guesses on launch day are expensive.
- For anything that changes real accept/reject behavior (fail-closed gates, merge blocking),
  say so explicitly and ask for defensive logging around every rejection path so it's
  debuggable later.

## Before merging anything, verify — don't trust the self-report

An agent's final report describes what it *intended* and *believes* it did. Two things go
wrong if you skip verification:

- A primitive silently never gets wired (see #73's `policy-promotion.js` gap — fully built,
  fully tested, called from nowhere in the live loop until someone actually greps for it).
- A "fix" for a blocking gap quietly reintroduces the same gap under different framing.

So for every PR before merge:

1. Check out the branch in an isolated worktree (never the shared working directory another
   agent might still be using).
2. `git merge origin/main` into it yourself and read the diff stat — if two PRs touch the same
   file, do this check *before* trusting either PR's "mergeable" status.
3. Run the full validation suite locally (`npm run validate` or equivalent) and read the
   pass/fail counts yourself.
4. Only then merge. Prefer merging in an order that minimizes conflicts (isolated-file PRs
   first, files-in-common PRs last), and re-verify against the new main tip after each merge.

## When PRs genuinely conflict

Don't hand-splice a conflict between two large, independently-reviewed PRs into the same
turn under time pressure. Spawn a dedicated agent whose only job is the merge: give it both
sides' intent in plain language ("side A adds X state, side B adds Y state, both must
survive — this is a combine, not a pick-one"), have it read the *entire* resulting file after
resolving (not just the diff), run the full suite, and report exactly how each hunk was
combined so you can sanity-check the risky ones yourself.

## Self-correcting gaps beat happy-path reports

When an agent's own investigation reveals its assigned PR would leave something broken (e.g.
"this fail-closed gate has nothing upstream that satisfies it — everything real would be
rejected today"), that is the single most valuable thing it can report. Treat "found a real
gap and did not close the issue" or "found a real gap and did not merge" as success, not
failure — it is exactly the behavior this playbook exists to produce. The two follow-up
agents that closed #73's gap (building the missing certificate issuer) and confirmed the
old scheduler was already dead code in Tech-Site both did real diagnostic work first, and
both stated plainly what they did and did not verify.

## Cross-repo work

Attach the second repo explicitly before dispatching an agent into it (`add_repo`, clone,
`register_repo_root`). Expect stricter permission boundaries on cross-repo pushes and file
deletion in an unfamiliar repo — if a subagent launch or a destructive action gets denied by
the permission system, that is often correct caution, not friction to route around. Prefer
doing the first touch of a new repo directly (not via a delegated subagent) so you build
real context on its conventions before asking an agent to push to it. When something is
confirmed-safe-but-irreversible (e.g. deleting dead code) in a repo you just started working
in, land the safe half of the change and defer the irreversible half to its own small,
easily-revertible follow-up PR rather than forcing it through.

## Review passes before handoff

Before handing a batch of launch-day changes to a runtime/ops session to actually fire up
and monitor, run these as separate passes, not folded into the implementation agents:

1. **Secondary/sanity pass** — an agent (or the driving session) re-reads the actual merged
   diff end to end, independent of the PR descriptions, checking for coherence across PRs
   that landed close together.
2. **Security review** — the `security-review` skill/process against the accumulated diff.
3. **UX/operator-surface pass** — for anything with a human-facing surface (admin UI,
   operator commands, error messages), check it reads clearly and fails visibly rather than
   silently.

Only after these pass does the batch go to a runtime session with a handoff prompt.

## What NOT to do

- Don't schedule a future wakeup to make a merge decision on a fail-closed/high-blast-radius
  PR — that decision needs a human-adjacent turn with the actual diff in front of it, not a
  pre-written instruction executed unattended later.
- Don't let "turn it on" become "merge everything the instant CI is green" when a gate you're
  turning on has no upstream producer yet — surface the gap and ask how to sequence it.
- Don't fabricate verification. If an agent isn't confident a criterion is met, it should say
  so in the PR/issue comment rather than asserting success.
