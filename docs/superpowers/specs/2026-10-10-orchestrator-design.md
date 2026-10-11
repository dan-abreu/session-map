# The orchestrator: one chat per project that opens, drives and follows the others (id90 → or01, or02, or03, or06, or17)

Approved by the owner on 2026-10-10 ("Sim, pode reforçar"). Builds on the Autonomous way and the agreed restart (`docs/superpowers/specs/2026-10-10-autonomous-design.md`). This file is the contract for the build.

## The owner's words

"eu quero que tipo o orquestrador abre os chats corretos manda os comandos corretos para ir fazendo sozinho, assim não sai caro as conversas e fica facil de acompanhar o que está acontecendo, porque vai ser feito mais de uma coisa e ela também pode tomar conta das conversas antigas que eu tinha e deixar alinhadas"

## What it is

- **One orchestrator per project** (`or01`): a page chat with node kind `orchestrator`, started at the project root, pinned on top of the project's conversation list and on the root box ("Orquestrador"). It starts from the compact project summary (`server/chat/project.mjs`) and runs the Autonomous way (Opus, high) plus an extra prompt section `ORCH_PROMPT` (compact; prompt + tail stays under ~5 KB). Opening it again resumes the same conversation (one per project, its session id kept in `page-chats.json` as the project's orchestrator).
- **Activity chats** (`or02`, `or06`): page chats on one item code, opened by the orchestrator through tools, with only that item's context (the existing item context from `context.mjs`, no project history) and the model and effort the orchestrator picks (the cheapest that does the item well; it may call `pick_worker`). They run the Autonomous way with that model: the run kind `autonomous` accepts an optional `model` (haiku | sonnet | opus | fable) and `effort` (from `EFFORTS`), default opus/high. Their `parentId` is the orchestrator's session id (lineage).
- **Older conversations** (`or17`): the orchestrator lists the project's conversations that are not live now and not driven by the hub, ties each to its item, continues the ones with work left (resume with its instructions), archives the ones that are done, and leaves to the owner what only the owner can do. It ends with a table: conversation, item, what it did.

## The tools (only for the orchestrator)

Added to the per-chat `sessionmap` MCP server (`server/chat/permission-mcp.mjs`), which already carries the chat's own secret and talks to the hub's in-process relay: the hub therefore knows exactly which chat calls, with no shared token. A call from a chat whose node kind is not `orchestrator` answers an error ("only the orchestrator opens and drives chats"), so an activity chat can never open chats (depth 1).

| Tool | Does |
|---|---|
| `list_chats()` | The orchestrator's activity chats: key, item code, title, model, state (working, finished, waiting, error, cut off), cost, last summary. |
| `start_chat({ code, instructions, model, effort })` | Opens an activity chat on that item code with the instructions as its first message. Errors: unknown code, limits (below). |
| `send_to_chat({ key, instructions })` | Sends the next instructions to one of its activity chats; if that chat is mid-turn, it is queued and delivered at its turn end. |
| `read_chat({ key, last })` | The last `last` (default 1, max 5) replies of one of its chats, folded to plain text, each capped at 4 KB. |
| `list_conversations()` | The project's older conversations not live now and not driven by the hub: session id, title, origin, item code, state, last step, card, updated, cost. At most 50, newest first. |
| `continue_conversation({ sessionId, instructions, model, effort })` | Resumes an older conversation with these instructions as an activity chat of the orchestrator (adopted: lineage recorded). Refuses one that is live in another window. |
| `archive_conversation({ sessionId, reason })` | Archives a finished one (the existing archive action); the reason is logged. |

## Results come back by themselves

- When an activity chat ends a turn, the hub puts a short note in the orchestrator's **inbox**: `[session-map: activity <code> (<model>) ended — <finished|waiting|error>, cost US$ x. Summary: …]`, built from the same folded summary the alerts use.
- The inbox is delivered as the orchestrator's next message as soon as the orchestrator is idle (several notes in one message). This is how it keeps working without the person: it wakes when results arrive. Notes are kept on disk (`smDir/orch-inbox.json`) so a restart loses none; delivery respects a pending restart (sv13 holds new turns).
- The page shows those auto-messages like the other session-map auto-answers (`msg-auto`).

