# Autonomous way and the agreed restart (id89 → pc16, sv13)

Approved by the owner on 2026-10-10 (answers "b" and "A" in the project chat). This file is the contract for the build.

## The owner's words

"eu preciso das solitações finalizadas, se precisar muda depois de pronta … depois que o plano for feito só termina quando terminar mesmo, e se quer reiniciar o programa, uma conversa fala com a outra pra saber o tempo certo de reinicar, preciso de da um prompt e a IA já trabalhar mesmo fazendo logo tudo"

Decisions:
- The autonomous way stops **only** to spend past the monthly limit (`budget.reinforcedMonthlyUSD`). Publishing (push, a new version) and deleting it does on its own.
- Autonomous is the **default for every new chat**. Automatic and Manual stay as options.
- Safety net chosen by Claude (the owner agreed with the design): a recoverable snapshot before a destructive command, and never a force push.
- 2026-10-10, during the build: Claude Code's safety check refused a first design in which session-map approved every permission itself. The permissions now stay with Claude Code's own `auto` mode, and what it blocks is left for the owner in a final list instead of stopping the chat.

## Part 1 — the Autonomous way (`pc16`)

A new run kind `autonomous` in `server/chat/run.mjs`, next to `auto`, `maestro`, `ultracode`, `fixed`, `settings`.

