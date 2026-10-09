# Plugin and terminal

How the plugin reaches Claude Code: three commands, the architecture skill, the hook that archives finished chats, and the text view for the terminal.

## How it works

The `map` command starts the server and prints the links. `board` makes the current chat write a short card; `history` searches the archive; the `architecture` skill teaches every chat the convention, VS Code included. The hook copies a chat into the archive when it ends. `node server/cli.mjs` prints the tree as text.

## Where in the code

- `.claude-plugin/`
- `skills/`
- `hooks/hooks.json`
- `scripts/`
- `server/cli.mjs`

## Rules that must not break

- Needs Node 20 or newer and nothing from npm.
- The hook never blocks the end of a chat.

## What's missing

### Distribution

- [x] **Claude:** One-step install from the marketplace `pt01`
- [ ] **important:** Listing in more plugin directories `pt02`
- [x] **Claude:** A text view for people who use only the terminal `pt06`
  - `node server/cli.mjs` prints the map with working, quiet and waiting marks, "Waiting for you" and costs; `--watch`, `--project`, `--json`. Released in v0.1.0.

### Plain language

- [x] **Claude:** Plain-language skill replies and terminal view `pt03`
  - The replies of `/session-map:map`, `:board`, `:history` and `:architecture` and the text view (`server/cli.mjs`) use simple words and say what to do, never raw codes. Part of the round in `mm11`.
- [x] **Claude:** Lay step-by-step READMEs in English and Portuguese, with real screenshots `pt05`
  - Install and first use, written for someone who does not code.

### Architecture and Flow together

- [ ] **Skill `architecture` requires updating both the architecture and the Flow** `pt04`
  - A new feature, part or link means an item or part in the architecture and a box or arrow in the Flow; a small task is only an item (it shows in the Flow as a signal). Applies in every chat, VS Code included. Part of `fl12`.
