# Architecture map

The convention that makes a project's architecture a folder of plain markdown: a README with the layers, one file per part, and a checklist per part. This part reads it, tells where it lives, and is the only code that writes it.

## How it works

`detectArch` picks the folder (`docs/arquitetura`, `docs/architecture` or `docs/arch`, or the one in the config), from the working tree or, failing that, from the main branch. `parseArch` turns the files into layers, parts, groups and items, in Portuguese or English. `addItem` and `setStatus` change one line and leave every other byte alone. `attach` hangs chats and branches on the parts.

## Where in the code

- `server/arch/`

## Rules that must not break

- Writes stay inside the architecture folder; a path that leaves it is refused.
- Reading and writing again must give back the same file.
- A part never loses its items because a line was not understood.

## What's missing

### Reading

- [x] **Claude:** Layers from a mermaid block or from `##` headings `am01`
- [x] **Claude:** English and Portuguese section names and tokens `am02`
- [ ] **detail:** Tables in a part file as items `am03`

### Writing

- [x] **Claude:** Add an item with the next free code `am04`
- [x] **Claude:** Change an item's status `am05`
- [ ] **important:** Move an item to another group `am06`
