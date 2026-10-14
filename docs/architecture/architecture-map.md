# Architecture map

The convention that makes a project's architecture a folder of plain markdown: a README with the layers, one file per part, and a checklist per part. This part finds the folder and reads it; it never writes it. Chats write the folder by following the `architecture` skill.

## How it works

`detectArch` picks the folder (`docs/arquitetura`, `docs/architecture` or `docs/arch`, or the one in the config), from the working tree or, failing that, from the main branch (`origin/main` when the local one is behind it). `parseArch` turns the files into layers, parts, groups and items, in Portuguese or English. `attach` hangs chats and branches on the parts. New items, progress marks and ticks come from the chats, which follow the rule that goes with every chat opened on the map and the `architecture` skill.

## Where in the code

- `server/arch/`
- `docs/architecture/README.md`
- `test/fixtures/arch-en/`
- `test/fixtures/arch-pt/`

## Rules that must not break

- Reading never changes the files; the server does not write the architecture folder.
- A map read from the main branch is shown, and chats are told not to edit it in that folder.
- A part never loses its items because a line was not understood.

## What's missing

### Reading

- [x] **Claude:** Layers from a mermaid block or from `##` headings `am01`
- [x] **Claude:** English and Portuguese section names and tokens `am02`
- [x] **detail:** Tables in a part file as items `am03`

### Writing

- [x] **important:** A clerk robot writes the map, in a fixed order; the AI only supplies the words `am04`
  - Built on 2026-10-13: `server/arch/clerk.mjs` (six calls, checked order, safe writer), the six `map_*` tools in `server/ai/arsenal-mcp.mjs`, the Edit/Write/MultiEdit denial in `server/chat/guard.mjs` (`SESSION_MAP_CLERK=off` is the way out), a paragraph in `skills/architecture/SKILL.md`.
  - Today the program only reads the map: every request, item, code, new part (balloon) and flow link is an AI editing markdown by hand, so it forgets marks, skips the order or picks a wrong code.
  - The clerk takes structured calls and writes the files itself: a request (the person's words, date, meaning, how to confirm), then its items in the right part and group with the next free code, the links back ("Where it went", the index line), a new part as its own file plus the README table and a node in the flow diagram, a new link between parts as an arrow in the same change, the in-progress mark when work starts (`sb13`), the tick only after the turn's OK (`or26`). It checks the order and refuses what breaks it: an item with no request, a duplicate code, a part missing from the flow.
  - The AI chooses only the meaning: which part, the title, the detail lines (a cheap model is enough). Chats started by session-map get the clerk as tools; a direct edit of the plan files from those chats is denied and points to the tools, the way the guard holds agents (`or25`).
  - From `id113`.
