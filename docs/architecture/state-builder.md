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
- `server/placements.mjs`
- `server/footprint.mjs`
- `server/changes-state.mjs`
- `server/snapshots.mjs`
- `server/workflows.mjs`
- `server/store.mjs`

## Rules that must not break

- The AI sees a digest of a conversation, never the transcript.
- With the AI off, everything still works: chats are placed by the files they touch.

## What's missing

### Placement

- [x] **Claude:** Place a chat by the item code it cites, then by files, then by the AI `sb01`
- [x] **Claude:** Relate parts that share chats, branches or file links `sb02`
- [ ] **important:** Show why a chat was placed where it is `sb03`

### Cost

- [x] **Claude:** Estimate cost from the tokens in local history `sb04`
- [ ] **Savings report in the Costs tab** `sb05`
  - Cost per task and per model, with suggestions: a long chat should become a new one opened from the map; a task that would fit a smaller model.

### Later (ideas, not committed)

- [ ] **detail:** Explain a project that looks empty but shows a high 30-day cost `sb06`
  - Say "chats older than 24 h are in History" or show the recent ones that were deleted.
- [ ] **detail:** Other AIs for session-map's own AI tasks `sb07`
  - A DeepSeek, Gemini or OpenRouter key in place of the cheap Claude model.
