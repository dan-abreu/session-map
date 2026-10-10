# Orchestration

A senior conductor chat per project that sees the whole map, hands focused work to activity chats, hears back from each one and weighs every proposal like a board would. It is the owner's single place to say what they want; the activity chats do the work.

## How it works

Each project gets one orchestration chat, pinned on top of the conversation list and on the root of the map. It starts from a compact summary of the project (architecture, open items per part, what waits for the owner, what is running, the latest decisions) instead of the whole history. When it starts a piece of work it opens an activity chat on the right item, with the model the Automatic mode picks, always after a confirmation. The activity ticks its item when done and reports back; when the orchestration grows long it summarizes and continues.

## Where in the code

- `server/chat/`
- `server/brain/`

## Rules that must not break

- Quality is rule number one; saving money is a consequence of choosing well, never the goal.
- An activity chat is started only after the owner confirms.
- Money, accounts, contracts and business priority belong to the owner: a recommendation plus a one-click confirmation.
- The mode `bypassPermissions` is never used.

## What's missing

### Chats

- [x] Project chats: general chats about the whole project, many per project, like Claude's "New chat" `or13`
  - "New chat" at the top of the map tools and of the conversation list, and a click on the root bubble, open a chat about the whole project in its root folder; the root bubble's panel lists the earlier ones to reopen.
  - The first message carries a compact summary built from the state (layers and parts with one line each and their open items counted, what is working now, what waits for the owner, recent decisions, last changes and versions; at most 3,800 bytes, never the history) and the rule that a new request becomes an item in the right part's "What's missing", with the flow changed alongside, citing item codes (`server/chat/project.mjs`).
  - Kept in page-chats.json with the point kind `project`; never pinned to one part by the codes or files it touches; listed under "Project chats" on top of the project's card (title from the first message, time, state, cost); resumes with its history, renames and archives like any chat.
  - How to confirm it is done: click the root bubble: the panel lists the project chats and offers a new one; send a message: the first prompt shows the summary under 4 KB, the chat opens in the project root and shows on top of the list in "Project chats" with its title, time, state and cost; "New chat" starts another; reopen the first from the list and continue it with its history; archive it and it leaves the list and the panel.
- [ ] **in progress · blocks:** Orchestration chat per project `or01`
  - First step done: the plain project chats (`or13`); the manager's powers below come next.
  - Pinned on top of the list and on the root node. Starts from the compact project summary, absorbs "New idea" (puts items in the right place), and when long it summarizes and continues (`--resume` with its own summary, or a chained new session).
  - First of the backlog once the foundation is done (the owner decided on 2026-10-09 that understanding the programs comes first; see the Foundation part, `fd11`).
- [ ] **blocks:** Activity chats started from the orchestration `or02`
  - A chat focused on one item of the map, started by a tool or a `POST /api/chat/start` per item, with the model chosen by the Automatic mode and always with confirmation.
  - When it ends it ticks the item in the architecture and posts its result in the orchestration thread (item, outcome, tests, what is left).
- [ ] **important:** The tree orchestration → activities in the list and the Now strip `or03`

### Senior conductor

- [ ] **Think before delegating** `or04`
  - Understand the request, look at architecture and Flow, break it down and order it. Pick the model for the quality the task needs (the strongest without hesitating when it asks), ask for a second opinion from the reviewer, call nothing "done" without proof, explain each decision.
  - Learn from mistakes by kind of task: go up a model where the light one erred.
- [ ] **Route by kind of task** `or05`
  - Bulk reading and inventory → Haiku low; ordinary analysis and code → Sonnet medium; decisions, security, review and second checks → Opus; huge manual work → a cheap outside AI when one is set up (`or11`).
- [ ] **Lean context for activity chats** `or06`
  - Each gets only its part's context; long chats are summarized automatically.
- [ ] **Monthly budget per project** `or07`
  - Alert at 80% and a polite pause at 100%.
- [ ] **Priority queue** `or08`
  - Urgent work first; detail inspection and Flow polish in the gaps. The important never stops at a limit (see `wa09`).

### Board of roles

- [ ] **The orchestration chat wears the roles of a board** `or09`
  - CEO and strategy, Product, Marketing, Finance, Operations and delivery, Technology (the senior conductor), Legal and privacy.
  - Every relevant proposal is analyzed from the angles that apply (value, cost to build and to run, return, timing, positioning, legal risk) and ends with a recommendation. It uses the `pm-product-strategy`, `pm-market-research` and `pm-product-discovery` skills when they fit, plus the real costs session-map already has.
- [ ] **Business view of the project** `or10`
  - Cost per feature, priority by impact × effort × cost, a delivery roadmap.

### Later (ideas, not committed)

- [ ] **detail:** Arsenal: the conductor calls the right AI for each task `or11`
  - A studio where Claude is the conductor and calls the right AI for video, image, voice, bulk text and code, with the right repositories and skills already chosen; session-map is the panel: each business area, what is being done, by which AI, at what cost. The board in `or09` is its central piece.
  - Seeds that exist: the Discover tab, the architecture map, costs per chat. First natural piece: Discover for every AI plus "which AI for each task" (`mm18`, `mm19`).
  - Risks: platform competition, quality of cheap AIs, privacy (data going to other providers), safety of third-party tools. Next step agreed: a strategy talk after v0.2 (audience, first slice, how it earns, separate product or evolution).
- [ ] **detail:** Trial a cheap outside AI as a helper for bulk work `or12`
  - Audit first; measure cost against quality before trusting it.
