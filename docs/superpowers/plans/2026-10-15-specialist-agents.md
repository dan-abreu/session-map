# The specialist agents as the engine's first class: a catalog the guard enforces

What it is, for an engineer who never saw this codebase: the Cérebro already routes every AI function and holds each work agent's model and level by its kind tag (`[code]`, `or33`/`or42`). What is missing is the agent as a first-class object: one profile per specialty — which kinds it takes, which tools it may use, which skills it may open, what it must deliver — enforced by the guard and drawn by the Cérebro. Pure data with no vendor names, so the same role rules any engine (the answer contract `or37` already normalizes every AI). This plan builds that, one engine piece per task.

## File Structure

- `server/ai/agents.json` — the catalog: one profile per specialist, pure data.
- `server/ai/agents.mjs` — the motor: loads and validates the catalog, maps a kind to its role, renders the role line.
- `server/chat/guard.mjs` — the guard: injects the role line into the agent's brief and enforces the role's tools and skills inside the agent.
- `server/ai/brainpanel.mjs` + `server/web/brainview.js` + `server/web/i18n.js` — the Cérebro draws the specialists.
- `test/agents-catalog.test.mjs` — the catalog's proof; `test/guard-agent-choice.test.mjs` and `test/brainpanel.test.mjs` extended.

### Task 1: the catalog: one profile per specialist, every policy kind covered

Files: `server/ai/agents.json`.

Test: `node --test test/agents-catalog.test.mjs` — nine roles, every kind of `server/ai/policy.json` belongs to exactly one role, and each role has its kinds, tools, skills and exit line.

Status: done 2026-10-15 — the nine roles live in `server/ai/agents.json`; 5 tests green.

### Task 2: the motor: load, validate and resolve kind → role

Files: `server/ai/agents.mjs`.

Test: `node --test test/agents-catalog.test.mjs` — a broken catalog stops the load with the reason, `roleOf('code')` is the developer, and `roleLine(role)` renders the fixed line the guard injects, with the skills kept out of it.

Status: done 2026-10-15 — `server/ai/agents.mjs` (validateAgents, roleOf, roleById, roleLine); 5 tests green.

### Task 3: the guard holds the role: the line rides the brief, the tools and skills gates run inside the agent

Files: `server/chat/guard.mjs`.

Test: `node --test test/guard-agent-choice.test.mjs` — the allowed agent's prompt carries the role line; inside the agent a tool the role does not carry is denied; a skill passes only when the brief names it and the role carries it.

Status: done 2026-10-15 — the role line rides `updatedInput.prompt`; `guardAgentTool` denies the role's non-tools; the Skill gate checks the role's list after the brief-naming rule; 14 tests green.

### Task 4: the Cérebro shows the specialists

Files: `server/ai/brainpanel.mjs`, `server/web/brainview.js`, `server/web/i18n.js`.

Test: `node --test test/brainpanel.test.mjs` — the panel serves the nine roles with their resolved engine, model and level from the row above.

Status: done 2026-10-15 — the panel serves `agents` (each role riding its function row) and the tab draws the "Specialists — the trained agents" section in both languages; 7 tests green.

Status: in progress 2026-10-15 (id148, or55).
