# State builder

Joins the readers' answers into the one state the page draws: projects, chats, branches, work in progress, costs, what waits for you, and the architecture tree with everything hung on it.

## How it works

`collect` reads every project, hangs each chat and branch on a part of the architecture (the owner's own move or rename first, then the rules), and works out costs and the "waiting for you" list. The AI step (your own `claude` CLI, `haiku`) names chats and picks a part for the ones the code cannot place; it is capped per hour and can be switched off.

Each conversation also gets its real footprint (`footprint.mjs`): every git repository and part whose files it, its helpers or its workflow agents edited, with the share of each. It stays listed at home and shows in the other projects as a visitor. Every file a conversation, its helpers or the folder changed becomes a row of the Changes tab (`changes-state.mjs`), kept on the server; the state only carries what lights the boxes. So a removed file still shows what it had, each pass keeps a masked copy of the files not saved yet that changed (`snapshots.mjs`), in the session-map folder only, never for a secrets file, for 30 days.

## Where in the code

- `server/collect.mjs`
- `server/ai/`
- `server/brain/`
- `server/cost.mjs`
- `server/statement.mjs`
- `server/placements.mjs`
- `server/footprint.mjs`
- `server/changes-state.mjs`
- `server/snapshots.mjs`
- `server/workflows.mjs`
- `server/store.mjs`
- `server/hidden.mjs`
- `server/prices.json`

## Rules that must not break

- The AI sees a digest of a conversation, never the transcript.
- With the AI off, everything still works: chats are placed by the files they touch.

## What's missing

### Placement

- [x] **Claude:** Place a chat by the item code it cites, then by files, then by the AI `sb01`
- [x] **Claude:** Relate parts that share chats, branches or file links `sb02`
- [x] **important:** Show why a chat was placed where it is `sb03`

### Cost

- [x] **Claude:** Estimate cost from the tokens in local history `sb04`
- [x] **Savings report in the Costs tab** `sb05`
  - Cost per task and per model, with suggestions: a long chat should become a new one opened from the map; a task that would fit a smaller model.
- [x] **Spend statement, reply by reply** `sb08`
  - From `id98`. `node server/statement.mjs [--days 30]` writes, in Documents/Extrato-Claude, one line per Claude reply (day, hour, project, chat, who answered: the chat or which agent, model, input / cache / output tokens and dollars, what it read just before, what it did), the sums by day, hour, project, model and chat, the account counter Claude Code caches (plan, weekly limit, extra usage spent and why it stopped) and the limit notices from the chats. Prices checked against the official table on 2026-10-11 (Sonnet 5.5 cache reads are $0.10; Haiku 5.5 pays more over 100K tokens).
- [x] **important:** The statement in the Costs tab: the same lines on the page, filtered by day, chat and agent, with a download `sb09`
  - From `id98`. A section of the Costs tab (`statementview.js`) over `statement-route.mjs`: the server reads the transcripts in the background, keeps what each file gave in `statement-cache.json` (a restart reads only what changed), and answers `/api/statement` (sums, chats with their helpers, the account's counter, the limit notices, reading progress), `/api/statement/rows` (pages of lines, filtered by day, chat, who or words) and `/api/statement.csv`; all three only with the page's token, never the look-only key.
- [x] **important:** The statement as guided bookkeeping: from the period's total down to each chat, then to who worked, which files it created or changed (with lines), what the money went on, and the replies `sb10`
  - From `id98` (2026-10-11 19:30). Three levels with a way back: the period (any day to any day) with one line per chat and its share; a chat with its cost in the period and since it began, its helpers, its files (created, changed, read; lines added and removed; the cost of the replies that touched them), the money by kind of work (thinking and writing, reading files, editing, running commands, calling helpers, searching) and by day, each section adding up to the same total; then the replies of whatever was opened.
- [x] **important:** The statement also counts what runs on its own: session-map's automatic work and the other AIs, with the lines read `sb11`
  - From `id98` (2026-10-11 20:10). The period opens with "who spent": the conversations with their helpers, session-map's automatic work (source "map" of `ai-activity.jsonl`) and the second opinions the conversations asked of other AIs (source "chat"), each opened by AI, by task and call by call (answered or failed, accepted or refused). session-map's own Claude calls leave no transcript, so `runner.mjs` now writes each one to the activity file too (from 2026-10-11 on). Each file read keeps how many lines came back: the period, each chat and each file show the lines read.
- [x] **important:** The statement laid out the way AI cost tools keep their books: key figures, spend by day, a cost-center tree and the entries with a running balance `sb12`
  - From `id98` (2026-10-11 20:15; researched first: FinOps showback by cost center, Anthropic's usage and cost page, Langfuse cost per trace with nested steps). Key figures (spent, average per day, pace of the last 7 days, average per conversation, extra usage charged), one bar per day, the cost centers as a tree (project ▸ conversation ▸ helper, then session-map's own work and the other AIs) with reading, writing, cost and share, and the entries (date, cost center, description, model, reading, writing, debit, running balance) filtered by whatever was picked. The explanations moved to hovers.

### Later (ideas, not committed)

- [x] **detail:** Explain a project that looks empty but shows a high 30-day cost `sb06`
  - Say "chats older than 24 h are in History" or show the recent ones that were deleted.
- [x] **detail:** Other AIs for session-map's own AI tasks `sb07`
  - Confirmed 2026-10-10 with the owner's real keys (OpenAI, Gemini, DeepSeek): calls go out, cost shows in Costs and in the panel (`or16`).
  - A DeepSeek, Gemini or OpenRouter key in place of the cheap Claude model.
  - Built on 2026-10-10: providers OpenAI (GPT), Gemini, DeepSeek and OpenRouter in one OpenAI-format caller (`server/ai/providers.mjs`); keys only in session-map's own folder, encrypted with Windows DPAPI (AES-GCM elsewhere), never sent back to the page or logged (`server/ai/keys.mjs`); e-mails, CPF/CNPJ, phones, cards and secrets masked before anything leaves the PC (`server/ai/redact.mjs`); only the bulk "place this chat" task may go to the helper, with a daily cap per provider, fallback to Claude on any failure, and Claude re-asking 1 in 5 answers, pausing the helper when it disagrees too often (`server/ai/helper.mjs`, `server/ai/review.mjs`); the "Other AIs" dialog and one row per provider in Costs (`server/ai/helperroute.mjs`, `server/web/aihelpers.js`).
  - How to confirm it is done: paste a real key in "Other AIs", press Test, turn it on for bulk work; new chats get placed by it, its cost shows in Costs next to Claude's, and "reviewed by Claude" grows.
