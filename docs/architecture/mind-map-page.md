# Mind map page

The browser page: a tree from the project through layers and parts to groups and items, with the chat docked on the right. On a phone the same tree is an indented list.

## How it works

Plain ES modules and a vendored `d3` for zoom and drag, no build step. Clicking a box opens its panel and a chat on that point. A green dot pulses where a chat is working; "Show relations" draws dotted lines between related parts; "What changed" lights today, 7 or 30 days. Open or closed state, search and zoom are remembered per project.

## Where in the code

- `server/web/`

## Rules that must not break

- English and Portuguese texts stay in step.
- Every state works without hover and respects reduced motion.

## What's missing

### Views

- [x] **Claude:** Mind map and an outline for phones `mm01`
- [x] **Claude:** Board as columns of items `mm02`
- [ ] **detail:** Drag an item to another part `mm03`
