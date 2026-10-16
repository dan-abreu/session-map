# 0003 — The guard is open by default; strict is a choice

**Status:** accepted (2026-10-15, `id154`). **Where:** `server/chat/guard.mjs`, `"guard": { "strict": true }` in config.json.

**Context.** The guard began as a door that denied agents without a kind tag, briefs without their proof and tools outside a
role. It stopped good work as often as bad, and it kept some AIs from some work by the class of the data. The owner's rule is
that no work rule blocks any AI of his.

**Decision.** By default nothing the guard knows stops an agent. It still routes each agent to the model the Cérebro and the
policy give it, snapshots before a destructive step, refuses a force push (history is never rewritten) and waits for the owner's
OK on money. The strict rules stay in the code and come back with `"guard": { "strict": true }`.

**Consequences.** Quality rests on the proofs that run after the work (tests, the review of another family, the smoke test)
and not on doors in front of it. The roles and the entry gates are advice unless strict is on, and the Cérebro says which.
