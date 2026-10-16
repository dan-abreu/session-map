# 0002 — The architecture map is the one source of what the agents know

**Status:** accepted (2026-10-15, `id158`). **Where:** `server/ai/specialists.mjs`, `scripts/sync-agents.mjs`.

**Context.** Measured on 2026-10-15, 89 % of the agents called in a week were the generic one; the nine roles of the catalog
carried a few general steps and nothing about this program. Anthropic's own guidance says that splitting builders by kind of
work (planner, coder, tester, reviewer) loses fidelity at every hand-off, while an agent that owns a part of the code and its
tests keeps it.

**Decision.** One specialist per code part of `docs/architecture/`. What it owns ("Where in the code"), its invariants ("Rules
that must not break") and the tests that cover it are read from the map, written once as neutral data and rendered into the
native file of each AI (`.claude/agents`, `.gemini/agents`, `.codex/agents`) and into the brief of the engines the program runs
itself. Whether a card helps an AI is measured (`scripts/agent-evals.mjs`): on 2026-10-15 it helped all four AIs tried.

**Consequences.** To train a specialist you edit its part and run the sync; the generated files are never edited. A part too
big is split in the map, not in the agent. The release gate fails a publish whose agent files drifted from the map.