## Limits (no runaway)

- At most **3 activity chats working at once** per orchestrator, and the orchestrators together never take the last **2** slots of `CHATS_MAX`, so the person can always open a chat. Past it, `start_chat` answers "limit: wait for one to finish" (the orchestrator then waits for its inbox).
- At most **30 activity chats opened or continued per orchestrator per day**.
- Activity chats cannot use the tools (depth 1).
- An automatic inbox delivery never chains more than **20** orchestrator turns in a row without a message from the person; past it, the orchestrator stops and says so (the person's next message resets it).
- Money: reinforced turns of every chat count toward the monthly limit as today; `list_chats` shows the orchestrator's total so far.

## Following it (`or03`)

- Conversation rows carry `parentId` (from lineage) and `node.kind`. In the conversation list, the orchestrator row is pinned first in the project and its activity chats are indented under it with item code, model, state and cost. The Now strip shows "Orquestrador: N trabalhando".
- The root box of the map offers "Orquestrador" (open or start it) next to the project chats chip.
- i18n keys in every language block, PT-BR in plain words.

## Organizing on its own (`or18`)

Asked the same day: "faz da melhor forma … quero deixar mais automatizado e a IA conseguir deixar mais organizado".
- A switch per project, **off until the owner turns it on in that project** (his choice on 2026-10-11): "Organizar sozinho" (kept in session-map's `config.json` under `projects.<root>.tidy`, like the other per-project keys), shown on the project's root panel next to "Orquestrador".
- The hub's scheduler (a timer every 5 minutes, injected clock in tests) sends the orchestrator a tidy pass when: the switch is on, no chat of the project is working, and either the last pass was over 24 h ago or 5 new conversations appeared since it. If the project has no orchestrator yet, the pass starts it.
- The pass message is fixed text from session-map: tie each conversation (not live) to its item, give unclear titles a clear name, archive the finished ones, continue the cut-off ones with work left, tick the items that are done and move the requests along, and end with a short note "Organized: …". It uses the same tools and limits above; the 20-turn chain counts it.
- Renaming: a new tool `rename_conversation({ sessionId, title })` using the existing rename action.

## The button by Send speaks plainly (`pc17`)

- Its menu shows three ways, one plain sentence each: **Autonomous** — "does everything on its own and lists its decisions; stops only past the monthly limit"; **Automatic** — "asks you before big work"; **Manual** — "you pick the model and level". Under them, folded under **Advanced**: the Manual ways, the permission mode and "use in every Claude on this PC". The monthly limit field stays with Autonomous and Automatic.
- The compact button reads like "Autônomo · Opus" (effort only shown inside the menu).

## Rules

- The orchestrator decides and acts on its own (the owner's choice, `id90`); the owner can stop any chat as today.
- session-map never approves a permission on the person's behalf; bypassPermissions is never used.
- Item ticking and request status stay the chats' job (the upkeep rule they already get).

## Tests (node --test, `npm test`)
- Tools via the relay with the fake claude: a non-orchestrator caller is refused; `start_chat` opens an item chat with the instructions, the model/effort asked and `parentId`; limits (3 at once, CHATS_MAX reserve, 30 per day) answer the limit message; `send_to_chat` queues while busy; `read_chat` caps sizes.
- Inbox: a child's turn end puts a note; delivered when the orchestrator is idle, batched; persisted across a hub restart; the 20-turn chain stops.
- `list_conversations` leaves out live and driven ones; `continue_conversation` refuses a live one and records lineage; `archive_conversation` archives.
- run.mjs: `autonomous` with model/effort (parse, args, expected).
- Tidy scheduler: fires only when the switch is on and the project is quiet, after 24 h or 5 new conversations; starts the orchestrator when missing; never twice in a row without a change; `rename_conversation` renames.
- Web: the list nests children under the orchestrator; the root box offers it and the "Organizar sozinho" switch; the menu by Send shows three ways with one sentence each and Advanced folded; i18n keys.
- The whole suite passes, or the failures are shown to be from other work in progress.
