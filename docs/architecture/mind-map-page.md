# Mind map page

The browser page: a tree from the project through layers and parts to groups and items, with the chat docked on the right. On a phone the same tree is an indented list.

## How it works

Plain ES modules and a vendored `d3` for zoom and drag, no build step. Clicking a box opens its panel and a chat on that point. A green dot pulses where a chat is working; "Show relations" draws dotted lines between related parts; "What changed" lights the parts that moved in the period picked on a bank-statement-style button (also used by History, Costs and the activity lists). Open or closed state, search and zoom are remembered per project.

## Where in the code

- `server/web/`
- `server/cards.mjs`
- `./DESIGN.md`
- `./PRODUCT.md`
- `test/workflow-trace.test.mjs`

## Rules that must not break

- English and Portuguese texts stay in step.
- Every state works without hover and respects reduced motion.

## What's missing

### Testes quebrados no working tree (14/10/2026)

- [x] **Claude:** `test/web-design.test.mjs` falha (4 asserções, "the type scale has seven steps") — os tokens de design da página mudaram no trabalho não commitado `mm54`
  - Closed on 2026-10-15: the suite passes again (checked: the test file runs green).
- [x] **Claude:** `test/web-point.test.mjs` falha (1 asserção, "aihelpers.js: undefined" — todo script da página precisa parsear) `mm55`
- [x] **Claude:** `test/web-ai-activity.test.mjs` falha (1 asserção, "the page shows what the server kept") `mm56`
  - Closed on 2026-10-15: the suite passes again (checked: the test file runs green).

### Requests and the repository

- [x] **Claude:** The Requests tab: every request of the owner and the work it became `mm38`
  - A top tab "Requests" reads the registry of requests (items with an "Asked" line, in English or Portuguese), groups them by state (being done, will be done, later, done, dropped), shows the owner's words and dates, what it means, the activities it became with their live state and a bar, the version it shipped in, and flags a request with no activity yet; filters "waiting for you" and "not turned into work yet", search, one project or all.
  - The registry part is no longer drawn on the map; the Operation part (`operation.md` / `operacao.md`) holds the work that changes no code and stays out of the Flow; a project whose repository has neither keeps them in session-map's folder (`projects/<id>/`), shown in a layer "Requests and operation".
  - How to confirm it is done: the tab lists every request of a project with the right counts; a click on an activity opens it on the map; a request with no activity shows in red; the Flow has no box for the registry or the operation.
  - Released in v0.2.5: with the owner's professional terms, requests that close themselves when all their activities are done, and the words of a registry kept translated in session-map's folder.
- [x] **important:** The project box opens the whole repository like VS Code on one side, the plan on the other `mm39`
  - The purple root box: the architecture to one side, and to the other the repository's real folders and files, opening folder by folder, with counts, a new file marked as it appears, and a click that opens the file in the viewer.
  - How to confirm it is done: open the root: both sides grow; a file created in the repository shows up in its folder within seconds, marked new; a click opens it read-only.
  - Done on main (`server/web/reposide.js`): the files grow to the left of the root, mirrored; folders open one level at a time with their count and "N new, changed or removed"; at most 40 boxes per folder and a "Show N more files" box; A/M/D from the Changes rows; a Files button in the map's tools hides the side; never on the phone. A new file of a kind the count leaves out (an image, a dependency file) shows as new but cannot be opened.
- [x] **detail:** A file on the left lights its part on the right, and a part lights its files `mm40`
  - Hovering or focusing a file or folder on the files side lights the architecture box it belongs to; picking a part lights its files on the left (opening the folders on the way). No new text on the boxes.
  - How to confirm it is done: hover `server/web/reposide.js`: the Mind map page box lights; pick that part: its files light on the left.
- [x] **detail:** A dot on the files and folders a conversation is editing now `mm41`
  - The same live dot the architecture boxes have, on the file and on each folder above it, while a conversation, helper or workflow edits it.
  - How to confirm it is done: while a chat edits a file, a dot shows on it and on its folders within seconds and goes away when the work stops.
- [x] **detail:** The files with no box on the map are marked on the files side `mm42`
  - A dashed border on each file the root counts as "with no box on the map", so it is clear which ones are missing (`id80`).
  - How to confirm it is done: the number of dashed files equals the root's "N files with no box on the map".

- [x] "New project" in the project picker and on the empty page: a name, where to create it, and the map opens on it with its project chat `mm50`
  - From `id95`.
- [x] The New project window offers "only on this computer" or "also on GitHub", with a public tick and the repository's name shown `mm51`
  - From `id96`.

### Speed

- [x] A new state redraws only the parts of the screen that changed, never the whole page `mm44`
  - Today every poll redraws the map, the conversations, Live and the open area, even when nothing changed. From `id84`.
  - Closed on 2026-10-16 (measured): a `MutationObserver` on the live page for 17 seconds, three polls each, all answered 304 (nothing new): 0 changes in Home, Map, Requests, Changes, Health, Costs, Conversations and Flow in most windows. The exception is by design, written in `poll()` of `app.js`: a new minute redraws the mind map (about 185 changes) and the conversation list (21) so the relative times and working marks keep aging, once a minute, not once per poll. The 304 answer of the state poll (`sv09`) is what keeps the rest still. A redraw of the hidden map while another area is open is the one waste left, and it is a minute apart.

### Views

- [x] **Claude:** Mind map and an outline for phones `mm01`
- [x] **Claude:** Board as columns of items `mm02`
- [ ] **later · detail:** Drag an item to another part `mm03`
  - Parked on 2026-10-16 (triage): weight detail.
