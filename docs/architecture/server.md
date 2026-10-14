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
- `server/log.mjs`

## Rules that must not break

- No token, no write, no read from outside the machine.
- Files are served read-only, text only, never `.git` and never `.env`.

## What's missing

### Safety

- [x] **Claude:** Token cookie, CSRF header and an action log `sv01`
- [ ] **important:** HTTPS for the network link without Tailscale `sv02`
  - Later, by the owner's choice on 2026-10-10 (`op06`).

### Reach

- [x] **Claude:** `--demo` with invented data for screenshots `sv03`
- [x] **Claude:** Open, start, close and archive a chat from the page `sv06`
  - Open where it runs (VS Code or a terminal), a new chat on the same point, close only a stopped chat (checking the process still belongs to that session), archive and show archived; every action in the action log. Released in v0.1.0.
- [x] **Claude:** A part's files on the page, read-only, with Open in VS Code and Open terminal here `sv07`
  - New and changed files marked, the branch's changed lines highlighted, up to 1 MB, text only, never `.git` or `.env`. Released in v0.1.0.
- [x] Archive and delete answer at once, on the newest finished state, never waiting for a collect of every project `sv08`
  - A conversation born since that state still waits for the next collect, so it is never "unknown"; open and close, which start or stop a process, always wait for a fresh state.

### Speed

- [ ] **in progress:** The page asks "anything new?" and gets almost nothing back when nothing changed `sv09`
  - Today every open page downloads the whole state (1.9 MB) every 5 seconds. From `id84`.
- [ ] **in progress:** The server's heavy jobs (git, re-reading projects) wait in a short queue instead of piling up `sv10`
  - Today the error log fills with "git too slow": many git commands at once until they time out. From `id84`.

- [ ] **important:** The shared context (rules, CLAUDE.md, architecture) stays small and byte-identical, so prompt caching hits and every agent pays a cache read instead of a full read `sv17`
  - Read in full once, then paid as a cheap cache read by every other agent of the same project. The prefix must be stable and shared, not rebuilt per chat or per agent.
  - Measured on 2026-10-13 (waste signals, `or24`, last 7 days): of the tokens an agent took in on its first turn, only 18% were paid as cache read and 82% as cache write (6.1M read against 28.1M written over 877 agents), so identical prefixes do not yet clearly hit the cache; not ticked.
  - From `id102`.
### Restart

- [x] A chat that needs to restart session-map agrees on the moment with the other chats, and every chat goes on by itself afterwards `sv13`
  - From `id89`. The restart waits until no chat is in the middle of a step (or each one saved where it was), and the chats it cut off continue without a click.
  - Built on 2026-10-11 (`server/restart.mjs`, `POST /api/restart`, the `restart_session_map` tool of the arsenal): one pending restart, fired when no page chat is mid-turn or after 10 minutes; the chats are resumed with a note by the new process. Not yet tried against the real server: the first real restart is its end-to-end test.

- [x] **Gemini (Antigravity):** A restart waits for the teams working in the background, and a chat whose team was cut resumes that team `sv16`
  - From `id99`. On 2026-10-11 restarts asked by other chats (19:10 and 19:41) killed the workflow a quiet chat was running: `sv13` waits only for chats mid-turn. The restart also waits while a chat's helpers still write (the same look as `pc12`), up to a limit; past it, the cut chat is told which team was cut and resumes it from where it stopped (the workflow's resume), on its own.
  - Implemented on 2026-10-13 by Gemini (Antigravity) while Claude Code credits were paused: `server/chat/teams.mjs` identifies cut workflows and background helpers, `server/restart.mjs` waits for background teams (up to 1 hour) before holding turns and includes cut team details in resume notes, with full unit test coverage in `test/restart-teams.test.mjs` and MCP tool support in `server/ai/arsenal-mcp.mjs`. Ready for Claude's review when credits return.

### New projects

- [x] Create a new project's folder and show it as a project before any conversation runs there `sv14`
  - From `id95`. `POST /api/projects/new` creates the folder (a safe name, inside a folder that exists, never over one that exists) and remembers it in the person's `config.json`; the map lists it until its first conversation makes it a project like the others.
- [x] A new project can also get its GitHub repository: private by default, with a first save sent `sv15`
  - From `id96`. Through the `gh` login already on the computer: checked before the folder is made (logged in, the name free on GitHub), then `git init`, a README, the first save and `gh repo create --source --push`. Nothing goes to GitHub unless the person chose it.

### Later (ideas, not committed)

- [x] **detail:** "Look only" link: a second key with no chat and no buttons `sv04`
  - To show the live map to another person.
- [x] **detail:** With the look-only link, the page also hides Home, Conversations and Foundation, whose reads the server already refuses `sv11`
- [ ] **detail:** The Flow also shows with the look-only link: the page asks for its drawing (`/mermaid`) through a read the look-only key may use `sv12`
- [ ] **detail:** Team plan in the cloud: a brain shared between machines `sv05`
  - Validate with an interest list after launch; nothing of it goes into v0.x.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
