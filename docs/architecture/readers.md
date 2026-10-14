# Readers

Everything the plugin knows comes from files on this PC. The readers turn those files into plain objects and nothing else: sessions and transcripts from Claude Code, branches and commits from git, skills, roadmaps, OpenSpec changes, the archive of finished chats and the config.

## How it works

Each reader answers one question and fails soft: a missing file or a failing `git` call becomes an empty answer, never an error. Everything that depends on Claude Code's private formats lives in one file, so a format change is a one-file fix.

## Where in the code

- `server/sources/`
- `server/paths.mjs`
- `server/archive.mjs`
- `server/config.mjs`
- `server/parse/`
- `server/changes.mjs`
- `server/imports.mjs`
- `server/catalog-classify.mjs`
- `test/fixtures/claude/`

## Rules that must not break

- Never write outside `~/.claude/session-map/`.
- Never execute through a shell: `execFile` only.

## What's missing

### Formats

- [x] **Claude:** Keep all Claude Code format knowledge in `server/sources/claude.mjs` `rd01`
- [x] **Claude:** Read the waiting questions out of the cards from the board skill `rd02`
- [x] **detail:** Read OpenSpec changes from other tools' task files too `rd03`
- [x] **Claude:** Archive every conversation, read only when asked `rd05`
  - A compressed copy outside the folders Claude Code cleans, by a scan and the `SessionEnd` hook; an index with no AI; History on the page; `/session-map:history` answers with at most 5 short matches. Released in v0.1.0.
- [x] **Claude:** The skills installed in each project `rd06`
  - User, project and plugin skills with origin, on or off, and the command that calls each. Released in v0.1.0.
- [x] **Claude:** Who did what: commits, pushes, merges and tags `rd07`
  - Author and AI co-author of each commit, the chat that made it, pushes from the reflog, merges and tags, branches ahead of main with their owner and their join into main. Released in v0.1.0.
- [x] **Claude:** Discover: repositories of skills and plugins from GitHub `rd08`
  - Sorted by stars, with what each is for, type and category, an "installed" mark and an install that always asks first. Released in v0.1.0.

- [x] **important:** A skill list is an always-on token tax: show which skills are on and turn the unused ones off, so the list stays small `rd09`
  - Every installed skill's name and description sits in every context, every turn, every agent; with hundreds installed that costs more than the skills themselves. The page shows the count and a one-press off, and the conductor prefers the few skills it really needs.
  - From `id100`.
  - Built so far (2026-10-13): a Plugins tab per project lists each plugin, on or off, with its skill count (`listPlugins` in `server/sources/skills.mjs`). Missing: the one-press off.
  - Also on 2026-10-13 (mm52): each plugin shows its repository, on or off, skill count, listing weight and the weight of its SKILL.md files, and opened this week. Still open for rd09: the one-press off and the conductor preferring few skills; mm52 does not cover those.
  - Built on 2026-10-13: the Plugins tab has a Turn off / Turn on button per plugin (`switchPlugin` in `server/web/app.js`, `api.setPlugin`), after a confirm saying it applies to new chats; `POST /api/settings/plugin` (`pluginRoute` in `server/main.mjs`) calls `setUserPlugin` in `server/chat/mode.mjs`, which reads `~/.claude/settings.json`, changes only `enabledPlugins[id]`, keeps the layout and every other key, and writes atomically. The few-skills part is `pc29`.
### Sources

- [ ] **with the owner:** Import the claude.ai history `rd04`
  - Proposed, waiting for the owner's OK. The official "Export data" zip (`conversations.json`) dropped on the page: the chats enter the archive with a "claude.ai" badge, searchable, tied to a project by the AI (only title and summary go to the AI).
  - Origin badges in the list: VS Code, Terminal, Map, Phone (Remote Control), claude.ai.
