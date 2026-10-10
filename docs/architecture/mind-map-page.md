# Mind map page

The browser page: a tree from the project through layers and parts to groups and items, with the chat docked on the right. On a phone the same tree is an indented list.

## How it works

Plain ES modules and a vendored `d3` for zoom and drag, no build step. Clicking a box opens its panel and a chat on that point. A green dot pulses where a chat is working; "Show relations" draws dotted lines between related parts; "What changed" lights the parts that moved in the period picked on a bank-statement-style button (also used by History, Costs and the activity lists). Open or closed state, search and zoom are remembered per project.

## Where in the code

- `server/web/`

## Rules that must not break

- English and Portuguese texts stay in step.
- Every state works without hover and respects reduced motion.

## What's missing

### Views

- [x] **Claude:** Mind map and an outline for phones `mm01`
- [x] **Claude:** Board as columns of items `mm02`
- [ ] **detail:** Drag an item to another part `mm03`

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
- [ ] **important:** The rest of the chat experience `mm23`
  - History opens an archived conversation in the same chat sheet, with search and jump (today it reads in its own pane, with the same drawing but no search bar).
  - Answer Claude's multiple-choice questions from the page in a page chat, and attach files that are not images (today only images; a project file is pointed at with `@`).
  - The built-in `/` commands of Claude Code that work in a page chat, beside the skills.
  - On a phone, the chat sheet uses the whole height under the top bar (today the map's toolbar leaves it about half the screen).
  - The chat header on one line (title, model and mode, cost), as the owner asked (`id56`); `mm08` left two short lines so the mode stays in sight of someone who does not program. The owner decides between the two.
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
- [ ] **important:** The AI's plain-words reason for a relation `mm32`
  - What is left of `mm05`: the relation panel shows every reason with its evidence (chats, files, branch, last commit, plan), but not a sentence from the AI saying why the two parts are tied.
  - One cheap AI call per relation, cached in the session-map storage and redone only when its reasons change.
- [x] **Claude:** Panels separated by kind of information `mm07`
  - Distinct blocks with their own color, icon and plain title: Tasks, Chats, Lines of work (branches), What changed, Files. Each block says where its data comes from.
  - Tabs in the panel (Summary, Tasks, Chats, Changes, Files); the Summary shows only the essentials. The same colors and icons for each kind everywhere: map, lists, Now strip, alerts.
- [x] **Claude:** Visual polish of the whole program, written down in `DESIGN.md` `mm08`
  - One visual system: type scale, spacing grid, semantic palette (light and dark, AA contrast), one icon set, identical components with every state, short purposeful motion that respects reduced motion.
  - Empty screens with a simple illustration and a sentence, skeletons while loading, nothing cut off or overlapping on desktop and phone.
  - Screen-by-screen polish with a review of screenshots; the owner approves the screenshots before anything is published. The tokens and components go in `DESIGN.md` for later versions to follow.
  - The chat panel must leave most of its height to the dialogue (owner's complaint: raw text and a huge input box): messages rendered as markdown like Claude Code (headings, bold, lists, tables, code blocks with copy, links); the input box starts at one line and grows with the text up to about 40% of the panel, then scrolls; compact header (shipped as two short lines, the title and then model, mode and cost; the single line is open in `mm23`); the permission and mode controls collapse when not in use; on the phone the input stays docked above the keyboard.
  - The conversation list's obvious divisions were planned here but not done: they moved to `mm33`.
- [ ] **important:** A conversation list whose divisions show at a glance `mm33`
  - Why: the owner on 2026-10-09: "não da pra saber quando o chat é o claude ou vs, nao ta seperado os chats", and earlier "too little difference to understand what is divided". Today a row has only a coloured dot for its state (the word is for screen readers), the group titles scroll away, and the project badge is cut off on every row ("acme-sh" at 1440 px).
  - Every row with a status chip in colour and word (Working, Waiting for you, Finished, Closed), the origin badge with icon and word (VS Code, Terminal, Map, Phone), the place in the map on its own line, and time and cost on the right; "finished and not yet seen" rows highlighted until opened.
  - The groups (Working now, Waiting for you, Today, Yesterday…) as clearly titled sections with icon, colour and count, extra space between them, and titles that stay on top while their rows scroll (today only the project folder's title does).
  - Each project as a card with its colour band and name, in "This project" too; the project badge never cut off, or left out inside the project's own card, where it only repeats.
  - How to confirm it is done: screenshots at 1440 px and on a phone, in both themes: every row shows its state in a word, no text is cut off, a group title stays on top while its rows scroll, a finished conversation not yet opened stands out; a test fails if a row has no state word.
  - Done so far (2026-10-09 real-data check): the project badge keeps its size on every row and Now card (only a very long name ends in "…"), and a chat the page started reads "Map" even when the page's own record of it is gone (it said "Automation"). The rest above is still open.
- [x] **Claude:** Global fixed "Now" strip across all projects `mm09`
  - Always visible on every tab, never filtered by the chosen project: switching project, tab or scrolling does not change it. Test: its content is the same whichever project is selected.
  - One card per running job in any repository: where (project › part › item), live last step, how long, model and helpers (n/total). Waiting for you comes first, in amber.
  - A click switches project and opens the point on the map and its chat. It scrolls sideways, collapses to a line ("3 working · 2 waiting · 1 finished") and is a one-line button opening the list on phones.
- [x] **Claude:** Badges per project in the project picker `mm10`
  - A pulsing green dot if something works there, an amber number of items waiting, a check for "finished and not yet seen". That last mark stays until the chat is opened.
  - The tab title shows the count, like "(2) session-map".

### Plain language

- [x] **Claude:** Plain-language round across the whole program `mm11`
  - Clarify every screen so it is understood at a glance: jargon becomes simple words in English and Portuguese (diagram file → drawing, workflow and agents → team of helpers, branch → line of work, commit and merge → saved and joined, token cost → what it cost), with a "technical details" mode showing the original terms.
  - Icon plus text always, a "?" per area with one sentence, empty screens that say what to do, a five-step welcome tour (skip and replay), advanced options grouped in one place.
  - Scope is everything: tabs, panels, Now strip, lists, chats, every error, warning, confirmation and alert (what happened and what to do, never raw codes), install and first use, the settings texts.
  - Test: a reviewer with a lay persona looks at screenshots of each screen and answers "do I understand in 5 seconds?"; what fails is redone before release. Skills, terminal view and READMEs are in `pt03` and `pt05`.

### Later (ideas, not committed)

- [ ] **detail:** Edit files and folders inside the page (create, rename, delete, save) `mm12`
- [ ] **detail:** A terminal inside the page `mm13`
  - Needs a native module, which breaks the no-npm rule; decide before starting.
- [ ] **detail:** Create and drag cards by hand in the Board `mm14`
- [ ] **detail:** Zoom inside a part: its files as dots tied to the chats and commits that touched them `mm15`
  - "This chat touched these 3 files".
- [ ] **detail:** More mind map exports: Markdown outline, XMind, FreeMind `mm16`
  - draw.io, PlantUML and Graphviz are covered by the Flow part (`fl13`, `fl14`).
- [ ] **detail:** Discover: recommended for this project, trust badge, hand-picked lists `mm17`
  - The AI reads the project's architecture and stack and explains what fits; open a repository and list its skills translated; trust badge from last update, license, issues and an optional audit.
- [ ] **detail:** Discover for every AI, not only Claude `mm18`
  - A "Works with" filter (Claude, Codex, Gemini, Cursor, any = MCP); new sources: the official MCP server registry, Gemini CLI extensions, Codex, Cursor rules and SKILL.md skills (check who accepts them).
- [ ] **detail:** "Which AI for each task" section (video, image, voice, bulk text, code) `mm19`
  - What each is good for, price and API. It is the base of the Arsenal idea (`or11`).
- [ ] **detail:** Discover updates itself in the background and pages past 50 results per topic `mm20`
  - Today it refreshes only when the tab opens after 24 hours or on the Update button.

### Where the work really is

- [x] **Claude:** Real footprint of every conversation, file by file `mm24`
  - From each conversation's edited and mentioned files, plus the edits of its helpers and workflows, find every project and part it really touches (by the parts' paths): it shows in each project it touches ("born in A · working in B"), and its parts light in proportion to the files edited there.
  - Live lights the part of the file in the latest step; before work starts, the orchestration says "will touch: A, B, C". A middle level of components sits between a part and its items (level 2 of `fl09`, also on the mind map), and an item that spans parts shows in each, linked. Refined later with the census (`fd01`).
  - How to confirm it is done: a chat opened in project A that edits files of project B is listed in both with "born in A · working in B"; the parts it edited light with a share matching the files edited; Live lights the part of the file named in its last step.
  - Done on main: the project of each edited file is the git repository it lives in (a worktree counts as its main checkout), the part is the one owning the file on that map; libraries, generated files, binaries and the Claude folder never count; a project only edited shows up though no conversation started there. The conversation stays listed (with its cost) at home and shows elsewhere under "Also working here"; its parts there carry a "This conversation · 40%" chip while it is open; a step outside its folder shows only its last folders. "Will touch", the middle level and items spanning parts moved to `mm34`.
- [x] **Claude:** Files, lines and share of the program in every box `mm25`
  - Each box shows its files, lines and % of the program, summed on the levels above; a Files panel per box lists them by folder (lines per file), split by kind (screens, server, tests, docs) and what changed in the period; the root shows "N files with no box on the map" in a strong color.
  - Base: files assigned to parts by their paths over `git ls-files`, counted by session-map itself; exact numbers from the census (`fd01`).
  - How to confirm it is done: the root's count equals the number of tracked files minus the ones left out on purpose; every layer equals the sum of its parts; the "no box" number equals the census list of files without an owner.
  - Done on main: `server/sources/count.mjs` counts every tracked file line by line (no dependency, recounted at most every 30 s and only the files that changed) and `server/arch/sizes.mjs` gives each file one owner (the deepest path; the first part on a tie). The project panel lists the files with no box and what was left out, by reason; a part's Files tab shows lines per file and the split by kind. What changed in the period inside the Files tab moved to `mm34`; the census (`fd01`) refines the numbers.
- [ ] **important:** The rest of the real footprint `mm34`
  - What is left of `mm24` and `mm25`: before work starts, the orchestration says "will touch: A, B, C"; a middle level of components between a part and its items (level 2 of `fl09`, also on the mind map); an item that spans parts shows in each, linked; the Files tab of a box marks what changed in the period.
  - How to confirm it is done: an orchestration plan lights the parts it names before the first edit; a part opens into its components with the files of each; an item whose files sit in two parts shows in both with a link; the Files tab with "last 7 days" picked marks the files changed in that week.
- [x] **Claude:** Walk through the files of a box `mm26`
  - A file tree per box like VS Code's explorer; code colored, with line numbers and search in the file; jump to the files it uses and the files that use it (import graph); Open in VS Code at the line.
  - How to confirm it is done: open a part, expand its tree, open a file: line numbers and colors show; search finds a word; "used by" lists the files that import it; Open in VS Code lands on that line.
  - Done on main: the Files tab of a box is a folder tree like the editor's explorer (folders first, single-folder chains on one line, open folders kept while the page lives); a file opens with the code in colors (our own small reader, no dependency), line numbers, search in the file with next and previous, the files it uses and that use it with the line of each (`server/imports.mjs` reads the import lines of JavaScript, TypeScript, CSS and HTML over the saved files) and the libraries it asks for; a click on a line picks it for Open in VS Code. Other languages, new files not yet saved and very long files go on in `mm36`.
- [ ] **important:** The rest of the Changes tab `mm35`
  - What is left of `mm30`: an edit made by a command the conversation ran (a script, a formatter, `sed`) reads "outside the conversations": tie it to the conversation whose step ran just before the folder changed; the release is looked up for the newest 60 saved changes of a project (older ones read "Saved"); a click on a box's "+N files" chip opens the Changes tab filtered to that part.
  - How to confirm it is done: a conversation that runs a formatter shows those files under its name; a change saved months ago and released shows its version; the chip opens the tab with the part already picked.
- [ ] **detail:** The rest of the walk through the files `mm36`
  - What is left of `mm26`: the files it uses and that use it for other languages (Python, Go and the rest, with the foundation's readers, `fd` series) and for path aliases; a new file not saved yet in "used by"; files of tens of thousands of lines drawn as they scroll instead of in slices of 1,500.
  - How to confirm it is done: a Python file lists its imports; a file just created by a conversation shows in "used by" of what it imports; a 50,000-line file scrolls smoothly to its end.

### Ideas

- [ ] **important:** Ideas tab: every request and idea, its life and whether it was done `mm27`
  - Reads the "Ideas and requests" part of the project (one item per request, with the owner's words, dates, meaning, check, destination and status). Life of an idea: new, accepted, in progress, done, later, discarded (a reason is required to discard).
  - Review mode: one idea at a time with Keep, Later and Discard; filters by status, date, part and "no destination yet"; each idea links to the item it went to and that item's chats.
  - The watcher marks an idea done when its destination item is ticked and its check passes, showing the proof (commit, test, release); an idea untouched for a while (accepted with no movement, later past its date) gets a reminder in "Waiting for you".
  - How to confirm it is done: the tab lists every item of the part with its status; Discard without a reason is refused; ticking a destination item with a passing check turns its idea done with a link to the proof; an idea accepted 14 days ago with no movement shows a reminder.
- [x] **Claude:** Live Changes tab: every file created, edited, deleted or renamed, with its diff `mm30`
  - From the steps in every conversation (helpers and workflows included) and the working tree: who, where (project › part › file), lines added and removed, before/after, saved → committed → released; the box lights up; deleted files keep their previous content; filters and a daily timeline.
  - Done on main: `server/changes.mjs` reads every edit step and its result (and the commands that remove or rename files) from each conversation, its helpers and workflow agents, as the transcripts grow; `server/changes-state.mjs` places each file on its project and part, joins what the folder holds not saved yet (made by hand or another program shows as "outside the conversations") and finds the saved change and the version that carry it. The Changes tab: who (conversation or helper, with the model), where (project › part › file), lines added and removed, Not saved yet → Saved → Released, filters by project, part, conversation, kind and the period, a day-by-day line, and the before and after of each change (a removed file keeps its previous content; a secrets file never shows). A box lights with "+N files +M lines now" for 10 minutes. What is left moved to `mm35`.
- [ ] **important:** Workflows you can trace: from the request to every agent and the places it touches `mm31`
  - Tree request → workflow → agents → live footprint; one colour per workflow and a dot per active agent on its box, several projects at once; trace both ways between a request and its files, commits and release.

### Released before the backlog moved into the parts

- [x] **Claude:** Conversation list, a column on the left of the map `mm28`
  - Every conversation of the last 31 days wherever it ran, as Working now, Waiting for you and Recent, with its place on the map, age, cost and origin; search; This project / All projects; a click opens the branches to its box and the conversation. Released in v0.2.2.
- [x] **Claude:** Live: what is working now, in every project `mm29`
  - One card per working conversation with its way down the map, latest steps, workflows (done/total) and helpers with their model; on the map the path to the box being worked lights up with the latest step. Released in v0.2.2.
