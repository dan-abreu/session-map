# Working on session-map — for every AI

This file is the entry for any AI that works on this repository: Claude, OpenAI (Codex), Google (Gemini), DeepSeek or
any other. The same standard holds for all of them, and every one of them may change any file (id154).

## The standard

- The professional standard is `docs/standard/` (README first; `14-trabalho-com-ia.md` for how AIs work). It is the
  same for every AI: nothing in it belongs to one company.
- The plan lives in `docs/architecture/` (the architecture-map convention): one file per part, the open work under
  "## What's missing". A new request of the owner goes, in his own words and with its date, into
  `docs/architecture/ideas.md`; its work becomes an item of the right part. Start an item by marking it
  `**in progress:**`, finish it by ticking it `- [x]`.
- Tests are the proof: `node --test "test/*.test.mjs"` (Node 20+). Nothing is done until the tests that cover it ran
  and passed; the whole suite once at the end.
- The owner (Daniel) is not a programmer: talk to him in plain Brazilian Portuguese.

## Who does what: the Cérebro

The Cérebro tab of the map (config.json `ai.others.functions`, drawn from `server/ai/functions.json`) says which AI,
model and level does each function: the entry brain, the talk, planning, code, review, the risky work, the map's bulk
work. The engine reads it at each call; nobody hard-codes an AI. When a row names another company's AI, the work goes
to it (`ask_other_ai` for a draft or a review, `run_other_ai` to edit files in an isolated copy).

## Nothing blocks an AI

The guard (`server/chat/guard.mjs`) is open by default: no work rule stops any AI. It still routes each agent to the
model the Cérebro and the policy give it, snapshots before a destructive step, refuses a force push (history is never
rewritten) and waits for the owner's OK on money. `"guard": {"strict": true}` in config.json brings the strict rules
back.

## The specialist agents

Every code part of the architecture map has an owner agent, and the same few roles (finder, planner, architect,
reviewer, guardian) exist for the work that is not tied to one part. They are written once, from the map itself
(`server/ai/specialists.mjs`: what the part owns, its "Rules that must not break", the tests that cover it) and
rendered into each AI's own agent format by `node scripts/sync-agents.mjs`: `.claude/agents/`, `.gemini/agents/`,
`.codex/agents/` (generated, never edited by hand: edit the map, then sync; `--check` tells when they drifted).

- **Claude Code:** call the agent type `sm-<part>` (`sm-flow`, `sm-orchestration`…) and start its description with the
  kind tag (`[code]`, `[debug]`…): the tag picks model, level and method, the specialist brings the part.
- **Gemini CLI:** `@sm-<part> …` at the start of the prompt. **Codex:** name the agent in the request.
- **DeepSeek and any AI the program runs itself:** `run_other_ai` takes a `specialist` (or the `files` the work touches)
  and puts the card in the brief.

Whether a card helps an AI is measured, not assumed: `node scripts/agent-evals.mjs` asks the project's own fix commits
with and without the card, on every AI with a key, under a dollar cap. `node scripts/agent-usage.mjs` shows how many
agent calls still go to the generic agent.
