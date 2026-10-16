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
- `./package.json`
- `./README.md`
- `./README.pt-BR.md`
- `./CHANGELOG.md`
- `./CONTRIBUTING.md`
- `./SECURITY.md`
- `./CODE_OF_CONDUCT.md`
- `./LICENSE`
- `./.gitignore`
- `./.gitattributes`
- `.github/`
- `.githooks/`
- `docs/README.md`
- `docs/images/`
- `demo/`
- `test/skills-plain.test.mjs`

## Rules that must not break

- Needs Node 20 or newer and nothing from npm.
- The hook never blocks the end of a chat.

## What's missing

### Distribution

- [x] **Claude:** One-step install from the marketplace `pt01`
- [ ] **later · important:** Listing in more plugin directories `pt02`
  - Parked on 2026-10-16 (triage): after the release.
- [ ] **later:** Open the map like a program: it turns on with Windows, a watcher brings it back, and the page installs as an app `pt07`
  - Parked on 2026-10-16 (triage): the request `id86` is on hold (later).
  - Task Scheduler entry at logon plus a watcher (`session-map install-startup` / `uninstall-startup`, no admin), a web app manifest with the map's icon, and a "turning on…" screen. From request `id86`; later.
- [x] **Claude:** A text view for people who use only the terminal `pt06`
  - `node server/cli.mjs` prints the map with working, quiet and waiting marks, "Waiting for you" and costs; `--watch`, `--project`, `--json`. Released in v0.1.0.

### Plain language

- [x] **Claude:** Plain-language skill replies and terminal view `pt03`
  - The replies of `/session-map:map`, `:board`, `:history` and `:architecture` and the text view (`server/cli.mjs`) use simple words and say what to do, never raw codes. Part of the round in `mm11`.
- [x] **Claude:** Lay step-by-step READMEs in English and Portuguese, with real screenshots `pt05`
  - Install and first use, written for someone who does not code.

### Architecture and Flow together

- [x] **Skill `architecture` requires updating both the architecture and the Flow** `pt04`
  - A new feature, part or link means an item or part in the architecture and a box or arrow in the Flow; a small task is only an item (it shows in the Flow as a signal). Applies in every chat, VS Code included. Part of `fl12`.
