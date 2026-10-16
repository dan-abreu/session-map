# Page chat

Lets the page start and continue Claude conversations on a point of the map, and place a new idea in the right part.

## How it works

A chat is a `claude` CLI process per conversation, driven over its stream. The first message carries a short context for the point that was clicked: the path in the map, what the part is about and the item's text. Permission questions come back to the page with Allow and Deny. A conversation survives closing the sheet and a server restart (`--resume`); one the restart cut off mid-turn says so and offers Continue.

## Where in the code

- `server/chat/`

## Rules that must not break

- The mode `bypassPermissions` is never used.
- Writing the user's Claude settings needs the token, a backup first, and can be undone.

## What's missing

### Conversation

- [x] **Claude:** One chat per map point, with the maintenance rule in the first message `pc01`
- [x] **Claude:** "New idea" chat that proposes the part and writes only after an OK `pc02`
- [x] **Claude:** Attach an image to a message `pc03`
  - Paste, drop or pick up to four images (PNG, JPG, GIF, WebP); they go to claude as image blocks and show on the message (mm22).
- [x] **in progress:** The composer rebuilt lean on the brain: the ways menu, the model chips, the Ultracode door and the duplicated context and permissions sections leave; the brain's line stays `pc35`
  - From `id146`. The Cérebro routes the chat (or39–or42), so the bar keeps the attach, the key hints, the cost chip, the line "Cérebro: engine · model · effort" (the run event's brain) and Send; the menu by Send dies with its paths, chips, context and permissions (the Configurações link stays). `server/web/chat.js`, `views.js`, `index.html`, i18n.
  - Built on 2026-10-15: the composer's bar is attach · hints · cost chip · the brain's line (`data-chat="brain"`, "Sonnet · low — conversa", quiet until the first run event) · Send; the run menu, the chips, the Ultracode warning, Context and Permissions left `chat.js` and `index.html`; `views.js` lost EXPECTED/runWords/runPicks and kept brainLine; Configurações kept the limit, the language, the alerts and the permission mode (selfPart died); the i18n block `run.path*`/`run.way*`/chips left and `chat.brainTitle` came in pt/en; the CSS of the menu left and `.chat-brain` joined the bar. `test/web-chat`, `test/web-chat-around`, `test/web-chat-full`, `test/web-composer`, `test/web-chatfold`, `test/web-i18n` updated and green.
- [x] **in progress:** The composer's bar keeps only what is needed: a memory chip ("48k / 200k") by the cost, and the brain's line cut to model and level `pc37`
  - From `id157`. The program already read each reply's `usage` (`claude-conversation.mjs`, `turn-check.mjs`) and already had the mark of a heavy conversation (`waste.mjs` `MAX_CONTEXT`, 200k); the chat showed neither. `readConversation` returns `contextTokens` (input + cache written + cache read of the last reply of the chat itself, helpers left out); the hub puts `context: {tokens, max}` on the history (`itemsOf`) and on the `run` event after each turn (`memoryOf` reads the transcript's tail); the page chip (`data-chat="memory"`, `contextMeter` in `views.js`) turns amber from 70 % and red from 90 %. The brain's line is now "Sonnet · low"; the entry brain's why ("a chat") moved to the tooltip. The key hints stay (the owner's choice). DeepSeek conversations give no number, so no chip. `test/web-turn-check`, `web-chat`, `web-chat-around`, `web-chat-full`, `turn-check`, `sources-conversation`, `chat` updated and green.

### Permissions

- [x] **Claude:** Mode per conversation, or one mode for every Claude on this PC, with undo `pc04`

### Chat states

- [x] **important:** A chat with nothing running goes to "Esperando você" and says why it stopped `pc25`
  - From `id99`. When neither a turn nor a team of helpers is running, the chat leaves "working" at once, shows in "Esperando você" and carries one plain line on why: finished, waiting for your answer, cut by a restart of session-map (and whether it resumes by itself), out of credit or limit, an error. Never a chat that looks busy while nothing works.
  - Done 2026-10-14 (`pc34`): one state line above the box that never goes dark — "Trabalhando · passo [Parar]", "Esperando você · esperando sua resposta", "Cortada · motivo [Continuar]", "Finalizado · resumo", "Erro · texto". Out of credit or limit is not reported by the engine yet.
- [x] **Claude:** Clear state on every page chat `pc05`
  - Working, finished (with the final summary), interrupted, waiting for permission. A chat that ended must never look stuck.
  - An on-screen notice when a chat finishes.
- [x] **Claude:** A server restart must not kill a running chat `pc06`
  - Either the process runs detached, or the chat resumes automatically with "the chat was interrupted by the restart, continue?".
- [x] A quiet chat with a team of helpers still working is never closed for being idle `pc12`
  - Today the hub ends a page chat 30 minutes after its last turn (`IDLE_MS` in `server/chat/hub.mjs`), which kills a workflow or background helpers still running inside it.
  - Before closing, look at the session's helper files (`<session>/subagents/`): anything written within the idle window postpones the close.
- [x] **Claude:** Reopening a running chat is quick and never shows it empty or cut `pc13`
  - Before, the history left out every turn of the running process (they should come as events), but the hub keeps only the last 2000 events and each streamed piece of text was one: a long chat reopened empty or cut. The page also drew the whole chat again for every replayed event, so reopening one froze for a while.
  - Now the pieces go once their whole text arrives (and go first when the events are full), the history ends at the first message the events still hold (by its place in the transcript, or by time for a turn longer than the events) and tells the page where to replay from, and the page draws once per frame.
  - How to confirm it is done: in a page chat with several long replies, reload the page: the whole dialogue shows at once, from the first message.
  - Fixed in the code on 2026-10-10; it reaches the page with the next version.
- [x] **Claude:** Opening a chat never waits for the map to be worked out again `pc14`
  - The chat's routes (list, history, image, helper) awaited a fresh collect whenever the state was older than 3 s, and a collect of every project takes 20 to 30 s on this PC (hundreds of git processes): opening a chat froze that long.
  - They answer with the newest finished state at once while the next one is collected.
  - How to confirm it is done: with the page open for a while, open a chat: its messages show in under a second.

### The chat, redesigned (2026-10-11)

- [x] A one-line header with the rest in its ⋯; the AI's steps folded into one line; quick-reply buttons when it asks; a working line with Stop `pc18`
  - From `id91`. The header is the state dot, the title, the part as a chip, ⋯ and close; the ⋯ holds "About this part" (the box's information, which folds away while the person talks and opens in place from here), find (also Ctrl F, with "Go to"), rename or move, archive, open in a terminal, delete and New conversation.
  - A turn's tool and thinking rows fold into "Did 12 steps · read 6 files, changed 3" (`views.js` `stepRuns`, `stepCounts`).
  - Quick replies come only from options really written at the end of the last reply: a numbered or lettered list (1, 2, 3 or a, b, c in order) next to a question, or a last question "X or Y?" with two short sides (`chatfold.js` `quickReplies`); a click sends the option's words.
  - While a turn runs, one line "Working · <step> [Stop]" above the box; the key hints sit inside it, on its bar.
- [x] The menu by Send shows only the three ways; the monthly limit and permissions move to Configurações `pc19`
  - From `id91`. Autonomous, Automatic and Manual (Manual shows the model and level right under it), a quiet "model · level · cost in this conversation" line and the link "Monthly limit and permissions…".
  - Configurações (`runsettings.js`) is one sheet, also in the person's menu: the monthly limit (the same value as Home's card), "may reinforce on its own", the permission mode with "use this mode in every Claude on this PC", and the advanced ways (Maestro, Ultracode, Same as my Claude).

### A professional chat (step 1 of `id93`)

- [x] **Claude:** The model and the mode in plain sight by Send, in professional terms: Agente · Planejar · Perguntar, the model and its reasoning level `pc20`
  - From `id93`. Like Cursor's and ChatGPT's selectors; the words: Modelo, Raciocínio, Contexto, Permissões, Modo agente, Modo plano.
  - Done 2026-10-14 (`pc34`): the button by Send reads "way · model · reasoning" and its menu shows everything the engine has — Modo with all six ways (Agente · Planejar · Perguntar · Orquestrar · Ultracode · Igual ao meu Claude; the advanced ways left Configurações, and Ultracode's cost warning lives in the menu), Modelo · Raciocínio chips always in sight (they pick in Perguntar and show the engine's pick in the other ways), Contexto (cost and images) and Permissões (the mode now, and the link to Configurações). The professional names live in the Full mode, as every technical term does; the plain mode says the same in everyday words.
- [x] **Claude:** Actions on every message: edit and resend, regenerate, copy, and code blocks with their own copy `pc21`
  - From `id93`.
  - Done 2026-10-14 (`pc34`): one quiet row on hover under every message — copy (all), edit and send again (the person's own), run the last turn again (the last reply); code blocks keep their own copy. One copy per message: the meta line's copy gives way to the row.
- [x] **in progress:** The conversation's context in sight: attached files and images as chips, @ files, and a meter of context used and cost `pc22`
  - From `id93`.
  - Done 2026-10-14 (`pc34`): the cost as a quiet chip by Send and as the Context section of the menu (cost and images); @ files and the images of each message were already in sight. Left: a meter of context used — the engine does not report tokens used, so the meter waits for an honest number.
  - Done 2026-10-15 (`pc37`): the honest number was in the transcript all along (each reply's `usage`); the meter is the chip "48k / 200k" by Send.
- [x] **Claude:** Conversation history like the big chats: search, pin, rename and export `pc23`
  - From `id93`.
  - Done 2026-10-14 (`pc34`): the sheet's list searches its titles, pins conversations on top (a session-map list, like archive: `server/actions.mjs` pin and unpin) and the ⋯ exports the whole conversation as one markdown file; rename or move was already there. History's own search and state filters came with `mm33`.
- [ ] **in progress:** Titles written by the AI from the conversation, rewritten when the topic moves, never over a title the person set `pc24`
  - From `id93`.

### The chat, redesigned again (2026-10-14)

- [x] **Claude:** A full visual rework: one standard for every control, the missing options in their places, no leftover clutter `pc34`
  - From `id121`. One design language for the whole sheet (header, state lines, bubbles, chips, buttons, menus, the working line and the box); the stacked and repeated controls move to one clear place each; the options a professional chat needs are filled in; the dialogue keeps most of the height and the visual noise goes.
  - Done 2026-10-14 (`server/web/chat.js`, `index.html`, `style.css`, `i18n.js`, `transcript.js`, `app.js`, `server/actions.mjs` and `server/chat/hub.mjs` for pin; 117 chat tests green, the new ones in `web-export.test.mjs` and `actions-files.test.mjs`): the header as the owner drew it — title with its ? (one click on the title renames or moves), the search in the chat, the ⋯ of the extra options, minimize (−) and close (×); under it a tab bar (Chat · the box's tabs Resumo, Mudanças, Arquivos… · Livro da conversa · Terminal) where each tab opens its thing whole, none overlapping the chat; the state line that never goes dark (`pc25`); actions on every message (`pc21`, beside the meta line's own copy, which stays); the selector by Send with every way (Agente · Planejar · Perguntar · Orquestrar · Ultracode · Igual ao meu Claude) and the model and reasoning chips always in sight (`pc20`); the cost chip (`pc22`); the list with search and pin and the export in the ⋯ (`pc23`); the cut-off card stays in the log; everything on the design tokens, in both languages.

### How it runs

- [x] **Claude:** Automatic and Manual ways a page chat runs, with the model and effort shown `pc07`
  - Automatic (default): Opus at high sizes each request by the CLAUDE.md rule: small ones directly, medium ones through helpers with an explicit model and effort, large or sensitive ones only after a plain explanation, an estimate and the owner's Yes (or within the monthly limit `budget.reinforcedMonthlyUSD`).
  - Manual: Maestro, Ultracode (after a cost warning), a fixed model and level, Same as my Claude. The compact button by Send shows the way, the model and the effort that really run; its menu says why and what it cost so far. Released in v0.2.2.
- [x] **Claude:** The chat sheet as wide as the owner drags it `pc08`
  - A handle on the edge, arrow keys, the width remembered, a double click resets; on the map and in the Flow workshop. Released in v0.2.1.
- [x] **Claude:** Send works on the first click, even when the text box is not focused `pc09`
  - The key hints under the box are hidden but keep their line: before, focus entering the form showed them, Send jumped up under the pointer mid-click and the message never left.
  - How to confirm it is done: type a message, click anywhere outside the box (or change the model in the menu by Send), then click Send once: the message goes and the box empties.
  - Released in v0.2.4.
- [x] **Claude:** The "Finished" line and the alerts read as plain words, without the reply's formatting marks `pc10`
  - How to confirm it is done: ask for an answer with bold text and a list; when it ends, the line above the box and the alert show "Finished: Short answer: …", never `**` or backticks.
  - Released in v0.2.4.
- [x] **Claude:** The chat looks like Claude's, with most of the height for the dialogue `pc11`
  - The way it runs, the model, the effort, the permissions and "use this mode in every Claude on this PC" live in the menu of one compact button by Send ("Automatic · Opus · high"); nothing of it sits at the top.
  - The header is one thin line: where the conversation is, its title, New chat, ⋯ (rename or move, archive, open where it lives) and close.
  - Released in v0.2.4.
  - Headings inside a reply stay close to the text size (1.15, 1.08 and 1 times the text), with tight margins.
  - How to confirm it is done: open a project chat; only the title line sits above the messages; the button by Send opens its menu and Esc or a click outside closes it; a reply with headings reads like the rest of the text, a step bolder.
- [ ] **in progress:** A chat opens at once: its newest messages first, the older ones as you scroll up `pc15`
  - From `id84`.
- [x] An autonomous way: one prompt and the chat works to the end, deciding on its own and listing its decisions `pc16`
  - From `id89`. It stops only to spend past the monthly limit (the owner's choice on 2026-10-10); publishing and deleting it does on its own; everything else it decides, writes down and goes on.
  - Built on 2026-10-11 (`server/chat/run.mjs`, `hub.mjs`, `safety.mjs`, `guard.mjs`): Autonomous is the default of every new chat, runs in Claude Code's own `auto` permission mode, a permission that reaches session-map is left for the owner ("Ficou para você"), AskUserQuestion is answered "decide yourself", a force push is refused in every way (relay and a PreToolUse hook), and a git snapshot under `refs/session-map/safety` is taken at each turn and before a destructive command. Reaches the page with the next version.
- [x] The button by Send speaks plainly: three ways, one sentence each, the rest under "Advanced" `pc17`
  - From `id90`. Autonomous (does everything on its own), Automatic (asks before big work), Manual (you pick the model); the permissions and "every Claude on this PC" go under Advanced, folded.

### Spending little, by the engine (`id106`)

- [x] First, prove the knobs on one cheap test chat: plugins and skills per chat through `--settings`, a hook that denies an Agent call, a hook passed through `--settings` `pc26`
  - The official docs (2026-10-13) confirm `--settings` as the per-session level, `skillOverrides` (on, name-only, user-invocable-only, off), `skillListingBudgetFraction`, PreToolUse deny and `updatedInput`, SubagentStart context and `autoCompactWindow`; whether `enabledPlugins` works per session is not written, so it is tested first.
  - Done 2026-10-13 (probe about US$ 0.37): the hook sees an agent's model and effort; a skill call inside an agent carries its agent_id and deny works; the brief is the first line of the agent's transcript; autoCompactWindow works from 100000 (lower is silently ignored), and at 100000 a 135k context became 31k; the index after a summary reaches the model. Plugins per chat through `--settings` were not tested yet (`pc29`).
- [x] Planning by itself: a request that is planning talk opens the chat in plan mode (reads, thinks, writes no code), without the owner having to say "planejar" `pc27`
  - Built on 2026-10-13: brain.mjs reads planning words and any medium or large request with no go-ahead as the plan phase; hub.mjs puts the plan directive before the person's words in that turn (organize the idea, write the plan, at most two questions, no code until approved) and the build directive once the person says go. It is a directive, not Claude Code's permission plan mode; the page does not show the phase yet.
  - The request's measure (`or14`) gains a "plan" kind (ideas, "e se", "como poderíamos", "vamos pensar", questions about the design); when unsure it plans first. Building starts when the owner approves the plan.
- [x] The conversation as a book: past a size, the engine writes its index (one chapter per request: what was asked, done, decided, which files) and goes on with the index and the current chapter only `pc28`
  - The chapters come from the transcript without AI (the person's messages, item codes, files touched, commits); a session-map tool reads one past chapter only when needed. The same pattern as recent research on long conversations: summaries as a map over the raw turns, then a few turns read.
  - Fallback inside Claude Code: an earlier `autoCompactWindow` and a PreCompact hook that keeps the chapter index.
  - Inside the same conversation too, not only by moving to a new chat: past a size, Claude Code's own summary runs earlier (`autoCompactWindow`) and a hook hands it the chapter index, so the conversation goes on shorter; a past chapter is read back only when needed. From `id111`.
  - A cheap AI tidies the index (asked 2026-10-13: "seria bom uma IA barata pra dar um indice mais compativel, organizado"): the engine keeps the exact facts (files, commits, item codes, cost) and Claude Haiku, in the background when a chapter closes, only writes the chapter's title and groups its steps into sub-chapters. It gets a short digest (the person's words, the final replies, the facts), never the raw chapter, so it stays under 100k tokens and costs about US$ 0.001 per chapter; a reply that drops or invents a fact is thrown away and the plain index stays. Haiku over an outside AI: best measured in Portuguese (bench, 100%) and it runs on the owner's plan, so the chat's words leave nowhere new.
  - The same call renames the whole conversation (asked 2026-10-13: "ela também já refaz o titulo da conversa, deixa junto, a conversa geral"): from the chapter titles it writes the conversation's title, which today is Claude Code's own, made once at the start and stale when the talk moves on. It changes only when the main subject changes, so the map does not flicker; a name the person gave by hand always wins. No extra call, so no extra cost.
  - Built on 2026-10-13 (`server/chat/book.mjs`, `book-hook.mjs`, `book-tidy.mjs`): each page chat compacts at 100k; each turn's end writes the closed chapters with no AI (about 0.07 to 0.14 s on a 15 MB transcript); after a summary the chapter index goes back in; Haiku, detached and with no tools, words each chapter and retitles the chat, backing off 30 minutes after a failed call. Live after the next restart of session-map.
- [x] Skills and plugins as a book index: each chat lists only the names of the skills (the index) and the full description of the two or three that fit the request (the chapters); plugins the project never uses stay off for that chat `pc29`
  - Through `skillOverrides` "name-only" and per-chat plugins in `--settings`, picked by `or22`; the page shows each skill's size and use.
  - Honest weight: on 2026-10-13 the skills were about 3% of the spend; the big ones are Opus by default (`or25`) and long conversations (`pc28`).
  - Built on 2026-10-13: `chatSkillSettings` in `server/chat/guard.mjs` (hub.mjs keeps it on the chat when it opens on a point; `guardSettings` writes it into `--settings`): user and project skills that `pickSkills` (`server/foundation/skills-focus.mjs`, shared with `skillsFocus`) picked are "on", the others "name-only"; a plugin goes off for that chat only when on, not session-map, not opened by the project in 30 days (`month` next to `week` on each plugin, from `weekByPlugin`), not named in the request and holding none of the picked skills. A resumed chat lists everything as before.
  - Probe 2026-10-13 (about US$ 0.05, haiku, `claude -p --settings`): `{"enabledPlugins":{"claude-mem@thedotmack":false}}` removed all 21 claude-mem skills from the list of that one session, the same command without it listed them; `{"skillOverrides":{"grilling":"name-only"}}` showed that user skill by name only while another kept its description. Both work per session.
- [x] Up to ten images per message, instead of four `pc30`
  - Built on 2026-10-13 (`server/chat/hub.mjs`, `server/web/chat.js`, the body limit in `server/main.mjs`): the four was a guess, not a limit of Claude. Each image costs about a thousand tokens on every later turn of the chat.
  - From `id108`.
- [x] The early summary (100k window) runs only in the page chats, not on the whole PC `pc31`
  - Measured 2026-10-14 in three chats of this PC: after each summary the chat restarts at 52k to 70k tokens (rules, memory, skill list, map context, chapter index), and Claude Code summarizes again at about 67k to 73k when the window is 100k; so one chat summarized every 30 to 60 seconds (nine times in fifteen minutes) and Claude Code showed "Autocompact is thrashing". The two `autoCompactWindow: 100000` lines were removed from `~/.claude/settings.json` (copy kept as `settings.json.bak-2026-10-14-autocompact`); the page chats keep theirs through the lock (`BOOK_WINDOW` in `server/chat/guard.mjs`).
  - Measured on 2026-10-14 and closed by `pc32`: the page chats hit the same loop; the 100k window is gone from `guardSettings` too.
- [x] No early summary in the page chats either: Claude Code's summary runs near the model's whole window again, and the book only writes the chapters and brings the index back after a summary `pc32`
  - Measured 2026-10-14 in four page chats of the night (`466e9407`, `7430d146`, `4862f794`, `99c10f61`): a page chat starts at about 39k tokens of fixed context (system prompt 21.6k, skill list 14.5k, rules 3.4k, prompt snapshot 3.5k, hooks 4k to 5k, map context 1.2k) and restarts at 42k to 79k right after each summary (the summary itself 4.6k plus the files Claude Code re-attaches, up to 14k); with the 100k window Claude Code summarized at 58k to 88k, so the chats summarized every two or three turns (33 summaries in one night: 16 in one chat, 8 in another, 6, 3) and two of them died with "Autocompact is thrashing". One died in the middle of the owner's third request, which was never done (`id118`).
  - Done 2026-10-14: `autoCompactWindow` removed from `guardSettings` in `server/chat/guard.mjs` (the Stop and SessionStart hooks of the book stay); `BOOK_WINDOW` is gone. Raising the window instead (200k or more) was not tried: Claude Code accepts 100k as the least, the fixed start would still be 40% of a 200k window, and the lesson of the routing change is to change one thing at a time and measure it.
  - From `id118`.
  - From `id117`.
- [x] The tidier spends by phase: Sonnet medium only when the turn is plan or build; talk and trivial pass the message as written `pc36`
  - From `id147`. `tidy-words.mjs` rewrites every message ≥15 words with Sonnet medium (~US$0.02 each) and doubles the message in the prompt. Waits for the `or35` bench result before any change: if talk keeps a strong model, the tidier may be dropped there; if it moves down, the tidier gains value.
  - Closed on 2026-10-16 (measured, nothing changed): at most 120 tidied messages in the 7 days of transcripts (lines carrying the marker), about US$ 0.02 each, so under US$ 3 a week. The phase the entry brain gives before the model runs is rule-based and falls to `talk` for a long dictated message with no work verb or file name (`rulesOf`, `server/ai/brain.mjs`), which is exactly the message the tidier is there to break down; skipping `talk` would save cents and risk the owner's own way of writing. `or35` kept the chat on one strong model (`docs/adr/0004-the-chat-never-moves-on-its-own.md`), so the bench the item waited for no longer decides it. Reopen if the weekly number grows (count the marker `[session-map: the person's own words, kept as written]` in the transcripts).

### The second engine

- [x] **DeepSeek:** A DeepSeek conversation opens on the page read-only, and continues in the DeepSeek app `pc33`
  - From `id119`. `transcriptOf` in `server/chat/hub.mjs` also finds the DeepSeek log (`sessions/<project>/<session-id>/session.v4.jsonl.zstd`, the newest generation), and `itemsOf` dispatches to the right `readConversation` by the file's suffix. A DeepSeek row comes with `chattable: false`, so `start` refuses to drive one with a claude process (the `409 live-chat` backstop) and the sheet shows it read-only with **Open in DeepSeek** — the same read-only flow a VS Code conversation uses. Images and helper transcripts stay Claude-only for now.
