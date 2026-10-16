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
- `server/lookstate.mjs`
- `server/newproject.mjs`
- `server/restart.mjs`
- `test/server.test.mjs`
- `test/server-edits.test.mjs`
- `test/server-logs.test.mjs`
- `test/server-look.test.mjs`
- `test/server-place.test.mjs`
- `test/server-requests.test.mjs`
- `test/server-state-etag.test.mjs`
- `test/main-links.test.mjs`
- `test/catalog-server.test.mjs`
- `test/catalog-install.test.mjs`
- `test/actions-files.test.mjs`
- `test/restart-teams.test.mjs`
- `test/project-isolation.test.mjs`

## Rules that must not break

- No token, no write, no read from outside the machine.
- Files are served read-only, text only, never `.git` and never `.env`.
- The token never lands in a captured log: the "listening" line prints the links whole only to an interactive terminal
  (where the person copies them); a log file gets the key masked (`listeningLinks` in `server/main.mjs`). The
  `/session-map:map` skill hands the real links through `scripts/links.mjs`, so nothing the person needs is hidden.

## What's missing

### Testes quebrados no working tree (14/10/2026)

- [x] **Claude:** `test/files.test.mjs` falha (1 asserção, "safeResolve refuses a link that leads out of the root") `sv23`
- [x] **Claude:** `test/user-hooks.test.mjs` falha (1 asserção, "--user skips at once with SESSION_MAP_PAGE_CHAT=1") — os ganchos mudaram no trabalho não commitado `sv20`
- [x] **Claude:** `test/server-flowmodel.test.mjs` falha (1 asserção, "the model is read on this PC without the key") `sv21`
  - Closed on 2026-10-15: the suite passes again (checked: the test file runs green).
- [x] **Claude:** `test/readme-shots.test.mjs` falha (1 asserção, "without Chrome the script says so and exits 2") `sv22`

### Safety

- [x] **Claude:** Token cookie, CSRF header and an action log `sv01`
- [ ] **later · important:** HTTPS for the network link without Tailscale `sv02`
  - Parked on 2026-10-16 (triage): the owner already put it on hold on 2026-10-10 (`op06`).
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

- [x] The page asks "anything new?" and gets almost nothing back when nothing changed `sv09`
  - Closed on 2026-10-16 (triage): measured on the running server, a poll with nothing new answers 304 Not Modified with 0 bytes.
  - Today every open page downloads the whole state (1.9 MB) every 5 seconds. From `id84`.
- [x] The server's heavy jobs (git, re-reading projects) wait in a short queue instead of piling up `sv10`
  - Closed on 2026-10-16 (triage): measured, 0 "git too slow" events in the 2 last days of the server log; reopen if the error comes back.
  - Today the error log fills with "git too slow": many git commands at once until they time out. From `id84`.

- [x] **important:** The shared context (rules, CLAUDE.md, architecture) stays small and byte-identical, so prompt caching hits and every agent pays a cache read instead of a full read `sv17`
  - Read in full once, then paid as a cheap cache read by every other agent of the same project. The prefix must be stable and shared, not rebuilt per chat or per agent.
  - Measured on 2026-10-13 (waste signals, `or24`, last 7 days): of the tokens an agent took in on its first turn, only 18% were paid as cache read and 82% as cache write (6.1M read against 28.1M written over 877 agents), so identical prefixes do not yet clearly hit the cache; not ticked.
  - Measured again on 2026-10-16 (`node scripts/cache-share.mjs`, last 7 days, 545 agents), and the 2026-10-13 reading was corrected: the start IS identical. When another agent of the same model had started in the five minutes before, 74 % of the agents found the shared start in the cache (371 agents); when none had, 20 % did (174 agents). The 82 % written was the cache expiring between agents (Claude Code writes the five-minute cache for them: 0 one-hour writes), not a prefix that changes. Nothing in session-map's own code was found to break the prefix; the rest is Claude Code's system prompt and tools, which differ by agent type and model. `server/ai/cache-share.mjs`, `test/cache-share.test.mjs` (3).
  - The one lever left is the cache's life, parked as `sv24`.
  - From `id102`.
- [ ] **later:** Ask Claude Code for the one-hour cache for the agents it starts, try it on one project and measure `sv24`
  - Claude Code has `ENABLE_PROMPT_CACHING_1H` (v2.1.108; the release notes and the issue tracker disagree on whether it works for every kind of login, and nothing found says if it reaches subagents). A write to the one-hour cache costs about twice the base input price, against 1.25 times for five minutes, so it pays only when agents of a project come back within the hour: the first turn of 174 of 545 agents found a cold cache. Parked because it changes what the owner spends and its effect on subagents is unknown: try it on one project for a day with `node scripts/cache-share.mjs`, keep it if the cold share falls and the cost does not rise.
- [x] **important:** The server's own look at the PC costs about 15 % of a core when nobody uses the page, not 35 % `sv25`
  - From `id84` ("a CPU low with the map open"). Measured on 2026-10-16 with a CPU profile over Node's inspector (40 s of the idle server, no page open): 21 to 47 % of one core in steady state (35 % on average, 635 MB), because the watcher recomputes the whole state every 10 s (`WATCH_MS`). The profile named the four costs: `ownersOf` worked out the owner of every entry of a month of changes (tens of thousands of paths, most of them repeats, with a test-file match that is quadratic in the list); `changeRows` walked every save for every change and every unsaved file against every row; every project's skills were read from disk twice at each look; `priceKeyFor` matched every message of a month against the price table. Fixed with answers that cannot change: `ownersOf` answers each distinct path once and keeps the last 8 answers (`server/arch/attach.mjs`); `changeRows` finds the first save by halving (and falls back to the plain walk if the times are not in order) and indexes the unsaved rows by file (`server/changes.mjs`); a SKILL.md is read again only when its size or time changes (`server/sources/skills.mjs`); a model name is matched once per price table (`server/cost.mjs`).
  - Result, measured the same way: 9 to 28 % of one core in samples of 15 s, 15 % on average (against 21 to 47 %, 35 % on average, before); a profile of the same 40 s shows 16 % busy against 35 to 46 %, and the price match, the last of the four, was fixed after it. The first minutes after a start are heavier on purpose: the changes of the last month (3.7 GB of transcripts on this PC) are read over several passes (`READ_BUDGET_MS`).
  - Proof: `test/arch-attach.test.mjs` (the memo, the repeats, forty thousand entries in under two seconds), `test/changes.test.mjs` (the same save as the plain walk on 3 000 random changes and 300 saves), `test/skills.test.mjs` (a file read again only when it changes), `test/cost.test.mjs` (the key memo).
