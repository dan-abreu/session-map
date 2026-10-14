# Orchestration

A senior conductor chat per project that sees the whole map, hands focused work to activity chats, hears back from each one and weighs every proposal like a board would. It is the owner's single place to say what they want; the activity chats do the work.

## How it works

Each project gets one orchestration chat, pinned on top of the conversation list and on the root of the map. It starts from a compact summary of the project (architecture, open items per part, what waits for the owner, what is running, the latest decisions) instead of the whole history. When it starts a piece of work it opens an activity chat on the right item, with the model the Automatic mode picks, always after a confirmation. The activity ticks its item when done and reports back; when the orchestration grows long it summarizes and continues.

## Where in the code

- `server/chat/`
- `server/brain/`

## Rules that must not break

- Quality is rule number one; saving money is a consequence of choosing well, never the goal.
- An activity chat is started by the orchestration on its own, in the Autonomous way, tied to an item code; the owner sees it in the list and can stop it (the owner's choice on 2026-10-10, `id90`; before, it waited for a confirmation).
- Money, accounts, contracts and business priority belong to the owner: a recommendation plus a one-click confirmation.
- The mode `bypassPermissions` is never used.

## What's missing

### Chats

- [x] Project chats: general chats about the whole project, many per project, like Claude's "New chat" `or13`
  - A click on the root bubble opens the whole project in tabs: Summary (open items, size, files with no box, what waits for the owner, what works now, the layers), "Project chats" with "New project chat", What changed and Files, with the chat under them. "New chat" at the top of the map tools and of the conversation list opens the same sheet with the information folded and a new chat first, in the project root folder.
  - Released in v0.2.4.
  - The first message carries a compact summary built from the state (layers and parts with one line each and their open items counted, what is working now, what waits for the owner, recent decisions, last changes and versions; at most 3,800 bytes, never the history) and the rule that a new request becomes an item in the right part's "What's missing", with the flow changed alongside, citing item codes (`server/chat/project.mjs`).
  - Kept in page-chats.json with the point kind `project`; never pinned to one part by the codes or files it touches; listed under "Project chats" on top of the project's card (title from the first message, time, state, cost); resumes with its history, renames and archives like any chat. The sheet takes the first message as its title as soon as it is sent, as the list does.
  - Checked in the real app on a test folder: two chats with Haiku at low asked "what is missing in this project?"; each answer named the open items and the parts without a description, about US$ 0.01 each.
  - How to confirm it is done: click the root bubble: the panel lists the project chats and offers a new one; send a message: the first prompt shows the summary under 4 KB, the chat opens in the project root and shows on top of the list in "Project chats" with its title, time, state and cost; "New chat" starts another; reopen the first from the list and continue it with its history; archive it and it leaves the list and the panel.
- [x] Orchestration chat per project `or01`
  - Built on 2026-10-11 (`server/chat/orchestra.mjs`, `orch-tools.mjs`, `server/web/orchview.js`): one orchestrator per project running the Autonomous way, eight tools of its own (open, drive, read, continue, archive and rename chats) allowed up front by name, an inbox on disk that wakes it when an activity chat ends, and brakes: 3 working at once, 2 slots always left for the owner, 30 a day, depth 1, 20 automatic turns in a row. Not yet tried with the real claude: the first real run is its end-to-end test. Reaches the page with the next version.
  - First step done: the plain project chats (`or13`); the manager's powers below come next.
  - Pinned on top of the list and on the root node. Starts from the compact project summary, absorbs "New idea" (puts items in the right place), and when long it summarizes and continues (`--resume` with its own summary, or a chained new session).
  - First of the backlog once the foundation is done (the owner decided on 2026-10-09 that understanding the programs comes first; see the Foundation part, `fd11`).
- [x] Activity chats started from the orchestration `or02`
  - A chat focused on one item of the map, started by a tool or a `POST /api/chat/start` per item, with the model chosen by the orchestration (the cheapest that does the item well) and only its part's context (`or06`); since `id90` it starts without a confirmation and gets its instructions from the orchestration.
  - When it ends it ticks the item in the architecture and posts its result in the orchestration thread (item, outcome, tests, what is left).
- [x] **important:** The tree orchestration → activities in the list and the Now strip `or03`
- [x] The orchestration looks after the older conversations of the project and aligns them with the plan `or17`
  - From `id90`. Each older conversation (not live now) is tied to its item code; what was left is continued in it, what is done is ticked and archived, and what needs the owner goes to his list. It ends with a table: conversation, item, what it did.
- [x] Automatic upkeep: the orchestration keeps the conversations organized by itself `or18`
  - From `id90`. A switch per project ("Organizar sozinho"), off until the owner turns it on in the project he wants (his choice on 2026-10-11: it spends on Opus). The activity chats send no "finished" notice of their own; the orchestrator tells their end (same day). When the project is quiet (no chat working) and at most once a day, or when 5 new conversations piled up, the orchestration runs a tidy pass: clear titles, each conversation tied to its item, finished ones archived, cut-off ones continued, items ticked and requests moved along; a short note of what it did lands in its thread.

### Senior conductor

- [ ] **in progress:** **Think before delegating** `or04`
  - 2026-10-10, the owner: Claude is the conductor of one arsenal: Claude's models (Haiku, Sonnet, Opus, Fable) at each effort level and every outside AI with a key. It sizes each task by itself, picks the level and the worker, and decides where each AI fits, itself included. The Automatic and Maestro prompts (`server/chat/run.mjs`) get the whole arsenal, the routing rules and, at the start of each chat, which outside AIs are available today, their cap left and their measured results.
  - Fable 5.1 is part of the arsenal: the top level for the hardest long autonomous work and the last word on critical deliveries (it leads the agent indexes; 2.5× Opus's price, so never the default). Today `MODELS` in `server/chat/run.mjs` has only haiku, sonnet and opus: Fable must be added there too (fixed mode and the subagent choices).
  - Understand the request, look at architecture and Flow, break it down and order it. Pick the model for the quality the task needs (the strongest without hesitating when it asks), ask for a second opinion from the reviewer, call nothing "done" without proof, explain each decision.
  - Learn from mistakes by kind of task: go up a model where the light one erred.
- [x] **Route by kind of task** `or05`
  - Done 2026-10-10: `server/ai/router.mjs` and `server/ai/conductor.mjs` route by kind, size, sensitivity and the measured results (bench `or12`, real use `or16`); committed in f126b5c.
  - Bulk reading and inventory → Haiku low; ordinary analysis and code → Sonnet medium; decisions, security, review and second checks → Opus; huge manual work → a cheap outside AI when one is set up (`or11`).
  - Research of 2026-10-10 (official price pages and independent leaderboards): Haiku 5.5 costs the same as the cheapest outside models (US$ 0.10 / 0.50 per million tokens), so an outside AI earns its place by diversity, not price: GPT-6.1 Sol as the reviewer from another family when Claude wrote the code, DeepSeek V4 Pro as a cheap try on public code only, Gemini Flash for fast reading of long pieces. Personal or client data, keys and `.env` never go to DeepSeek (stored in China, trains by default); Gemini only on a paid key. Portuguese, code review and bulk accuracy have no independent comparison yet: measure them in our own trial (`or12`) before trusting any routing, and keep the routing configurable.
- [x] **Lean context for activity chats** `or06`
  - Each gets only its part's context; long chats are summarized automatically.
- [x] **Monthly budget per project** `or07`
  - Alert at 80% and a polite pause at 100%.
  - Done 2026-10-11 (commit "feat(budget): a monthly budget per project, an alert at 80% and a polite pause at 100% (or07)"): `server/budget.mjs` adds Claude's cost of the calendar month and the outside AIs' (a ledger by project folder, written at each call) against `projects[root].budgetMonthlyUSD` in session-map's config; the watcher alerts once at 80% and once at 100%; while paused the orchestrator opens, continues or sends nothing new and runs no tidy pass, nothing running is stopped, and the conductor's tail and the project chat summary say to ask the owner ("ask-reinforce"). The project panel has the field, the bar and "Continuar este mês". A soft limit: a turn already running may end a little past it. Reviewed by GPT-6.1 Sol through the arsenal (US$ 0.02, 2 rounds).
- [x] **Priority queue** `or08`
  - Urgent work first; detail inspection and Flow polish in the gaps. The important never stops at a limit (see `wa09`).
  - Done 2026-10-11 (commit "feat(orchestra): a priority line for the activity chats, urgent first (or08)"): `server/chat/priority.mjs` keeps a line per project on disk (`orch-queue.json`); each piece is urgent, important, normal or polish (the owner's choice on the page, else the orchestrator's on the person's word, else the item's mark: blocks, important, detail). `start_chat` no longer refuses at the limits: the piece waits and the line starts the highest first on every free place, turn end and minute. Polish starts only when the project is quiet and nothing else waits (a choice: it may wait long). Near the budget (80%, or continued past 100%) or the plan's week (limit hit, or 90% used per Claude Code's own figure) only urgent and important start; an urgent piece held by today's 30 or the paused budget alerts the owner once. The project panel shows "A seguir" (first 5, priority, why it waits, a choice to change or take out). The map's background AI calls (`server/ai/runner.mjs`) keep their own first-come order. Reviewed by GPT-6.1 Sol through the arsenal (US$ 0.02, 2 rounds).
- [x] **important:** Route down by default and brief each agent narrowly: Opus only where it pays, one review per delivery, at most 10 agents per workflow `or23`
  - Measured on 2026-10-13 over one week of transcripts (session-map and cverino, list prices from `server/prices.json`): 54% of the agents were chosen at Opus high and 4% at Haiku; Opus agents were half of the spend; 59% of the agents opened a skill (test-driven-development 275 times); one Foundation workflow ran 194 agents (about US$ 270); every agent starts at about 27k tokens before it reads anything.
  - Built on 2026-10-13: the conductor prompt (`server/chat/run.mjs`) sends code, tests, docs, commits and reviews to Sonnet and Opus only to security, money, personal data, a hard design decision or what Sonnet failed; every agent gets a brief (exact files and lines, what to return, when to stop, no skill unless named, no re-reading the map or the rules); one review per delivery, not per task; at most 10 agents per workflow. The board is updated once when the request is done, not after every step (`server/chat/prompt.mjs`).
  - Outside the repository, on the owner's machine: the global rule that opened every skill "at 1%" and named skills for each agent was rewritten (backup `~/.claude/CLAUDE.md.bak-2026-10-13`); the unused pm and remotion plugins were turned off (enabled skills 92 to 48, the list sent with each request 16.5 KB to 8.9 KB).
  - From `id105`.
- [x] Measure the week after the routing change with the same counts (share of Opus agents, agents per workflow, skills opened per agent, cost per chat) and show them on the Costs tab as waste signals `or24`
  - Built on 2026-10-13: `server/waste.mjs` (wasteSignals, pure) over the statement lines, sent with the period by `server/statement-route.mjs` and drawn as the "Desperdício" section above the cost tree in `server/web/statementview.js`; each reply now carries its agent, workflow run, project and skills opened (`server/statement.mjs`, cache version 4). Last 7 days on this PC (2026-10-07 to 2026-10-13, US$ 2,369, 877 agents, all measured before the or23 rules had effect): Opus or Fable did 52% of the agents (49% Opus high, 26% Sonnet high, 21% Sonnet medium, Haiku 1%) and 51% of the total spend, against 54% Opus high and Haiku 4% in the week of or23; 59 workflow runs, 18 over 10 agents, the biggest 193 agents (US$ 142) and 64 (US$ 63), against one of 194; the agents were 62% of the spend and the chats themselves 38%; 27 chats passed 200k of context (the longest 966k, 962 replies, US$ 149); 678 skills opened by agents (0.77 per agent), 21 snowball skills (test-driven-development opened by 197 agents of one chat), replies that opened a skill cost 2.2% of the spend (about 3% before); first read of an agent: median 29.6k tokens, largest 109k.
  - The counts of `or23` came from a one-off script over the transcripts; the statement already reads every reply, so it can keep them and warn when a workflow grows past 10 agents or Opus passes a third of the agents.
  - From `id105`.
- [x] **important:** The engine guards every agent, not the prompt: no model or effort, Opus or Fable outside a sensitive request, or a workflow past 10 agents are stopped before they start `or25`
  - A PreToolUse hook on the Agent and Workflow tools, passed to each chat by session-map (it runs inside subagents too): it denies the call with the reason, so the conductor picks again; the request's measure (`or14`) says what is sensitive. The prompt rules of `or23` stay as advice; this makes them hold.
  - From `id106`.
  - Built on 2026-10-13 (`server/chat/guard.mjs`, guardAgent): no model, or Opus, Fable, xhigh or max without a reason word, is denied before the agent starts. The cap of 10 agents per workflow stays advice in the prompt: a workflow script builds its agents in loops, so counting them before it runs is not exact.
- [ ] An OK at the end of each request, checked by the engine without AI: tests ran and passed, the item ticked, the work saved, what the request cost `or26`
  - Read from the transcript and the plan file at turn end; the card shows OK, or what is missing. It never forces more work (a blocking stop hook can loop and spend).
  - From `id106`.
  - Also what changed, without AI: the functions added, changed or removed (the Foundation's facts before and after the turn), for the orchestrator's state; from `id108`.
- [x] **important:** Every AI agrees or disagrees on evidence, never to please: the same rule in every way a chat runs and in what goes to an outside AI that judges `or27`
  - One sentence in `server/ai/stance.mjs`: say which, the facts behind it (numbers, file:line) and what would change your mind; without facts, say so and measure. A yes-man and a contrarian are both wrong.
  - Built on 2026-10-13: the conductor prompts carry it (Autonomous, Automatic, Maestro), the Manual ways get it alone (a fixed model, Ultracode), and `ask_other_ai` puts it before a review or a reasoning prompt; drafts, summaries and labels go as written. "Same as my Claude" stays the person's own setup (on this PC its CLAUDE.md has the rule).
  - From `id107`.
- [ ] A local model (Ollama) as one more outside AI: off by default, measured by the bench before it is trusted, used only for long logs, READMEs and docs `or28`
  - Facts on 2026-10-13: this PC has an RTX 5070 Ti Laptop GPU (12 GB) that runs a 7 to 14B model, but 15.5 GB of RAM with 1.7 GB free, and timing tests already flake on the busy PC. Haiku and Gemini Flash already read at about US$ 0.002 per right answer.
  - Its real plus is privacy: nothing leaves the PC, so it may read client data that DeepSeek may not. Never for the structure of code: the Foundation does that exactly (`fd17`).
  - From `id108`.
- [x] **important:** The law of the engine: plan first, on a cheap model, then build with the model each task needs; the entry chat is never Opus at high by default `or29`
  - Built on 2026-10-13: server/ai/brain.mjs weighs each message (trivial Haiku low, talk Sonnet low, plan Sonnet medium (by the bench, or30), build Sonnet medium or high, Opus high for security, money or personal data; never Fable, xhigh or max); server/chat/hub.mjs starts the chat on that level and swaps the idle process (same key, same stream) when the level changes; chat/run.mjs isWeighed and withWeighed put it on Autonomous and Automatic, and the prompt names the real model. The plan review by Opus and the fresh build chat that carries the plan stay with their own items.
  - Today every Autonomous, Automatic and Maestro chat starts on Opus at high, even to talk; on the week to 2026-10-13 the main chats were 33% (session-map) and 45% (cverino) of the spend. Prices per million tokens in: Haiku 0.10, Sonnet 2, Opus 4, Fable 10; high effort adds thinking tokens at the output price.
  - Talk and organizing the idea: Sonnet at low (Haiku for a question or one command, by the request's measure `or14`). The plan: Sonnet at high writes it, each task with its model and effort; a large or sensitive plan gets one short review by Opus (Fable when critical) on the plan text only, never the whole chat. Build: after the plan is approved, a fresh chat carries the plan only (`pc28`), its workers held to it by `or25`.
  - A model change resets the prompt cache (the whole context is written again at the new price): the engine switches only at the edges of a phase, not mid-talk.
  - From `id109`.
- [x] Measure planning on the bench: Haiku, Sonnet and Opus on real planning requests of the owner, so the entry model is set by data, not by guess `or30`
  - Built on 2026-10-13: a `plan` set (`server/bench/sets/plan.json`, scorer `scorePlan` in `server/bench/score.mjs`, prompt in `server/bench/run.mjs`; `node server/bench/run.mjs --kinds plan`): 8 cases from the owner's Asked lines of id105 to id111, scored with no judge model as the share of criteria met (split into tasks, model and effort on each, at most 10 agents, waits for approval, a strong task and no weak guard work when money or security is involved, and 3 case points in Portuguese and English); right at 80% or more. Claude levels run at haiku low, sonnet medium, opus high (`--effort` added to `runClaudeJSON`). Run `plan-or30-final`, 8 cases each, cost US$ 0.50; with the first run (US$ 0.96, looser guard rule), two spot checks and one outside review the whole job cost about US$ 1.5, under the US$ 3 cap, so it ran to the end. Right answers and cost per right answer: sonnet 8/8, US$ 0.019; haiku 7/8, US$ 0.0009; opus 7/8, US$ 0.045; gemini-3.8-flash 8/8, US$ 0.0020; gemini-3.1-flash-lite 7/8, US$ 0.0009; openai gpt-6-luna 7/8, US$ 0.0002. Mean share of criteria: sonnet 100%, opus 97%, gemini-3.8-flash 95%, luna 93%, haiku 92%, flash-lite 90%. An earlier run with a looser rule for guard work gave sonnet 8/8, opus 8/8, haiku 7/8. Limits: 8 cases, one case is 12.5 points, and the criteria check the plan's form and key ideas, not whether it is wise, so the models are close; read the order, not the gaps.
  - By these numbers Sonnet should plan: it was right on all 8 twice, at about 40% of Opus's cost per right answer, and Opus bought nothing extra; Haiku is nearly as good for 1/20 of the price but missed the same case (agents re-reading) in both runs, so it should weigh and ask (`or31`) rather than write the plan. This agrees with `or31` on the model (Sonnet plans) but not on the level: Sonnet was measured at medium and was enough, so high is an extra cost this set does not justify; try Sonnet high on the same set before keeping it.
  - The bench measures code, Portuguese and review today, not planning; the starting choice in `or29` (Sonnet plans, Opus reviews large plans) is a guess until this runs.
  - From `id109`.
- [x] **important:** The entry brain: every message is weighed before it runs, and the chat starts or moves to the model that weight asks for, then back down when the talk gets small `or31`
  - Built on 2026-10-13: server/ai/brain.mjs weigh (rules from sizeRequest, then one optional Haiku call through runClaudeJSON when the rules are unsure and the text is over 200 characters; the higher level wins); hub.mjs weighs at the chat start and at each message, up at once, down only for talk or trivial, never mid-turn; the run event carries brain {phase, why} and i18n has run.brain.*. conductor.mjs recommend no longer picks Fable for large critical long work: Opus at high, Fable only after Opus failed. The bench feed of each choice stays with or30.
  - Rules first, free (the request's measure `or14`); when they are unsure, one Haiku call (about US$ 0.0003 a message) returns the size, sensitivity, talk, plan or build, and how sure it is. Only a large and unclear request gets at most two short questions, never every message.
  - The first turn already runs on the chosen model (no cache lost); a later message that changes level moves the chat at that edge (`or29`). In doubt it goes one level up, and always up for sensitive work: under-routing costs quality, over-routing only money. Work that fails its tests or review climbs a level.
  - The page says which model and level runs and why, in one line, so what is said and what runs are the same. Each choice and its outcome (tests, review, the owner's correction) feed the bench (`or30`).
  - Research: RouteLLM (Berkeley, 2024) cut over 85% of the cost on general chat keeping about 95% of the strong model's quality; coding agents will save less, so it is measured here before it is trusted.
  - From `id110`.
- [x] **important:** Read once, hand the chapter: the conductor reads the activity and opens a skill once, then each agent gets only the chapter it needs; agents do not open skills or re-read the activity unless their brief names it `or32`
  - Agents do not share memory: what one read is not in another's head, so 150 agents told to open a skill read it 150 times (on the week to 2026-10-13, the test-driven-development skill, 9.6 KB, was opened 275 times). The fix is not to make them read: the brief carries the few lines of the skill and of the activity that the task needs.
  - Held by the engine: a PreToolUse hook denies a Skill call inside an agent unless its brief names that skill (`or25`, `pc26` proves the hook sees agents). The shared part of the briefs goes first and byte-identical, so the agents after the first pay the cache price (5% of a full read), if Claude Code's cache marks allow it; `pc26` measures that.
  - From `id111`.
  - Built on 2026-10-13: a Skill call inside an agent is denied unless the agent's brief names that skill (whole name, not a part of a word); the main chat's own skills are never blocked. The cache share of identical briefs is left to measure in `or24`.

### Board of roles

- [ ] **The orchestration chat wears the roles of a board** `or09`
  - CEO and strategy, Product, Marketing, Finance, Operations and delivery, Technology (the senior conductor), Legal and privacy.
  - Every relevant proposal is analyzed from the angles that apply (value, cost to build and to run, return, timing, positioning, legal risk) and ends with a recommendation. It uses the `pm-product-strategy`, `pm-market-research` and `pm-product-discovery` skills when they fit, plus the real costs session-map already has.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **Business view of the project** `or10`
  - Cost per feature, priority by impact × effort × cost, a delivery roadmap.
  - Later, by the owner's choice on 2026-10-10 (`op06`).

### Later (ideas, not committed)

- [x] Every AI with a key at once, picked by the conductor, never by the owner `or14`
  - Done 2026-10-10 (f126b5c): one daily cap for all, per-AI on/off, per-project data class (all the owner's projects are his own; session-map public), the arsenal tools ask_other_ai, list_other_ais, pick_worker and report_result in every chat.
  - The owner only pastes keys and sets one daily cap; a dispatcher picks the AI per task (kind, data sensitivity, cost, measured accuracy), spreads bulk work over all of them at once, sends reviews to another family, never sends client data to DeepSeek, and pauses an AI that errs too often. Asked on 2026-10-10 (`id22`).
- [x] **important:** A panel of the AIs measured by real use `or16`
  - Done 2026-10-10 (deb1ed8), reviewed by GPT-6.1 Sol through the arsenal (4 findings, all fixed). The cap is US$ 5 a day.
  - Per AI and per kind of work, from what really happened (activity log and Claude's accept/refuse): calls, share accepted, cost per accepted piece, time, today's spend against the one daily cap (US$ 5, set by the owner on 2026-10-10), next to the bench's score. Real-use results with at least 20 decided pieces feed the routing like the bench does. Asked on 2026-10-10: "voce só fez testes, não está usando elas, pode colocar algum painel para acessar os dados delas, para fazer as medições de acordo como vamos usando".
- [x] **important:** The conductor's teams use the other AIs in real work `or19`
  - Done 2026-10-11: one rule in the conductor's prompt for every way that conducts (`server/chat/run.mjs`) and the plugin skill `session-map:arsenal` (`skills/arsenal/SKILL.md`), with a ready line for workflow agents' prompts. Reviewed by GPT-6.1 Sol through the arsenal (US$ 0.012, 5 points, all applied).
  - Asked on 2026-10-11 ("voce ta usando as outras IA´s para fazer essas taferas? pra ver se batareia o projeto"): until now the outside AIs did one review; the teams were all Claude. In every workflow and helper team: the reviewer from another family goes through ask_other_ai (GPT-6.1 Sol when Claude wrote), long reading through Gemini, self-contained code drafts through GPT-6.1 Sol with Claude applying and running the tests, and every piece ends with report_result, so the panel (`or16`) shows the saving with real numbers.
- [x] **important:** Watch the outside AIs' versions `or15`
  - Done 2026-10-11 (the commit that carries this line): `server/ai/versions.mjs` asks each company that has a key for its model list at most once a day (a failed look is retried after 6 h; `POST /api/ai/versions/check` is the look on demand, one a minute at most), writes `ai-versions.json` and warns when a model in use is gone, announced to retire (OpenAI `shutdown_date`, OpenRouter `expiration_date`) or has a newer sibling; the warnings show in `list_other_ais`, the conductor's prompt, a "Versions" line per AI in the Other AIs window and one alert per change; an hourly timer started by `start()` runs it. The list calls carry no tokens, but no official page gives them a price, so they are called "not billed per token", not "free". The code set grew from 15 to 22 tasks (so code now counts in the routing), the bench got `--redo`, `--new-money` and the opt-in `openai:gpt-6-astra`, and the re-run (GPT-6 Astra on everything, Gemini 3.8 Flash redone, the 7 new code tasks for all) cost US$ 1.67 of the US$ 4 cap and rewrote `routing.json`. Not built yet: re-running the bench by itself when a model changes, and the scheduled price re-check.
  - Refinements kept here (2026-10-11): measure GPT-6 Astra; re-measure Gemini 3.8 Flash with its new request settings; grow the bench's code set from 15 to 20+ tasks so code results count in the routing (MIN_MEASURED 20).
  - Once a day, ask each provider for its model list and warn when a model in use disappears, is scheduled to retire or changes the version behind its name (e.g. `deepseek-flash`); re-run the bench on just that model under a small cap so the routing follows; re-check prices on a schedule (Gemini 3.8 Flash doubles on 2027-01-01). Asked on 2026-10-10 ("as API tem versao?") after OpenAI's gpt-6 models started refusing `max_tokens`.
- [ ] **in progress · detail:** Arsenal: the conductor calls the right AI for each task `or11`
  - First piece (2026-10-10): an "ask another AI" tool in every Claude Code conversation (an MCP server that goes through session-map, so keys, caps and costs stay in one place).
  - The other AIs are Claude's subagents: Claude reads the task, decides, hands a piece to the right AI (it answers with a draft or a patch), checks it, runs the tests and only then accepts. Every handoff shows in session-map (which AI, what task, cost, accepted or refused).
  - Later: other AIs working on their own in an isolated copy of the project (Codex CLI, Gemini CLI, Claude Code pointed at DeepSeek), after the text subagents prove themselves. This is step 4 of `id93` ("jeito 1"), led by the chat work: build it there, not twice.
  - A studio where Claude is the conductor and calls the right AI for video, image, voice, bulk text and code, with the right repositories and skills already chosen; session-map is the panel: each business area, what is being done, by which AI, at what cost. The board in `or09` is its central piece.
  - Seeds that exist: the Discover tab, the architecture map, costs per chat. First natural piece: Discover for every AI plus "which AI for each task" (`mm18`, `mm19`).
  - Risks: platform competition, quality of cheap AIs, privacy (data going to other providers), safety of third-party tools. Next step agreed: a strategy talk after v0.2 (audience, first slice, how it earns, separate product or evolution).
- [x] **detail:** Trial a cheap outside AI as a helper for bulk work `or12`
  - Done 2026-10-10 (589249c): first run US$ 6.99 in total. Claude was the most reliable everywhere (Sonnet the best reviewer, 20/20); GPT-6.1 Sol strong on code and Portuguese; Gemini 3.8 Flash the best cheap one; DeepSeek fixed (thinking off) but too many false alarms in review. Growing the code set and re-measuring go on in `or15`.
  - 2026-10-10: a measuring bench with session-map's real tasks (classify, write code against tests, find planted bugs, plain Portuguese), run on each Claude level and each outside AI with a key; reports accuracy and cost per correct answer.
  - Audit first; measure cost against quality before trusting it.


### Economy and brakes

- [x] **important:** A monthly spending cap by default, so a project never runs with no brake `or20`
  - A default monthly limit (a number the owner can change) that pauses new spending past it, instead of the Autonomous way running until the credits end. Without it, a single chat can burn thousands of dollars.
  - From `id103`.
  - Built on 2026-10-13: `DEFAULT_REINFORCED_MONTHLY_USD = 30` in `server/chat/run.mjs`; `reinforcedLimit` returns it when the owner never set one. Tests updated.
- [x] **important:** The conductor stops when the item is done: tick it `[x]`, report, and do not keep working `or21`
  - Today the Autonomous way keeps going after the work is finished, spawning more agents and burning tokens. When the item is ticked, the conductor summarizes and ends the turn instead of starting something new.
  - From `id104`.
  - Built on 2026-10-13: the Autonomous prompt now ends the turn once the request is done, instead of starting new work (`server/chat/run.mjs`).
- [ ] **in progress · important:** The conductor routes skills like it routes models: the right skill, at the right time, only what that task needs `or22`
  - The same decision that picks the model picks the skill, and hands the chat only the relevant skill(s) instead of leaving the whole skill list always in context.
  - From `id100`.
  - Built so far (2026-10-13): a chat opened on a part gets only the few skills whose words fit the request (`server/foundation/skills-focus.mjs`, via `server/chat/context.mjs`). Missing: the conductor choosing the skill per task.