### Behaviour
- Runs on Opus at high with an appended system prompt (`AUTONOMOUS_PROMPT`) built from the shared `ARSENAL` text plus:
  - Finish the request end to end in this conversation: understand, plan, build, test, review, publish if the request implies it. Once a plan exists, keep going until it is really done; never end a turn to ask what to do next.
  - Never ask the person a question (no AskUserQuestion, no "should I…?" at the end). When a choice comes up (taste, approach, naming, which option), take the one a senior would recommend, write it down and go on.
  - Gates of skills and rules that wait for the person's approval (designs, plans, "pick an execution method", the CLAUDE.md "ask about business/money" rule) are answered by the conductor itself, choosing the recommended option and recording it, **except** spending past the monthly limit.
  - Large or sensitive work runs the reinforced way on its own (workflow with adversarial verification) when the session-map tail says the monthly limit still has room for the estimate; when it does not, end the reply with level `ask-reinforce` and the estimate: that is the only stop.
  - End the final reply with a section "Decisions I took" (in the person's language: "Decisões que tomei"), one line each with the reason, so the person can ask to change any of them later.
  - To restart session-map, never kill or start its process: call the `restart_session_map` tool (Part 2).
  - Safety: never `git push --force`/`-f`/`--force-with-lease`; deletions are allowed (session-map snapshots first).
  - The same `session-map-run` block as Automatic, with levels `direct | helpers | reinforced | ask-reinforce`.
- The conductor tail (`tailFor` in hub.mjs) is sent to autonomous too, plus one line with the monthly reinforced limit and what is left (or "no monthly limit is set: ask before reinforcing").
- `endTurnRun`: for `autonomous`, an `ask-reinforce` is auto-answered (the existing `AUTO_REINFORCE` path, once per person message) whenever `mayReinforce({ selfReinforce: true, … })` allows it. Otherwise the turn stays waiting for the person (the alert says it waits for the budget).

### Permissions in the autonomous way
session-map never approves on the person's behalf. The safety decision stays with Claude Code's own `auto` permission mode (its classifier allows ordinary work and blocks what is dangerous or outside the request); what it blocks does not stop the conversation.
- An autonomous chat always runs with the CLI permission mode `auto` (already in `CHAT_MODES`), whatever the per-chat or PC-wide mode says; switching a chat to another run kind restores its own mode. `bypassPermissions` is still never used (rule of the Page chat part).
- In `hub.mjs` `ask()` (the `--permission-prompt-tool` relay), for a chat whose run kind is `autonomous`, nothing waits for a click:
  - `AskUserQuestion` → deny with the message: "Autonomous way: decide yourself, take the option you would recommend, note it under 'Decisions I took' and go on."
  - Any other permission that reaches the relay (something the auto mode would not decide alone) → deny at once with the message: "Autonomous way: the person is not asked mid-task. Do not retry this action; reach the goal another way if there is a safe one, otherwise leave it and list it at the end under 'Left for you' with the exact command or step." The page shows it as an informational line (state `deferred`), and it counts for the final list.
  - The prompt tells the conductor to end with a "Left for you" ("Ficou para você") section when anything was deferred.
- A force push is never done: the prompt forbids it, and `ask()` denies one in any run kind (`git push` with `--force`, `-f`, `--force-with-lease`, or a `+refspec`).
- Safety snapshot (a new small module `server/chat/safety.mjs`): when an autonomous chat's turn starts in a git repository, and again before the hub relays a destructive command it sees (`rm`, `rmdir`, `del`, `Remove-Item`, `git clean`, `git reset --hard`, `git checkout -- …`/`git restore` over files, `git branch -D`, `git stash drop/clear`), take a snapshot of the working tree: a commit of the whole tree (tracked and untracked, not ignored) built with a temporary index (`GIT_INDEX_FILE`), stored under `refs/session-map/safety/<timestamp>`, never touching the person's index, branch or working tree; keep the last 20 refs per repository. A failed snapshot only logs a warning; outside a git repo nothing is snapshotted. The final reply mentions the ref when something was deleted.
- Review fix (2026-10-11): `ask()` only sees what auto mode leaves to the relay, so the force-push denial and the pre-destructive snapshot are also enforced by a `PreToolUse` hook passed to every page chat with `--settings` (`server/chat/guard.mjs`, `guard-hook.mjs`; the snapshot only for autonomous). The hook only denies or says nothing; it never allows. The recogniser also reads `bash -c "…"`/`powershell -Command "…"`, subshells, git global options and abbreviated flags (`--force-w`, `--mirror`), and treats `git checkout .`/`-f`, `git switch -f`, `find -delete`, `mv` and `> file` as destructive.

### Default for new chats
- `DEFAULT_RUN` becomes `{ kind: 'autonomous' }` on the server (`run.mjs`) and the page (`chat.js`). A resumed conversation keeps its saved run (unchanged chain at hub.mjs ~586). The `auto` kind keeps `selfReinforce`.
- The run menu by Send gets three paths: **Autonomous** (default), Automatic, Manual. Autonomous shows the monthly limit field (the same one Automatic shows) and one plain line: "Does everything to the end, decides on its own and lists its decisions; stops only to spend past the monthly limit." The compact button reads "Autonomous · Opus · high".
- Everything a run kind needs: `parseRun`, `runPrompt`, `runArgs`, `expectedRun`, `withRunNote`, `tailFor`, `views.js` `EXPECTED`/`runWords`/`LEVEL_TONE`, `style.css` `.tone-autonomous`, `chat.js` `WAYS`/`RUN_KINDS`, i18n `run.way.autonomous`, `run.why.autonomous`, `run.hint.autonomous` in every language block (PT-BR plain words), and `test/web-i18n.test.mjs`.

## Part 2 — the agreed restart (`sv13`)

Today there is no restart command: a chat that wants a fresh server kills and starts the process, and every page chat (a child of the server) dies mid-turn; nothing resumes them.

### Request
- A new tool `restart_session_map({ reason })` in the arsenal MCP (`server/ai/arsenal-mcp.mjs`), which every Claude conversation on the PC has, posting to a new route `POST /api/restart` on the session-map server (same auth the arsenal routes use). Answer: `{ scheduled: true, waitingFor: n, deadline }` or `{ scheduled: true, already: true }`.
- The page gets no button in this slice (YAGNI); the alerts show the restart.

### When
- A new module `server/restart.mjs` (pure decision + a small coordinator) holds at most one pending restart. It restarts when **no page chat driven by the hub is in the middle of a turn** (every driven chat `running === false`), checked every 2 s, or at the deadline (10 minutes after the request), whichever comes first. Several requests while one is pending join it.
- While pending, every chat that ends a turn is held: the hub does not start a new turn from a queued/auto message until the restart happened (so the safe moment arrives).

### How
1. Write `smDir/restart-resume.json`: the session ids of every chat the hub drives (with its key, project and run), the reason, the time, and whether each was mid-turn.
2. Close the HTTP server, `hub.close()` (ends the claude processes cleanly), then spawn a new server: `process.execPath` with the same `process.argv.slice(1)`, `detached: true`, `stdio: 'ignore'`, `windowsHide: true`, `unref()`, then exit. A short retry on `EADDRINUSE` in the new process (up to ~10 s) covers the port being freed.
3. On start, after the hub exists, read and delete `restart-resume.json` (only if younger than 15 minutes) and resume each listed chat with the existing `start({ sessionId, cut: true … })` path, one at a time within `CHATS_MAX`, sending: "[session-map restarted at the request of another conversation (reason). Continue where you left off; if you were in the middle of a step, check its result first.]". A chat that was idle (not mid-turn) is resumed without sending a message (it just stays available, not cut off).
4. An alert tells the owner the restart happened, who asked and how many chats were resumed.

### Rules
- The restart never runs in tests against the real server: the spawn, exit and timers are injected so tests use fakes.
- No restart while `--demo`.
- The resume file never holds secrets.

## Tests (node --test, `npm test`)
- run.mjs: parseRun/runArgs/expectedRun/runPrompt for `autonomous`; DEFAULT_RUN.
- hub (fake claude): an autonomous chat starts with `--permission-mode auto`; a permission reaching the relay is denied at once with the deferred message and state `deferred` (no card, no wait); AskUserQuestion denied with the decide-yourself message; a force push denied in every run kind; a non-autonomous chat still shows the Allow/Deny card as before; the snapshot module stores a ref inside a git repo (working tree and index untouched); auto-answers ask-reinforce within the limit and waits past it; a new chat without a run starts autonomous.
- web: the run menu shows three paths, Autonomous checked by default; runWords for autonomous; i18n keys.
- restart: decision function (waits while a chat runs, fires when all idle or at the deadline, joins requests); resume file written and read; resumed chats get the note; idle ones do not; nothing spawns in tests.
- The whole suite passes, or the failures are shown to be from other work in progress (listed, with the reason).
