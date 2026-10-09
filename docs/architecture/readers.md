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

## Rules that must not break

- Never write outside `~/.claude/session-map/`.
- Never execute through a shell: `execFile` only.

## What's missing

### Formats

- [x] **Claude:** Keep all Claude Code format knowledge in `server/sources/claude.mjs` `rd01`
- [x] **Claude:** Read the waiting questions out of the cards from the board skill `rd02`
- [ ] **detail:** Read OpenSpec changes from other tools' task files too `rd03`
