# Domain specialists, one spec for every AI: derived from the architecture map, rendered per vendor, proven by an A/B eval

What it is, for an engineer who never saw this codebase: the nine roles of `server/ai/agents.json` (`or55`) split work by *kind of task* (plan, code, debug, review…). Measured on 2026-10-15, 29 of the last 33 agent calls in this project's chats were the generic agent and 28 of 33 carried no kind tag, so no role, method or gate ever reached them. The research (`research_notes/Agentes seniores/dominio-ou-papel-2026-10-15.md`) says builders split by *kind of work* lose fidelity at every hand-off, while an agent that owns a *part of the code* with its tests keeps it. This plan adds that second axis without touching the first: a specialist per code part of the architecture map, composed with the role of the task's kind (domain × role), written once as vendor-neutral data and rendered into each AI's native agent file.

## Decisions

- **Source of truth is the architecture map**, not a new document: a part's "Where in the code" is what the specialist owns, "Rules that must not break" are its invariants, the tests that cover its files are its proof. Edit the map, run the sync, every AI's file follows. A part too big is split in the map, never in the agent.
- **Domain × role, no guard change**: the specialist's file is its system prompt (the card). The kind tag on the Agent call still picks model, effort and the role line (method, tools, gates) through the guard that exists. An untagged call still gets the card and the policy model of `code` (sonnet), never the chat's Opus.
- **Native where the AI has it, the program's executor where not**: Claude Code `.claude/agents/*.md`, Gemini CLI `.gemini/agents/*.md`, Codex `.codex/agents/*.toml` (fields verified on each vendor's docs on 2026-10-15); DeepSeek runs through Claude Code's files or the Harness with the card in the brief (`agents-run.mjs`); an API-only AI gets the card as its system text. Tool restriction is native only where the vendor offers it (Claude, Gemini); Codex cannot narrow tools or sandbox per agent, so its guarantee is the isolated copy plus the exit gates.
- **Five role agents stay as roles** (finder, planner, architect, reviewer, guardian): they isolate context or verify independently. The builders (coder, debugger, designer, writer) are carried by the domain specialists.
- **Training = proof, not prose**: an A/B eval (card vs no card) per specialist, on cases mined from the project's own fix commits, run on every AI that has a key, capped in dollars. The report says per AI whether the card is on (gains at least 0.05 and wins more cases than it loses, over 8 or more cases), off or unproven; a vendor whose card is off is left out of the sync with `--vendors`.
- Left out on purpose until measured: `memory: project` (adds a memory index to every call; depends on auto memory), preloaded skills (rule 0: agents do not open skills).

## File Structure

- `server/arch/parse.mjs` — `partRules(text)`: the "Rules that must not break" lines of a part.
- `server/ai/specialists.json` — the neutral knobs: native roles, builder kinds, tool classes per vendor.
- `server/ai/specialists.mjs` — derive specialists from the map, render the card, route files to a specialist.
- `server/ai/agent-files.mjs` — pure renderers for Claude, Gemini and Codex files and the drift check.
- `scripts/sync-agents.mjs` — writes (or `--check`s) the generated files.
- `server/ai/agents-run.mjs` — the card rides the brief of the other engines' runs.
- `server/ai/spec-eval.mjs` + `scripts/agent-evals.mjs` — mine cases from git, run the A/B on the bench's contestants.
- `scripts/agent-usage.mjs` — the share of generic agent calls, the number this plan must push down.
- Tests: `test/specialists.test.mjs`, `test/agent-files.test.mjs`, `test/spec-eval.test.mjs`, `test/agent-usage.test.mjs`.

### Task 1: the part's rules
Files: `server/arch/parse.mjs`. Test: `node --test test/specialists.test.mjs`.

Status: done 2026-10-15 — `partRules` in `server/arch/parse.mjs`.

### Task 2: derive the specialists, the card, the router
Files: `server/ai/specialists.json`, `server/ai/specialists.mjs`. Test: `node --test test/specialists.test.mjs` — a code part becomes a specialist, a requests or operation part does not, the card is under 3 KB with owns/rules/tests, files route to the part that owns most of them.

Status: done 2026-10-15 — 12 specialists derived from this repository's map; cards 1.6 to 2.7 KB.

### Task 3: the three native renderers
Files: `server/ai/agent-files.mjs`. Test: `node --test test/agent-files.test.mjs` — the frontmatter each vendor needs, tool names mapped per vendor, no vendor-specific model on Gemini/Codex, a generated-file header, stable output (byte-identical on a second run).

Status: done 2026-10-15 — Claude, Gemini and Codex formats; the kind-tag hint rides Claude's description only.

### Task 4: the sync and the generated files
Files: `scripts/sync-agents.mjs`, `.claude/agents/`, `.gemini/agents/`, `.codex/agents/`. Test: `node --test test/agent-files.test.mjs` — `--check` is clean on this repository.

Status: done 2026-10-15 — 51 files written; `--check` clean; the release gate fails a publish whose files drifted (`checkAgentFilesFresh`).

### Task 5: the other engines get the card
Files: `server/ai/agents-run.mjs`. Test: `node --test test/agents-run.test.mjs`.

Status: done 2026-10-15 — `roleBrief` takes the card; `/api/ai/run` and the arsenal's `run_other_ai` take `specialist` or `files`.

### Task 6: the A/B eval
Files: `server/ai/spec-eval.mjs`, `scripts/agent-evals.mjs`. Test: `node --test test/spec-eval.test.mjs` — mining, scoring (file recall and precision against the real commit), the dollar cap refuses before a call.

Status: done 2026-10-15 — 25 cases mined; the paid run ($2.04 of the $4 cap) gained on all four AIs (see `or68`).

### Task 7: the usage number
Files: `scripts/agent-usage.mjs`. Test: `node --test test/agent-usage.test.mjs`.

Status: done 2026-10-15 — baseline 89 % generic of 65 calls in 7 days.

Status: built 2026-10-15 (id158, or68); open: the Cérebro view (or69).