- [x] **important:** Each project is its own world: session-map writes only in its own folder under the project's id and, through one guarded door, in the project's repository `sv26`
  - Asked by the owner on 2026-10-16 ("o session mexe no repositório só do projeto que ele tá, tem que ser bem organizado"); `docs/adr/0007-each-project-is-its-own-world.md`. Where the program writes, checked in the code: (1) its state folder `~/.claude/session-map/brain/<project id>/` (the Foundation round, the model, the care proposals and undo, the project's diary); (2) the project's repository only through `applyOp` (`server/foundation/care.mjs`), which refuses a path outside the folder, in `.git`, or a secret file, and obeys the project's care mode; the Flow's Apply and the Requests review go through it; (3) the map clerk (`server/arch/clerk.mjs`), for the chat of that project, under `docs/architecture/`; (4) a git snapshot ref `refs/session-map/safety` and an isolated worktree for another AI's run (`server/chat/safety.mjs`, `server/ai/agents-run.mjs`), both in the repository the chat was opened on; (5) a new project's own new folder (`server/newproject.mjs`); and the user's own `~/.claude/settings.json`, not a repository (`server/chat/mode.mjs`). A round never writes in the repository it reads. The registry of a request is the project's own file: a map that points outside the folder is not followed (`requestStatusOp`).
  - Proof: `test/project-isolation.test.mjs` (3): a round for one project leaves every repository as it was and writes only under `brain/<its id>/`; a decision on a request changes that project's registry and nothing of another project with the very same codes; a registry or a hand-made operation that climbs out of the folder, by `..` or by an absolute path, is refused. Checked on the owner's three projects (cverino, surigo, dnd_mmorpg): the measurements of this week were read only, and `git status` of each shows nothing changed.
  - "Tudo em dia?" looks at one project at a time too (the owner's words, 2026-10-16: "uma engrenagem, mas sem misturar"). The round of a project reads its own folder and keeps its files under its own id; the sweep of the projects being worked on (`sweepProjects`, `server/foundation/refresh.mjs`) gives each one a try of its own, so a project whose round fails is logged under its id and the next one is still read (before, one failure stopped the rest). Checked on the real projects, one round each (session-map, cverino, surigo, dnd_mmorpg): no line cites a file of another project; the only files cited outside a working folder are the same project's own (its map on the main branch, or its own registry kept in session-map's folder). `test/project-isolation.test.mjs` (now 5): the lines of a project are the same with another project around, and cite only its own folder; a failing project does not stop the sweep.
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

### The second engine

- [x] **DeepSeek:** The DeepSeek Harness joins Claude Code when its folder exists `sv18`
  - From `id119`. `node server/main.mjs` turns DeepSeek on by itself when `~/.dsh` exists and Node can read its zstd logs (22.15+); `--dsh-dir <folder>` points at another folder, and a log line says why it stayed off otherwise. The `open` action of a DeepSeek conversation opens the app through its registered `dsh://open` protocol (starting the app when it is not running); the place, delete, archive and history routes accept the `session-<uuid>` ids of both engines, always checked against the same rules.

### The professional log

- [x] **Claude:** One professional, machine-readable log of everything the program does, for other AIs `sv19`
  - From `id125`. `server/log.mjs` writes every event as one JSON line to `smDir/logs/session-map-YYYY-MM-DD.jsonl` (one file per local day, pruned after 30 days), next to the stderr line it writes today; the schema (v1: `v`, `ts`, `level`, `event` and the event's fields) is documented in `logs/schema.json`. Before the file write, fields named like secrets are dropped and string values are masked (`ai/redact.mjs`), so the page token never lands in a file; a failed write is reported on stderr and never stops the server. The action log's lines join the same file.
  - `GET /api/logs` (the key, like the Changes) reads the newest lines, filtered by `?since=`, `?level=`, `?event=` and `?limit=`; `GET /api/logs/projects/<id>` reads one project's record (`wa11`).
  - Built on main on 2026-10-14 (the file sink turns on with the next restart of session-map, never in `--demo`); 10 log tests and 4 route tests green.

### Later (ideas, not committed)

- [x] **detail:** "Look only" link: a second key with no chat and no buttons `sv04`
  - To show the live map to another person.
- [x] **detail:** With the look-only link, the page also hides Home, Conversations and Foundation, whose reads the server already refuses `sv11`
- [ ] **later · detail:** The Flow also shows with the look-only link: the page asks for its drawing (`/mermaid`) through a read the look-only key may use `sv12`
  - Parked on 2026-10-16 (triage): weight detail.
- [ ] **later · detail:** Team plan in the cloud: a brain shared between machines `sv05`
  - Parked on 2026-10-16 (triage): the owner already put it on hold on 2026-10-10 (`op06`).
  - Validate with an interest list after launch; nothing of it goes into v0.x.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
