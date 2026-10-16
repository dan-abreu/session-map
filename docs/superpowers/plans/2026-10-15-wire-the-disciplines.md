# Wire the parked disciplines into the engine

What it is, for an engineer who never saw this codebase: ~85% of the vendored content in `server/disciplines/` (ponytail 5.2.0, superpowers 6.4.2) is parked reference; the owner's rule is maximum motor, minimum reading. This plan wires the parked parts that are mechanical, one task per engine piece. The gates, the ledger, the contract and the ladder are already wired (`or44`, `or45`, `or46`).

## File Structure

- `server/ai/brainpanel.mjs` — the Cérebro panel: the levels' mapping arrives here.
- `server/bench/` — the program's measurement sets: the imported benchmark tasks land here.
- `server/chat/guard.mjs` — the workflow doors: the audit door arrives here.
- `test/` — one test file per task.

### Task 1: the ponytail intensity levels map onto the Cérebro efforts

Files: `server/ai/brainpanel.mjs`, `server/web/brainview.js`, `server/web/i18n.js`.

Test: `node --test test/brainpanel.test.mjs` — the mapping lite→low, full→medium, ultra→high/xhigh shows in the panel's model cards.

Status: done 2026-10-15 — `server/ai/ponytail-levels.mjs`, panel serves `ponytailLevels` (verified live: low=lite).

### Task 2: the vendored benchmarks feed the program's own bench

Files: `server/bench/` (import `server/disciplines/ponytail/benchmarks/results/` and the task lists), `server/ai/brainpanel.mjs` (the measured numbers).

Test: `node --test test/bench-sets.test.mjs` — the ponytail measurements appear as one more bench source with their dates.

Status: done 2026-10-15 — `server/bench/ponytail.mjs` reads the vendored 2026-10-07 numbers; `test/bench-ponytail.test.mjs` green; panel serves them (verified live: codePct=53).

### Task 3: the ponytail-audit becomes a recurring engine run

Files: `server/chat/guard.mjs` (an audit door for workflows that name it), `.dev/execucao/` (the audit script using the vendored `skills/ponytail-audit/SKILL.md` method).

Test: `node --test test/guard-agent-choice.test.mjs` — the door answers with the audit prompt's shape.

Status: done 2026-10-15 — `server/audit.mjs` ranks (failing suites first, debts after); `.dev/execucao/ponytail-audit.mjs` wrote the first report (52 findings); `test/audit.test.mjs` green. The audit lives as a runner, not a guard door: the guard's doors stay the plans and the review.

### Task 4: the vendored hooks inspire the guard's own rules (diff-review mode)

Files: `server/chat/guard.mjs` (a `[review-diff]` tag? — the ponytail-review method as a guard-checkable kind), `server/ai/policy.json` if the kind joins the policy.

Test: `node --test test/chat-guard.test.mjs` — the new kind rides the policy ladder.

Status: done 2026-10-15, shaped by the review itself: the full senior-dev review married the `[review]` kind as `REVIEW_SCHEMA` in `server/ai/contract.mjs`, used by `server/ai/ask.mjs` — the kind that already rides the policy ladder, no new tag needed.