- [x] Review the four design warnings in the page shell: three thick one-sided coloured borders ("side-tab") and a pulsing dot `mm45`
  - Keep the pulse only where it marks something really live (a conversation working now); soften or remove the side borders. From `id87`.
- [x] A card at the top of Home: "How much may the AI spend per month on big work", with the value, Save and what was used this month `mm46`
  - From `id89`. The same limit (`budget.reinforcedMonthlyUSD`) the run menu by Send already sets, now in plain sight; a bar shows used against the limit, and with no limit it says the Autonomous way will stop to ask before each big job.

### Around the map (redesign of 2026-10-11)

- [x] **important:** One slim top bar and one count of what waits: the Now strip goes into the conversation list `mm47`
  - From `id91`. Project, Início · Mapa · Conversas, one amber "N precisam de você" (the bell inside it), help and the person's menu (language inside). Rota and Ideias leave the bar until they exist.
  - The count is one function (`now.js` `needsYou`): the pill, the head of the waiting list it opens, the inbox and Home's "Precisa de você" read it (Home shows what waits on the map apart, on a quiet line). The strip left the page; its jobs (`nowJobs`) still feed the picker's marks and the tab title, and the inbox shows them (`mm49`).
- [x] **important:** The map's options in one row: the summary, search and one "Vista" menu; one "Novo" menu `mm48`
  - From `id91`. "Vista" holds what changed, files, relations, export and "keep the map up to date on its own" (saying it spends); "Novo" holds new conversation, new idea and the orchestrator. The map itself is not changed.
  - The line's "● N trabalhando" counts the open project only (the inbox's Working number); work in other projects goes into its tooltip and the Live list it opens.
- [x] **important:** The conversation list as an inbox: what needs you, working, recent, archived `mm49`
  - From `id91`. Each waiting row says in one line what is needed; the orchestrator sits under Working with its chats indented; cost shows on hover.
  - Groups, top to bottom: Precisa de você · N (`needsEntries` over `needsYou`, every project whatever the scope, so its number is the pill's), Trabalhando · N (the step each one is on; the orchestrator first while it or one of its chats works), Cortadas (only when any, each with Continuar, the Cut off panel's own), Também mexendo aqui, Recentes (pages of 50) and Arquivadas · N folded at the foot. The groups replace the five state chips; "Este projeto ▾ / Todos" sits inside the search field, and "Todos os projetos" keeps one card per project under Precisa de você.
  - On a phone the bottom bar's Conversas opens the inbox over the map (the bar marks it while open); Quadro e Histórico wait at its foot. A touch screen shows ⋯ and the cost always.

### Polish package (first, after v0.2.2)

- [x] **Claude:** Conversation list grouped by project, with the project on every row `mm04`
  - In "All projects": one collapsible header per project (name, color, working and waiting counters), like project folders in Claude or ChatGPT and channels in Slack. Every row shows a project badge, also in "This project".
  - Inside a project: the orchestration chat pinned on top, then Working now and Waiting for you, then by date (Today, Yesterday, Last 7 days, Older). The Now strip and the alerts use the same order and badges.
  - Test: in "All projects" no row lacks the project name.
