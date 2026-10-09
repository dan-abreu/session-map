# Server

The local HTTP server that serves the page, the state and every action. It listens on `127.0.0.1` unless started with `--lan`.

## How it works

Reads need nothing from `127.0.0.1` (the state, the Flow drawing and its draft, the history search), except the ones that run code or show what a conversation read and ran (the chat, project files, a saved conversation, the settings), which keep asking for the token even here; every write, and every access from another address, needs the token (and a CSRF header for writes). Writes are recorded in an action log. `--demo` serves invented data and never touches the disk.

## Where in the code

- `server/main.mjs`
- `server/auth.mjs`
- `server/actions.mjs`
- `server/files.mjs`
- `server/launch.mjs`

## Rules that must not break

- No token, no write, no read from outside the machine.
- Files are served read-only, text only, never `.git` and never `.env`.

## What's missing

### Safety

- [x] **Claude:** Token cookie, CSRF header and an action log `sv01`
- [ ] **important:** HTTPS for the network link without Tailscale `sv02`

### Reach

- [x] **Claude:** `--demo` with invented data for screenshots `sv03`
- [x] **Claude:** Open, start, close and archive a chat from the page `sv06`
  - Open where it runs (VS Code or a terminal), a new chat on the same point, close only a stopped chat (checking the process still belongs to that session), archive and show archived; every action in the action log. Released in v0.1.0.
- [x] **Claude:** A part's files on the page, read-only, with Open in VS Code and Open terminal here `sv07`
  - New and changed files marked, the branch's changed lines highlighted, up to 1 MB, text only, never `.git` or `.env`. Released in v0.1.0.

### Later (ideas, not committed)

- [ ] **detail:** "Look only" link: a second key with no chat and no buttons `sv04`
  - To show the live map to another person.
- [ ] **detail:** Team plan in the cloud: a brain shared between machines `sv05`
  - Validate with an interest list after launch; nothing of it goes into v0.x.
