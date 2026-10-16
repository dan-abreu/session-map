# All the engines: the AIs' and the program's own, complete

What it is, for an engineer who never saw this codebase: the specialist catalog (`or55`), the senior training (`or56`) and the economy gates (`or57`) made the agent a first-class, trained, economical worker — on Claude Code. This plan closes the whole picture of this conversation (`id151`): (A) the internal engines that still miss — the exit gate per role in the engine's OK, the conductor aligned to the roles, and the spend per specialist in the panel; (B) the other AIs' engines (step 4 of `id93`) — the same role running on DeepSeek, OpenAI and Gemini, editing files in an isolated copy, held by the same doors, with the Cérebro saying which engine edits files today. One task per engine piece; everything mechanical, tested, no AI asked to hold its own leash.

## File Structure

- `server/chat/turn-check.mjs` — the OK of the engine: gains the roles that worked and each one's proof.
- `server/chat/run.mjs` — the conductor prompt: gains the compact roles table.
- `server/statement.mjs` + `server/web/statementview.js` — the panel: the spend per specialist.
- `server/ai/agents-run.mjs` — the executor: one role, any AI, an isolated copy.
- `server/ai/agent-engines.mjs` — the probe: which engine edits files today.
- `server/ai/brainpanel.mjs` + `server/web/brainview.js` + `server/web/i18n.js` — the Cérebro shows it.
- `test/turn-check.test.mjs`, `test/chat-run.test.mjs`, `test/statement.test.mjs`, `test/agents-run.test.mjs`, `test/agent-engines.test.mjs`, `test/brainpanel.test.mjs`.

### Task 1: the OK of the engine reads the roles that worked and charges each one its proof

Files: `server/chat/turn-check.mjs`.

Test: `node --test test/turn-check.test.mjs` — a planner agent without a plan-file edit is `role-plan`; the result's `roles` names each agent's role.

### Task 2: the conductor knows the nine roles

Files: `server/chat/run.mjs`.

Test: `node --test test/chat-run.test.mjs` — the Autonomous prompt names the nine roles, their entry ingredients and their brief caps.

### Task 3: the spend per specialist in the panel

Files: `server/statement.mjs`, `server/web/statementview.js`.

Test: `node --test test/statement.test.mjs` — `roleTotals` groups the rows by the agent kind into the nine roles with replies and USD.

### Task 4: the executor's engine: one role, any AI, an isolated copy

Files: `server/ai/agents-run.mjs`.

Test: `node --test test/agents-run.test.mjs` — `roleBrief` carries the role line + method + task; the entry gates hold before the run; the exit (tests in the copy) holds after.

### Task 5: the engines that edit files today

Files: `server/ai/agent-engines.mjs`.

Test: `node --test test/agent-engines.test.mjs` — the probe names which engine edits files (codex, gemini, deepseek through Claude Code), and fails open when nothing is installed.

### Task 6: the Cérebro shows which engine runs each specialist

Files: `server/ai/brainpanel.mjs`, `server/web/brainview.js`, `server/web/i18n.js`.

Test: `node --test test/brainpanel.test.mjs` — the panel serves each engine's capability, and the agents row's note becomes live data.

### Task 7: the trigger: run_other_ai and merge_other_ai in the arsenal

Files: `server/ai/runroute.mjs`, `server/ai/arsenal-mcp.mjs`, `server/main.mjs`.

Test: `node --test test/ai-run-route.test.mjs` — the run refuses a vague brief, a missing CLI and private DeepSeek work; the merge waits for the review and refuses red tests.

Status: done 2026-10-15 — the two routes behind the arsenal's own token, the two tools and the mounting; 4 tests green.

Status: done 2026-10-15 (id151, or58–or63). The seven tasks built and green; 182 tests green across the touched suites.
