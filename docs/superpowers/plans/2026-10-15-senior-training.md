# Train the specialists to senior level: method, entry gates, Cérebro

What it is, for an engineer who never saw this codebase: the specialist catalog (`or55`) gives each role its kinds, tools, skills and exit — the shape of a trained worker. This plan adds the *senior school* to that shape, distilled from the research of 2026-10-15 (`research_notes/Agentes seniores/pesquisa-2026-10-15.md`): define done first, reproduce before theorizing, evidence over claims, the simplest thing that works, verify don't trust. One task per engine piece; the rigidity stays in the motor, never in loose prose.

## File Structure

- `server/ai/agents.json` — the catalog: each role gains its fixed `method` (senior steps, en and pt).
- `server/ai/agents.mjs` — the motor: validates the method and renders it in the fixed role line.
- `server/chat/guard.mjs` — the guard: the senior entry gates (a vague brief never starts).
- `server/ai/brainpanel.mjs` + `server/web/brainview.js` + `server/web/i18n.js` — the Cérebro shows each specialist's method.
- `test/agents-catalog.test.mjs`, `test/guard-agent-choice.test.mjs`, `test/chat-guard.test.mjs`, `test/brainpanel.test.mjs`.

### Task 1: the method: each role's fixed senior steps, in both languages

Files: `server/ai/agents.json`.

Test: `node --test test/agents-catalog.test.mjs` — every role carries a method of at least three steps in en and pt, and a role without one stops the load.

Status: done 2026-10-15 — the nine methods (planner to guardian), each step from the research; the load refuses a role with no method or with an empty step.

### Task 2: the motor renders the method in the fixed role line

Files: `server/ai/agents.mjs`.

Test: `node --test test/agents-catalog.test.mjs` — the line carries "method: 1) …" and keeps the skills out of it (the brief must name them, `or32`).

Status: done 2026-10-15 — `roleLine` renders tools + method + exit, byte-identical per role (the cache rule `id102` holds).

### Task 3: the senior entry gates: a vague brief never starts

Files: `server/chat/guard.mjs`.

Test: `node --test test/guard-agent-choice.test.mjs` — a `[debug]` brief without the defect, a `[review]` brief without the delivery, a `[code]` brief without the proof and a `[docs]` brief without the code are denied before the agent starts, in both languages.

Status: done 2026-10-15 — `ROLE_GATES` in the money gate's pattern (`NO_REPRO`, `NO_TARGET`, `NO_PROOF`, `NO_CODE`); the reasons teach the conductor to write senior briefs.

### Task 4: the Cérebro shows each specialist's method

Files: `server/ai/brainpanel.mjs`, `server/web/brainview.js`, `server/web/i18n.js`.

Test: `node --test test/brainpanel.test.mjs` — the panel serves each role's method in both languages.

Status: done 2026-10-15 — the panel serves `method`/`methodPt` and the specialists section draws the steps in both languages.

Status: in progress 2026-10-15 (id149, or56).
