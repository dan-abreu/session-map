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

## Rules that must not break

- Never write outside `~/.claude/session-map/`.
- Never execute through a shell: `execFile` only.

## What's missing

### Formats

- [x] **Claude:** Keep all Claude Code format knowledge in `server/sources/claude.mjs` `rd01`
- [x] **Claude:** Read the waiting questions out of the cards from the board skill `rd02`
- [ ] **detail:** Read OpenSpec changes from other tools' task files too `rd03`
- [x] **Claude:** Archive every conversation, read only when asked `rd05`
  - A compressed copy outside the folders Claude Code cleans, by a scan and the `SessionEnd` hook; an index with no AI; History on the page; `/session-map:history` answers with at most 5 short matches. Released in v0.1.0.
- [x] **Claude:** The skills installed in each project `rd06`
  - User, project and plugin skills with origin, on or off, and the command that calls each. Released in v0.1.0.
- [x] **Claude:** Who did what: commits, pushes, merges and tags `rd07`
  - Author and AI co-author of each commit, the chat that made it, pushes from the reflog, merges and tags, branches ahead of main with their owner and their join into main. Released in v0.1.0.
- [x] **Claude:** Discover: repositories of skills and plugins from GitHub `rd08`
  - Sorted by stars, with what each is for, type and category, an "installed" mark and an install that always asks first. Released in v0.1.0.

### Sources

- [ ] **with the owner:** Import the claude.ai history `rd04`
  - Proposed, waiting for the owner's OK. The official "Export data" zip (`conversations.json`) dropped on the page: the chats enter the archive with a "claude.ai" badge, searchable, tied to a project by the AI (only title and summary go to the AI).
  - Origin badges in the list: VS Code, Terminal, Map, Phone (Remote Control), claude.ai.
