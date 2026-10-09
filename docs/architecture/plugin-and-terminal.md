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
