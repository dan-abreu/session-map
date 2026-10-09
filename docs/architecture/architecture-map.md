# Architecture map

The convention that makes a project's architecture a folder of plain markdown: a README with the layers, one file per part, and a checklist per part. This part finds the folder and reads it; it never writes it. Chats write the folder by following the `architecture` skill.

## How it works

`detectArch` picks the folder (`docs/arquitetura`, `docs/architecture` or `docs/arch`, or the one in the config), from the working tree or, failing that, from the main branch (`origin/main` when the local one is behind it). `parseArch` turns the files into layers, parts, groups and items, in Portuguese or English. `attach` hangs chats and branches on the parts. New items, progress marks and ticks come from the chats, which follow the rule that goes with every chat opened on the map and the `architecture` skill.

## Where in the code

- `server/arch/`

## Rules that must not break

- Reading never changes the files; the server does not write the architecture folder.
- A map read from the main branch is shown, and chats are told not to edit it in that folder.
- A part never loses its items because a line was not understood.

## What's missing

### Reading

- [x] **Claude:** Layers from a mermaid block or from `##` headings `am01`
- [x] **Claude:** English and Portuguese section names and tokens `am02`
- [ ] **detail:** Tables in a part file as items `am03`
