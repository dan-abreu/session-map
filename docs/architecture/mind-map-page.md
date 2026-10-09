# Mind map page

The browser page: a tree from the project through layers and parts to groups and items, with the chat docked on the right. On a phone the same tree is an indented list.

## How it works

Plain ES modules and a vendored `d3` for zoom and drag, no build step. Clicking a box opens its panel and a chat on that point. A green dot pulses where a chat is working; "Show relations" draws dotted lines between related parts; "What changed" lights today, 7 or 30 days. Open or closed state, search and zoom are remembered per project.

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

- [ ] **important:** Conversation list grouped by project, with the project on every row `mm04`
  - In "All projects": one collapsible header per project (name, color, working and waiting counters), like project folders in Claude or ChatGPT and channels in Slack. Every row shows a project badge, also in "This project".
  - Inside a project: the orchestration chat pinned on top, then Working now and Waiting for you, then by date (Today, Yesterday, Last 7 days, Older). The Now strip and the alerts use the same order and badges.
  - Test: in "All projects" no row lacks the project name.
- [ ] **important:** Show every conversation exactly like Claude Code shows it `mm22`
  - Every message from both sides with the same formatting (markdown, tables, code, links), the time of each message and the date when the day changes, Claude's steps (read, ran, edited) as collapsible blocks, multiple-choice questions with the owner's answer, images, nested helper agents, cost per reply and total.
  - Search inside a conversation, jump to a day or time, and a live mirror for a conversation still running. Secrets in steps shown masked.
  - Applies to every origin (VS Code, terminal, map) and to archived conversations, including ones Claude Code already deleted.
- [ ] **important:** Move and rename a conversation with one click `mm21`
  - Move a conversation to another project or part (the placement learns from it); rename it with a title that makes sense to the owner.
  - Why: a long chat opened in one project's folder about another project landed in the wrong project and part, under an automatic title that did not say what it was about.
- [ ] **important:** Relations you can zoom, select and read `mm05`
  - Wider zoom range, +/−/fit buttons, pinch on phones, a click on a box centers it.
  - A wide invisible hit area (about 16 px) on every line, a summary on hover ("A ↔ B · 3 reasons") and a "Relations" list sorted by strength that lights the line when clicked.
  - Relation panel: both parts, strength, every reason with its evidence (chats, branches, commits, shared files, spec excerpt, the AI's explanation), since when, confirmed or detected. Actions: open the chats, put it on the Flow drawing, ignore it (kept per project).
- [ ] **important:** Bank-statement-style date range `mm06`
  - Buttons Today, 7, 15, 30, 60, 90 days, This month, Last month, Custom. Custom has From and To fields and a two-month calendar (click the start, click the end, the range is painted), Apply and Clear; on phones a one-month calendar in a bottom sheet.
  - The range shows on the button ("3–9 Oct"), is remembered per project and applies to "What changed", History, Costs and Activity.
- [ ] **important:** Panels separated by kind of information `mm07`
  - Distinct blocks with their own color, icon and plain title: Tasks, Chats, Lines of work (branches), What changed, Files. Each block says where its data comes from.
  - Tabs in the panel (Summary, Tasks, Chats, Changes, Files); the Summary shows only the essentials. The same colors and icons for each kind everywhere: map, lists, Now strip, alerts.
- [ ] **important:** Visual polish of the whole program, written down in `DESIGN.md` `mm08`
  - One visual system: type scale, spacing grid, semantic palette (light and dark, AA contrast), one icon set, identical components with every state, short purposeful motion that respects reduced motion.
  - Empty screens with a simple illustration and a sentence, skeletons while loading, nothing cut off or overlapping on desktop and phone.
  - Screen-by-screen polish with a review of screenshots; the owner approves the screenshots before anything is published. The tokens and components go in `DESIGN.md` for later versions to follow.
- [ ] **important:** Global fixed "Now" strip across all projects `mm09`
  - Always visible on every tab, never filtered by the chosen project: switching project, tab or scrolling does not change it. Test: its content is the same whichever project is selected.
  - One card per running job in any repository: where (project › part › item), live last step, how long, model and helpers (n/total). Waiting for you comes first, in amber.
  - A click switches project and opens the point on the map and its chat. It scrolls sideways, collapses to a line ("3 working · 2 waiting · 1 finished") and is a one-line button opening the list on phones.
- [ ] **important:** Badges per project in the project picker `mm10`
  - A pulsing green dot if something works there, an amber number of items waiting, a check for "finished and not yet seen". That last mark stays until the chat is opened.
  - The tab title shows the count, like "(2) session-map".

### Plain language

- [ ] **Plain-language round across the whole program** `mm11`
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
