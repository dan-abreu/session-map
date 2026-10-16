# 0005 — Built is not done: a feature is done when something runs it

**Status:** accepted (2026-10-16). **Where:** `scripts/smoke.mjs`, `scripts/smoke-browser.mjs`, `docs/superpowers/plans/2026-10-16-finish-the-program.md`.

**Context.** A week of fast work left good code that nothing called: the Foundation's refresh round ran only its reading step
(its list of steps was empty), and ten finished screens were hung on no page, so four tabs said "arrives in the next version".
Both had ticked items and green tests. Closing 58 requests because "every item is ticked" repeated the mistake.

**Decision.** An item is done when the program runs it and a person can see it: the call path exists outside the tests, and
the real artifact (the file in `~/.claude/session-map/brain/<project>/foundation/`, the page in a real browser) shows it. Two
smoke tests read the running program and name what a change takes away; they run before and after every change.

**Consequences.** A request closes only after its items run, not when they are ticked. Every new screen or step comes with its
place in the registry. The smoke tests are the safety net for "do not break what is done".
