# The agents economical by law: brief cap, no re-reading, no whole big files

What it is, for an engineer who never saw this codebase: the guard (`server/chat/guard.mjs`) already holds each work agent — its role, model and level (`or33`/`or42`/`or55`), its tools and skills, and the senior entry gates (`or56`). This plan adds the economy as law (`id150`): an agent that reads half the world before working is the expensive agent, so the motor caps the brief at the call, keeps the map and the rules off the agent's reading list and denies the whole big file. One task per gate; the conductor itself keeps reading freely.

## File Structure

- `server/chat/guard.mjs` — the three gates, plus Read joining the guard's matcher.
- `hooks/hooks.json` and `scripts/install-user-hooks.mjs` — the same matcher in the plugin's own hooks.
- `test/guard-agent-choice.test.mjs`, `test/chat-guard.test.mjs`, `test/user-hooks.test.mjs`.

### Task 1: the brief cap: over 8 KB is denied at the Agent call

Files: `server/chat/guard.mjs`.

Test: `node --test test/guard-agent-choice.test.mjs` — a brief over `BRIEF_CAP_BYTES` is denied with `NO_BRIEF_LONG`; exactly at the cap passes.

Status: done 2026-10-15 — `NO_BRIEF_LONG` in `agentLevel`; the cap is one number the owner can tune.

### Task 2: an agent does not re-read the map, the rules or CLAUDE.md

Files: `server/chat/guard.mjs`.

Test: `node --test test/guard-agent-choice.test.mjs` — a Read of `docs/architecture`, `docs/standard` or `CLAUDE.md` inside an agent is denied with `NO_REREAD`; plan files and work files stay readable; the conductor reads freely.

Status: done 2026-10-15 — `guardAgentRead` with `REREAD_RE` (the first regex version missed `CLAUDE.md` on Windows paths; the test caught it and it was fixed).

### Task 3: a whole big file is denied inside an agent: a slice or the index

Files: `server/chat/guard.mjs`.

Test: `node --test test/guard-agent-choice.test.mjs` — a Read without offset/limit of a file over 64 KB is denied with `NO_WHOLE_FILE`; a slice, a small file and the cap itself pass; an unreadable file fails open.

Status: done 2026-10-15 — the size gate reads `statSync`, only when the call carries no offset or limit.

### Task 4: the guard sees the Read tool, in every copy of the hooks

Files: `server/chat/guard.mjs` (`guardSettings`), `hooks/hooks.json`, `scripts/install-user-hooks.mjs`.

Test: `node --test test/chat-guard.test.mjs` and `node --test test/user-hooks.test.mjs` — the matcher matches Read in the settings and in the plugin's hooks; Bash and PowerShell stay on their own matcher.

Status: done 2026-10-15 — the matcher gained Read in the three places; the shell matcher untouched.

Status: in progress 2026-10-15 (id150, or57).