- [x] **Claude:** Show every conversation exactly like Claude Code shows it `mm22`
  - Every message from both sides with the same formatting (markdown, tables, code, links), the time of each message and the date when the day changes, Claude's steps (read, ran, edited) as collapsible blocks, multiple-choice questions with the owner's answer, images, nested helper agents, cost per reply and total.
  - Search inside a conversation, jump to a day or time, and a live mirror for a conversation still running. Secrets in steps shown masked.
  - Applies to every origin (VS Code, terminal, map) and to archived conversations, including ones Claude Code already deleted.
  - The chat composer: pasted, dropped or picked images, `@` file mentions and `/` commands (the project's skills); "thinking" and the task list with the current step; edits as before/after diffs, accepted or rejected in the permission card; stop (also Esc); plan mode; model and mode picker; Enter, Shift+Enter, Esc, arrow up for the last message; copy buttons on replies and code.
  - Where: `server/sources/claude-conversation.mjs` reads it, `server/web/transcript.js` and `md.js` draw it, the same in the chat sheet and in History.
- [ ] **later:** The rest of the chat experience `mm23`
  - Parked on 2026-10-16 (the finish plan): the owner said on 2026-10-16 that the program already has everything he wants; these four chat pieces wait until he misses one.
  - History opens an archived conversation in the same chat sheet, with search and jump (today it reads in its own pane, with the same drawing but no search bar).
  - Answer Claude's multiple-choice questions from the page in a page chat, and attach files that are not images (today only images; a project file is pointed at with `@`).
  - The built-in `/` commands of Claude Code that work in a page chat, beside the skills.
  - On a phone, the chat sheet uses the whole height under the top bar (today the map's toolbar leaves it about half the screen).
  - The chat header on one line (title, model and mode, cost), as the owner asked (`id56`); done on 2026-10-14 by `pc34`: one line (dot · title · part chip · Livro · ⋯ · fechar), and the box tabs (Resumo, Arquivos…) moved to their own strip under the header, always in sight — the first one-line try hid them and the owner said so.
- [x] **Claude:** Move and rename a conversation with one click `mm21`
  - Move a conversation to another project or part (the placement learns from it); rename it with a title that makes sense to the owner.
  - Why: a long chat opened in one project's folder about another project landed in the wrong project and part, under an automatic title that did not say what it was about.
- [x] **Claude:** Relations you can zoom, select and read `mm05`
  - Wider zoom range, +/−/fit buttons, pinch on phones, a click on a box centers it.
  - A wide invisible hit area (about 16 px) on every line, a summary on hover ("A ↔ B · 3 reasons") and a "Relations" list sorted by strength that lights the line when clicked.
  - Relation panel: both parts, strength, every reason with its evidence (chats, branches, commits, shared files, spec excerpt, the AI's explanation), since when, confirmed or detected. Actions: open the chats, put it on the Flow drawing, ignore it (kept per project).
- [x] **Claude:** Bank-statement-style date range `mm06`
  - Buttons Today, 7, 15, 30, 60, 90 days, This month, Last month, Custom. Custom has From and To fields and a two-month calendar (click the start, click the end, the range is painted), Apply and Clear; on phones a one-month calendar in a bottom sheet.
  - The range shows on the button ("3–9 Oct"), is remembered per project and applies to "What changed", History, Costs and Activity.
- [x] **important:** The AI's plain-words reason for a relation `mm32`
  - What is left of `mm05`: the relation panel shows every reason with its evidence (chats, files, branch, last commit, plan), but not a sentence from the AI saying why the two parts are tied.
  - One cheap AI call per relation, cached in the session-map storage and redone only when its reasons change.
- [x] **Claude:** Panels separated by kind of information `mm07`
  - Distinct blocks with their own color, icon and plain title: Tasks, Chats, Lines of work (branches), What changed, Files. Each block says where its data comes from.
  - Tabs in the panel (Summary, Tasks, Chats, Changes, Files); the Summary shows only the essentials. The same colors and icons for each kind everywhere: map, lists, Now strip, alerts.
  - A click on any box opens these tabs on the Summary (an item on its own detail), with the chat about the box always under them in the same sheet: the chat never replaces the information and is never hidden behind a tab. Sending a message folds the information to one line (open items, how many wait for the person, what blocks), a click opens it again, and the line between them moves the boundary (drag or arrow keys). Each box has its own chat: another box opens its own, the previous one keeps running and comes back whole when its box is clicked again; "New chat" starts a fresh one. A new chat offers ready first messages that fill the box to write in without sending (released in v0.2.4). A part or a layer with no file linked says "no file linked to this part yet" with a "?" instead of zeros.
- [x] **Claude:** Visual polish of the whole program, written down in `DESIGN.md` `mm08`
  - One visual system: type scale, spacing grid, semantic palette (light and dark, AA contrast), one icon set, identical components with every state, short purposeful motion that respects reduced motion.
  - Empty screens with a simple illustration and a sentence, skeletons while loading, nothing cut off or overlapping on desktop and phone.
  - Screen-by-screen polish with a review of screenshots; the owner approves the screenshots before anything is published. The tokens and components go in `DESIGN.md` for later versions to follow.
  - The chat panel must leave most of its height to the dialogue (owner's complaint: raw text and a huge input box): messages rendered as markdown like Claude Code (headings, bold, lists, tables, code blocks with copy, links); the input box starts at one line and grows with the text up to about 40% of the panel, then scrolls; compact header (shipped as two short lines, the title and then model, mode and cost; the single line is open in `mm23`); the permission and mode controls collapse when not in use; on the phone the input stays docked above the keyboard.
  - The conversation list's obvious divisions were planned here but not done: they moved to `mm33`.
- [x] **Claude:** A conversation list whose divisions show at a glance `mm33`
  - Why: the owner on 2026-10-09: "não da pra saber quando o chat é o claude ou vs, nao ta seperado os chats", and earlier "too little difference to understand what is divided". Today a row has only a coloured dot for its state (the word is for screen readers), the group titles scroll away, and the project badge is cut off on every row ("acme-sh" at 1440 px).
  - Every row with a status chip in colour and word (Working, Waiting for you, Finished, Closed), the origin badge with icon and word (VS Code, Terminal, Map, Phone), the place in the map on its own line, and time and cost on the right; "finished and not yet seen" rows highlighted until opened.
  - The groups (Working now, Waiting for you, Today, Yesterday…) as clearly titled sections with icon, colour and count, extra space between them, and titles that stay on top while their rows scroll (today only the project folder's title does).
  - Each project as a card with its colour band and name, in "This project" too; the project badge never cut off, or left out inside the project's own card, where it only repeats.
  - How to confirm it is done: screenshots at 1440 px and on a phone, in both themes: every row shows its state in a word, no text is cut off, a group title stays on top while its rows scroll, a finished conversation not yet opened stands out; a test fails if a row has no state word.
  - Done so far (2026-10-09 real-data check): the project badge keeps its size on every row and Now card (only a very long name ends in "…"), and a chat the page started reads "Map" even when the page's own record of it is gone (it said "Automation").
  - Released in v0.2.3: every row carries a state chip in colour and word (Working, Waiting for you, Finished, Closed, and "Finished, not seen yet", whose row stays highlighted until it is opened), the origin badge with icon and word, its place on the map on a line of its own and time and cost on the right; each project is a card with its colour band and name, in "This project" too, and its rows no longer repeat the project; the groups are titled sections with their own icon, colour and count, extra space between them, and a title that stays under the card's title while its rows scroll. On a computer the conversation sheet sits on the stage itself and takes its whole height beside the map tools. Checked on screenshots at 1440 px and on a phone, light and dark; `test/web-convlist.test.mjs` fails if a row has no state word.
- [x] **Claude:** Global fixed "Now" strip across all projects `mm09`
  - Always visible on every tab, never filtered by the chosen project: switching project, tab or scrolling does not change it. Test: its content is the same whichever project is selected.
  - One card per running job in any repository: where (project › part › item), live last step, how long, model and helpers (n/total). Waiting for you comes first, in amber.
  - A click switches project and opens the point on the map and its chat. It scrolls sideways, collapses to a line ("3 working · 2 waiting · 1 finished") and is a one-line button opening the list on phones.
- [x] **Claude:** Badges per project in the project picker `mm10`
  - A pulsing green dot if something works there, an amber number of items waiting, a check for "finished and not yet seen". That last mark stays until the chat is opened.
  - The tab title shows the count, like "(2) session-map".
- [x] Bring back what was working after a crash or a restart; delete and archive conversations; the list filtered by state `mm43`
  - Closed on 2026-10-16 (triage): built on 2026-10-10 and covered by its tests; it ships with the next version.
  - A "Cut off" panel ("Cortadas") over the map lists every conversation that was working when session-map fell or the PC restarted: page and map chats (page-chats.json still says running and nothing drives them now), VS Code and terminal ones (the transcript stops mid-turn and its last line is from before this boot, or their own session file was left "busy"); one waiting on a question for the person is not cut off. Continue on each and Continue all resume it as a page conversation in its own folder (`--resume`, the settings' permission mode, never bypass); the server refuses a second process (a double click, another tab, its own VS Code or terminal still open) and Continue all stops at the 6 the page runs at once. An entry stays until continued or dismissed (a later cut brings it back), leaves by itself after 7 days, and steps aside while a sheet is open.
  - Archive and "Delete from session-map" in the chat's ⋯ menu and in the rename and move dialog. Delete always asks first (the dialog opens on Cancel), is refused while the conversation works, and writes only `removed.json` in session-map's folder and the action log: Claude Code's transcript and the project are never touched. The conversation leaves the map, the lists, the Now strip, the waiting list and History, its changes read as made outside a conversation, and its cost still counts in the totals; undo is taking its id out of `removed.json` (no button).
  - Each state has its own group in the list (since `mm49` the inbox's groups replace the five filter chips): Working, Cut off, Recent, and Archived folded at the foot. A cut-off conversation counts as "Cut off", never also as "Waiting for you".
  - Built on 2026-10-10 (`server/hidden.mjs`, `server/web/cutoff.js`, `cutOff` on each row in `server/collect.mjs`, `turnOpen` in `server/sources/claude.mjs`, the guards of `server/chat/hub.mjs` start, `delete` and `dismiss-cut` in `server/actions.mjs`); ships with the next version. Limits: Windows "Shut down" with Fast Startup keeps the boot time, so a VS Code or terminal conversation cut that way shows only while its session file is still there; "stopped mid-turn" follows how Claude Code writes its transcripts today (pinned by tests shaped like real ones).
  - How to confirm it is done: restart session-map (or the PC) while a page chat works on a long task: on opening the map the "Cut off" panel lists it, Continue picks it up and a second click starts nothing more; Dismiss takes an entry away; Delete asks first, the conversation leaves the map and the lists, and its file under `~/.claude/projects` is still there; the "Cut off" and "Waiting for you" buttons on the list show only those, with the right numbers.
  - From request `id82`.

### Plain language

- [x] **Claude:** Plain-language round across the whole program `mm11`
  - Clarify every screen so it is understood at a glance: jargon becomes simple words in English and Portuguese (diagram file → drawing, workflow and agents → team of helpers, branch → line of work, commit and merge → saved and joined, token cost → what it cost), with a "technical details" mode showing the original terms.
  - Icon plus text always, a "?" per area with one sentence, empty screens that say what to do, a five-step welcome tour (skip and replay), advanced options grouped in one place.
  - Scope is everything: tabs, panels, Now strip, lists, chats, every error, warning, confirmation and alert (what happened and what to do, never raw codes), install and first use, the settings texts.
  - Test: a reviewer with a lay persona looks at screenshots of each screen and answers "do I understand in 5 seconds?"; what fails is redone before release. Skills, terminal view and READMEs are in `pt03` and `pt05`.

### Later (ideas, not committed)

- [ ] **later · detail:** Edit files and folders inside the page (create, rename, delete, save) `mm12`
  - Parked on 2026-10-16 (triage): the owner already put it on hold on 2026-10-10 (`op06`).
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **later · detail:** A terminal inside the page `mm13`
  - Parked on 2026-10-16 (triage): the owner already put it on hold on 2026-10-10 (`op06`).
  - Needs a native module, which breaks the no-npm rule; decide before starting.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [x] **detail:** Create and drag cards by hand in the Board `mm14`
- [ ] **later · detail:** Zoom inside a part: its files as dots tied to the chats and commits that touched them `mm15`
  - Parked on 2026-10-16 (triage): weight detail; the Flow level 2 already shows it.
  - "This chat touched these 3 files".
- [x] **detail:** More mind map exports: Markdown outline, XMind, FreeMind `mm16`
  - draw.io, PlantUML and Graphviz are covered by the Flow part (`fl13`, `fl14`).
- [ ] **later · detail:** Discover: recommended for this project, trust badge, hand-picked lists `mm17`
  - Parked on 2026-10-16 (triage): the owner already put it on hold on 2026-10-10 (`op06`).
  - The AI reads the project's architecture and stack and explains what fits; open a repository and list its skills translated; trust badge from last update, license, issues and an optional audit.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **later · detail:** Discover for every AI, not only Claude `mm18`
  - Parked on 2026-10-16 (triage): the owner already put it on hold on 2026-10-10 (`op06`).
  - A "Works with" filter (Claude, Codex, Gemini, Cursor, any = MCP); new sources: the official MCP server registry, Gemini CLI extensions, Codex, Cursor rules and SKILL.md skills (check who accepts them).
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **later · detail:** "Which AI for each task" section (video, image, voice, bulk text, code) `mm19`
  - Parked on 2026-10-16 (triage): the owner already put it on hold on 2026-10-10 (`op06`).
  - What each is good for, price and API. It is the base of the Arsenal idea (`or11`).
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [x] **detail:** Discover updates itself in the background and pages past 50 results per topic `mm20`
  - Today it refreshes only when the tab opens after 24 hours or on the Update button.

### Where the work really is

- [x] **Claude:** Real footprint of every conversation, file by file `mm24`
  - From each conversation's edited and mentioned files, plus the edits of its helpers and workflows, find every project and part it really touches (by the parts' paths): it shows in each project it touches ("born in A · working in B"), and its parts light in proportion to the files edited there.
  - Live lights the part of the file in the latest step; before work starts, the orchestration says "will touch: A, B, C". A middle level of components sits between a part and its items (level 2 of `fl09`, also on the mind map), and an item that spans parts shows in each, linked. Refined later with the census (`fd01`).
  - How to confirm it is done: a chat opened in project A that edits files of project B is listed in both with "born in A · working in B"; the parts it edited light with a share matching the files edited; Live lights the part of the file named in its last step.
  - Released in v0.2.3: the project of each edited file is the git repository it lives in (a worktree counts as its main checkout), the part is the one owning the file on that map; libraries, generated files, binaries and the Claude folder never count; a project only edited shows up though no conversation started there. The conversation stays listed (with its cost) at home and shows elsewhere under "Also working here"; its parts there carry a "This conversation · 40%" chip while it is open; a step outside its folder shows only its last folders. "Will touch", the middle level and items spanning parts moved to `mm34`.
- [x] **Claude:** Files, lines and share of the program in every box `mm25`
  - Each box shows its files, lines and % of the program, summed on the levels above; a Files panel per box lists them by folder (lines per file), split by kind (screens, server, tests, docs) and what changed in the period; the root shows "N files with no box on the map" in a strong color.
  - Base: files assigned to parts by their paths over `git ls-files`, counted by session-map itself; exact numbers from the census (`fd01`).
  - How to confirm it is done: the root's count equals the number of tracked files minus the ones left out on purpose; every layer equals the sum of its parts; the "no box" number equals the census list of files without an owner.
  - Released in v0.2.3: `server/sources/count.mjs` counts every tracked file line by line (no dependency, recounted at most every 30 s and only the files that changed) and `server/arch/sizes.mjs` gives each file one owner (the deepest path; the first part on a tie). The project panel lists the files with no box and what was left out, by reason; a part's Files tab shows lines per file and the split by kind. What changed in the period inside the Files tab moved to `mm34`; the census (`fd01`) refines the numbers.
- [ ] **later · important:** The rest of the real footprint `mm34`
  - Parked on 2026-10-16 (triage): the tail of footprint work that is already built.
  - What is left of `mm24` and `mm25`: before work starts, the orchestration says "will touch: A, B, C"; a middle level of components between a part and its items (level 2 of `fl09`, also on the mind map); an item that spans parts shows in each, linked; the Files tab of a box marks what changed in the period; on a phone the open conversation covers the map, so its "This conversation · %" chips cannot be seen (show the share in the conversation's Details or on the outline before it opens).
  - How to confirm it is done: an orchestration plan lights the parts it names before the first edit; a part opens into its components with the files of each; an item whose files sit in two parts shows in both with a link; the Files tab with "last 7 days" picked marks the files changed in that week.
- [x] **Claude:** Walk through the files of a box `mm26`
  - A file tree per box like VS Code's explorer; code colored, with line numbers and search in the file; jump to the files it uses and the files that use it (import graph); Open in VS Code at the line.
  - How to confirm it is done: open a part, expand its tree, open a file: line numbers and colors show; search finds a word; "used by" lists the files that import it; Open in VS Code lands on that line.
  - Released in v0.2.3: the Files tab of a box is a folder tree like the editor's explorer (folders first, single-folder chains on one line, open folders kept while the page lives); a file opens with the code in colors (our own small reader, no dependency), line numbers, search in the file with next and previous, the files it uses and that use it with the line of each (`server/imports.mjs` reads the import lines of JavaScript, TypeScript, CSS and HTML over the saved files) and the libraries it asks for; a click on a line picks it for Open in VS Code. Other languages, new files not yet saved and very long files go on in `mm36`.
  - Released in v0.2.4: the project box's Files tab shows the whole program as a folder tree (every counted file, never a secrets file) and its lists of files with no box and of files left out open the viewer (binaries stay text); a row says "opening…" while it loads, and the code shows before what it uses and what uses it.
- [ ] **later · important:** The rest of the Changes tab `mm35`
  - Parked on 2026-10-16 (triage): the tail of the Changes tab that is already built.
  - What is left of `mm30`: an edit made by a command the conversation ran (a script, a formatter, `sed`) reads "outside the conversations": tie it to the conversation whose step ran just before the folder changed; the release is looked up for the newest 60 saved changes of a project (older ones read "Saved"); a click on a box's "+N files" chip opens the Changes tab filtered to that part; a file changed and removed before any pass of the server saw its last version (the server was off, or it all happened within seconds) says its previous content was not kept: rebuild it by replaying the conversation's edit steps after the one that wrote it.
  - How to confirm it is done: a conversation that runs a formatter shows those files under its name; a file a conversation wrote, edited and removed while the server was off shows the content it had after the last edit; a change saved months ago and released shows its version; the chip opens the tab with the part already picked.
- [ ] **later · detail:** The rest of the walk through the files `mm36`
  - Parked on 2026-10-16 (triage): weight detail.
  - What is left of `mm26`: the files it uses and that use it for other languages (Python, Go and the rest, with the foundation's readers, `fd` series) and for path aliases; a new file not saved yet in "used by"; files of tens of thousands of lines drawn as they scroll instead of in slices of 1,500.
  - How to confirm it is done: a Python file lists its imports; a file just created by a conversation shows in "used by" of what it imports; a 50,000-line file scrolls smoothly to its end.
- [x] The skills and plugins on the balloons: per project, what is installed (from which repository), on or off and how heavy; per chat and per agent, which skills it opened now and what they weighed `mm52`
  - Read from the plugin folders and the transcripts, no AI. A skill opened by many agents shows its count and its weight, so a snowball is seen while it happens, not a week later.
  - From `id111`.
  - Built on 2026-10-13: `server/sources/skill-use.mjs` counts the Skill tool calls of a chat and its subagents (a skill opened by 3+ agents is a snowball); `listPlugins` in `server/sources/skills.mjs` gives each plugin its repository, listing weight and SKILL.md weight; the chat panel shows the one skills line and the Plugins tab shows from, on/off, skills, weight and opened this week.

### Ideas

- [x] **important:** Ideas tab: every request and idea, its life and whether it was done `mm27`
  - Reads the "Ideas and requests" part of the project (one item per request, with the owner's words, dates, meaning, check, destination and status). Life of an idea: new, accepted, in progress, done, later, discarded (a reason is required to discard).
  - Review mode: one idea at a time with Keep, Later and Discard; filters by status, date, part and "no destination yet"; each idea links to the item it went to and that item's chats.
  - The watcher marks an idea done when its destination item is ticked and its check passes, showing the proof (commit, test, release); an idea untouched for a while (accepted with no movement, later past its date) gets a reminder in "Waiting for you".
  - How to confirm it is done: the tab lists every item of the part with its status; Discard without a reason is refused; ticking a destination item with a passing check turns its idea done with a link to the proof; an idea accepted 14 days ago with no movement shows a reminder.
  - Built on 2026-10-16: the tab already listed every request with its words, dates, meaning, check, work and state (`requests.js`, `requestsview.js`); the **Review one by one** button now goes through the open ones, what can be closed first. **Keep** leaves it, **Later** parks it, **Discard** needs a reason, **Close** appears when every item it became is done (`unconfirmed`, computed from the items). A decision is `POST /api/arch/<project>/request` (`server/main.mjs`), which changes only that request's `Status` line and its tick (`server/arch/requestops.mjs`): the old status stays after "Before", nothing is deleted, the project's care mode decides whether it is written and an undo is recorded, a registry a chat wrote in the last 5 seconds answers `busy`, and the look-only link has no button. A project whose care mode is not chosen yet (or is "look") writes nothing and says where to change it.
  - Proof: `test/arch-requestops.test.mjs` (8), `test/server-requests.test.mjs` (3), `test/web-requests-review.test.mjs` (5); the browser smoke test opens the tab. What was not built from the first idea is `mm63`.
- [ ] **later:** Requests tab: filters by date and by part, and a reminder in "Waiting for you" for a request left untouched `mm63`
  - What `mm27` left out of the first idea (`id66`): filters by date and by part (the chips cover state, "waiting on you" and "no linked activity"), a reminder for a request accepted 14 days ago with no movement, and the proof (commit, test) next to a request marked done by its items. Parked on 2026-10-16: nobody has missed them yet; the review above clears the backlog these would have flagged.
- [ ] **later:** The technical dictionary of the page filled for every key, in both languages `mm64`
  - The vocabulary sweep of `id126`: the engine half is built (`terms` in `server/config.mjs`, `state.terms`, `applyTermsDefault`), and the spec for the sweep is `.dev/execucao/regra-termos-tecnicos.md`. The owner said on 2026-10-14 he would hand it to another chat; it has not come back. Parked on 2026-10-16: the page already speaks the technical words where the dictionary has them, and the test of the plain words (`test/web-plain.test.mjs`) keeps the other mode honest.
- [x] **Claude:** Live Changes tab: every file created, edited, deleted or renamed, with its diff `mm30`
  - From the steps in every conversation (helpers and workflows included) and the working tree: who, where (project › part › file), lines added and removed, before/after, saved → committed → released; the box lights up; deleted files keep their previous content; filters and a daily timeline.
  - Released in v0.2.3: `server/changes.mjs` reads every edit step and its result (and the commands that remove or rename files) from each conversation, its helpers and workflow agents, as the transcripts grow; `server/changes-state.mjs` places each file on its project and part, joins what the folder holds not saved yet (made by hand or another program shows as "outside the conversations") and finds the saved change and the version that carry it. The Changes tab: who (conversation or helper, with the model), where (project › part › file), lines added and removed, Not saved yet → Saved → Released, filters by project, part, conversation, kind and the period, a day-by-day line, and the before and after of each change (a removed file keeps its previous content: each pass keeps a masked copy of the files not saved yet in the session-map folder for 30 days, `server/snapshots.mjs`, so a file made by a script or by hand and then removed still shows what it had and appears as removed; the lines are masked like the chat; a secrets file never shows nor is copied). A box lights with "+N files +M lines now" for 10 minutes. What is left moved to `mm35`.
- [x] **Claude:** Workflows you can trace: from the request to every agent and the places it touches `mm31`
  - Tree request → workflow → agents → live footprint; one colour per workflow and a dot per active agent on its box, several projects at once; trace both ways between a request and its files, commits and release.
  - Released in v0.2.3: `server/sources/claude.mjs` keeps the owner's message right before each Workflow launch (its words, time and the item codes it names, also far back in a long conversation) and reads every agent of a run with its state (working, finished, failed), phase, model, last step and the files and commits it made; the phases still to come come from the running script. `server/workflows.mjs` places each agent on the project and part of its file (any repository), finds the map item the request names and the version that carries each commit. The page (`server/web/workflows.js`) draws the tree: what you asked → the team with its phase and n/total → each helper with its state in a word, model and place → where the team worked; Live shows it for every team at work (also when its conversation finished its turn) with a link to the whole trace in the conversation's panel (files, saved changes, "Released in v1.2.0"). Each team has its own colour, kept apart from the other teams on the page and away from amber and red; every box where a helper works carries a dot per helper and "N helpers", from teams of any project. A change made by a helper names its team in Changes, and its before and after shows the request that led to it. What is left moved to `mm37`.
- [x] **important:** The rest of the traceable workflows `mm37`
  - What is left of `mm31`: a page chat opened on a map point does not yet name that point as the request's item when the owner's words carry no item code; helpers started one by one (not in a team) have no request of their own; the request is the owner's message right before the launch even when that message answers something else (seen on real data: a reply about currency shown as the request of a whole team), so also show the words the conversation gave the team; the dots show on the open project's map only, and the Now strip cards do not yet carry the team colours.
  - How to confirm it is done: a team started from a page chat on a box shows "On the map: <box>"; a single helper's change in Changes shows the request before it; a Now card shows one dot per team in its colour.

### Released before the backlog moved into the parts

- [x] **Claude:** Conversation list, a column on the left of the map `mm28`
  - Every conversation of the last 31 days wherever it ran, as Working now, Waiting for you and Recent, with its place on the map, age, cost and origin; search; This project / All projects; a click opens the branches to its box and the conversation. Released in v0.2.2.
- [x] **Claude:** Live: what is working now, in every project `mm29`
  - One card per working conversation with its way down the map, latest steps, workflows (done/total) and helpers with their model; on the map the path to the box being worked lights up with the latest step. Released in v0.2.2.

### The second engine

- [x] **DeepSeek:** The DeepSeek mark and its buttons on the page `mm53`
  - From `id119`. The list marks a DeepSeek conversation with its own icon (`i-spark` in `server/web/index.html`) and the word DeepSeek (pt and en in `server/web/i18n.js`); the chat header, the list row and the ⋯ menu offer **Open in DeepSeek** instead of the VS Code and terminal buttons, and the sheet reads the conversation without a writing box or a Stop button.
- [x] The Flow tab's new level "O programa": the interface map and the blueprint drawn inside the system `mm57`
  - From request `id130`.
  - `server/census.mjs` reads the page's own screens from the code (the 13 areas, their view files, headings, buttons, dialogs, with the page's real texts) and the engine's blueprint; `GET /api/census/ui` serves it; the level's view (`server/web/programview.js`) draws the tree in the Flow tab; the external files in `.dev/prints` become exports of the same census. Verified live on 2026-10-14: 13 areas, 1096 itens.
- [x] Discover's airplane mode: one switch for the skills, and each installed plugin's own `mm58`
  - From request `id136`.
  - The config key `skills.airplane` (machine-wide, `server/config.mjs`), the state carries it (`server/collect.mjs`), the guard's `chatSkillSettings` honors it (every skill name-only, every plugin off except the program's own, `server/chat/guard.mjs` + `server/chat/hub.mjs`), the route `PATCH /api/settings/skills-airplane` flips it (`server/main.mjs`), and Discover draws the switch plus the installed plugins with their `rd09` switches (`server/web/discover.js`, `server/web/api.js`, the `discoverAirplane` panel in `index.html`, texts in both languages). Tested in `test/guard-agent-choice.test.mjs`; 99 verdes nas suítes afetadas. The professional names arrived with `id137`: "Skills kill-switch" and "Technical debt ledger" on the page.
- [x] Discover separates the installed skills, the installed plugins and the catalog `mm59`
  - From request `id138`.
  - The panel has three groups, in the professional terms: the kill-switch on top, "Installed skills" (each with its command and state), "Installed plugins" (each with its switch), and below the heading "Catalog — available to install" the GitHub items. `server/web/discover.js` (the panel), `index.html` (the catalog heading), `app.js` (the skills list), i18n pt/en. Verified served and 30 web tests green on 2026-10-14.
- [x] Each installed skill gets its own switch in Discover `mm60`
  - From request `id139`.
  - The config list `skills.off` (machine-wide), the state carries it (`server/collect.mjs`), the guard's `chatSkillSettings` honors it — an off skill stays name-only whatever the focus picks (`server/chat/guard.mjs` + `server/chat/hub.mjs`), the route `PATCH /api/settings/skill` flips one skill (`server/main.mjs`), and Discover draws a switch per skill (`server/web/discover.js`, `server/web/api.js`, `app.js`). Tested in `test/guard-agent-choice.test.mjs`; flipped live on 2026-10-14 (OFF/ON 200, config written); prova viva 8/8.
- [x] A "Logs" tab: problems first, grouped and in plain words, the raw lines only on a click `mm61`
  - From request `id159`.
  - Reads what already exists: `GET /api/logs` (`sv19`) and `GET /api/logs/projects/<id>` (`wa11`). Groups the warn/error lines by event, provider and error, shows how many times and when last; per-project record; raw JSON on a click. No new writer and no new route are needed to start. A fixed request-id field in the log lines (the one professional practice the log still lacks) is a separate, later step.
  - Built on 2026-10-16: `server/web/logs.js` (the numbers: groups, reasons), `server/web/logsview.js` (the page), `server/web/i18n-fd/screens-logs.js` (the plain sentences, English and Portuguese), `server/web/css/fd-logs.css`, the area `logs` in `nav.js` (global, under More) and the routes added to `api.js`. A problem is one row (`event` + provider + error) with its count, first and last time, the reason in words, whether it still happens (seen in the last 24 hours) and its newest technical lines; the routine and the per-project record sit under it. 15 tests in `test/web-logs.test.mjs`. Still missing: a fixed request-id field in the log lines.
- [x] The program has a smoke test of its own: the page and its reads, and the page in a real browser `mm62`
  - From the finish plan of 2026-10-16 ("do not break what is done"). `scripts/smoke.mjs` reads the running server the way the page does (the page and every module it loads, 37 reads for the project and its Foundation), saves the status and the keys of each answer, and `--compare` names what a change took away. `scripts/smoke-browser.mjs` opens the map in a headless Chrome or Edge, goes to each area and each sub-page, and writes down script errors, console errors, refused requests, a text key shown raw (a missing translation) and a top bar wider than its room. Both only read.
  - Found with it on the first day: parked items showed `requests.act.later` raw in the Requests tab (a text missing for the new `later` state), and the four Foundation tabs said "arrives in the next version" (`fd26`). `test/smoke.test.mjs` (4).
- [x] The level "O programa" redrawn: a room per area, real words only, no key needed, with tests `mm65`
  - From request `id160`. Measured before: 18 junk labels and 72 unnamed parts among 901 items, the Flow's own buttons missing, Logs empty, a 401 without the key, no test (`mm57` had been ticked on a live check alone).
  - `server/census.mjs`: a text counts only when it is a real key of the page's texts (the regex no longer matches `split('x')` or `text('x')`), a part takes its first label only, a part with no words is counted as unnamed and never named, texts that show only when something is empty or wrong are `message`s, index.html is read for the map, the Flow and Discover (the level buttons, the export menu), the Logs area has its files, and one room, "Shared by every area", holds every page file no area claims, found by walking `server/web`. `server/censusroute.mjs` reads with no key on this PC, like the Flow (`fl04`); `server/web/programview.js` draws a card per area with chips for buttons, the texts one click away, "Show all", a search and the counts. Measured after: 15 rooms, 116 sections, 195 buttons, 1149 texts, 160 unnamed parts counted apart.
  - Proof: `test/web-program.test.mjs` (15), and the level seen live on a separate copy of the program, with a search and a long room.
- [x] The level "O programa" as a floor plan: a room per area, a block per button, a line per text, walked into with a click `mm66`
  - From request `id160`. The "Floor plan" view is the new default and "List" keeps the cards. Each area is a room sized by how many boxes it holds (`spanOf`), each section a dashed box with its title, each button a colored block as wide as its word (`blockWidth`), a window or fold in amber, each text a grey line (four at most, the count in the hover), the messages a dashed bar, the pieces with no words of their own as hatched blocks (twelve at most, the whole count in the hover). A search lights the blocks that say the word and keeps only the rooms that hold it. A click walks into the room: every section at full size, the buttons drawn like buttons with their words, every text readable.
  - `server/web/programplan.js` (the layout, pure), `server/web/programstyle.js` (the look), `server/web/programview.js` (the drawing). Seen live on a copy of the program, on a computer and at phone width (no sideways scroll). Proof: `test/web-program.test.mjs` (20).
  - Still not done: the engine's own blueprint (parts with their files, functions, tests and health) inside the system, and which button works or needs fixing.
- [x] The project list puts away the folders that are not projects he keeps, behind one row that opens to say why `mm67`
  - From request `id161`. The server tells each project why its folder is not one he keeps (`scratch`: `gone`, `temp`, `tool`; `server/scratch.mjs`, set in `buildProject`; a folder made through the page or kept always on is never one). The picker keeps the others behind "N other folders", with their marks added up (a helper working in one is still seen); opened, each shows its reason. The open project stays in the main list. The Início, the conversations of "all projects" and the Costs tab still list every project, so no count or cost changes.
  - Proof: `test/scratch.test.mjs` (2), `test/web-around-shell.test.mjs` (the picker, one test more). Not done: the Início and the "all projects" list still show these folders; a button to put one away or bring one back by hand.
- [x] On hover the title of a conversation ends before its cost and ⋯ `mm68`
  - From request `id162`. Each card says how many characters its cost has (`--cv-cost-ch`) and the time's column keeps that room on hover (`style.css .cv-line:hover .cv-when`); a touch screen keeps none. Proof: `test/web-convlist-inbox.test.mjs` (one test more), and the gap measured live: 8 px.
- [x] `projectsRoot` in the settings: what sits outside the folder he keeps his projects in waits behind "other folders" `mm69`
  - From request `id163`. `scratchWhy` (`server/scratch.mjs`) answers `outside` for a folder not inside one of the folders `projectsRootsOf` reads from `config.json`; a gone, temp or tool folder says that first. No setting, nothing is outside. Documented in both READMEs. Proof: `test/scratch.test.mjs` (3). The folder is now chosen on the page (`mm70`). Not done: the Início and the "all projects" list still show these projects.
- [x] The folder chooser: walk the PC's folders, pick one, and the repositories in it are the projects `mm70`
  - From request `id164`. Server: `server/folders.mjs` (`listFolders`, `findRepos`, `reposIn` kept a minute, `setProjectsRoot`), routes `GET /api/folders`, `GET /api/folders/repos`, `POST /api/settings/projects-root` in `server/main.mjs` (the page's token; not for the demo or the look-only link); `collect` lists the repositories of the picked folders as projects, and `state.projectsRoot` carries the choice. Page: `server/web/folderpick.js` (the dialog), a "Project folders…" row in the picker (`server/web/picker.js`), `api.js`, the texts in both languages (plain by default: "projetos"; technical: "repositórios git"). Proof: `test/folders.test.mjs` (8), `test/web-folderpick.test.mjs` (9), and seen live in a browser on a separate copy of the program.
  - Not done: the New project dialog still asks for the folder by typing; the same chooser could fill it. A project found in a picked folder is still a project in the Início and the "all projects" list, as every project is.
