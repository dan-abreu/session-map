# Changelog

## 0.2.5

Everything you asked for, in one place: the Requests tab shows each request in your own words and the work it became.

- New: the Requests tab. Every request with its dates and your words, grouped as In progress, Planned, Deferred,
  Completed and Discarded, with the activities it became, how many are completed, the version it was released in and
  its acceptance criteria. Filters for "Waiting on you" and "No linked activity", search, one project or all; a click
  on an activity opens it on the map. A request whose activities are all done shows as completed, awaiting
  confirmation.
- New: the Operation part holds the work that changes no code (research, accounts, releases, your decisions), so every
  request becomes at least one activity; the Flow draws neither the requests nor the operation.
- New: chats in Claude Code with the plugin write each new request the same day, in your words, and turn it into work.
  A project whose repository has no list keeps it in session-map's folder, never in the repository.
- New: the Board says which request each card came from.
- New: a list kept in another language shows its words translated for the page's language.
- Fixed: a test of the kept copies of removed files that failed once the real day passed its date.

## 0.2.4

The chat now sits where you work: under the box you clicked, always at hand, and every project has its own chats
about the whole project.

- New: project chats. The project box opens the whole project (what is open, its size, what waits for you, what works
  now) with a "Project chats" list, and "New chat" at the top of the map and of the conversation list starts a chat
  about the whole project, like "New chat" in Claude. Its first message carries a short summary of the project (never
  its history), so Claude knows the layers, the parts and what is missing. Many per project; each can be reopened,
  renamed and archived.
- New: a click on a box opens its information on top (Summary, Tasks, Conversations, Changes, Files) and the chat
  about that box right under it, with the box to write in always on screen. While you talk, the information folds to
  one line with what matters at a glance; a click opens it again. The line between them can be dragged.
- New: each box keeps its own conversation. Open another box and the first one keeps working; come back and it is
  there, whole. "New chat" starts a fresh one on any box.
- New: a new chat offers ready first questions ("What is missing in…?", "Explain … in plain words", "Start the next
  task of…"). A click writes the question in the box; nothing is sent until you press Send.
- Changed: the chat looks like Claude's. The way it runs, the model, the effort and the permissions live in one
  compact button by Send ("Automatic · Opus · high"); the header is one thin line; replies' headings are close to the
  text size.
- Fixed: every file in the Files tab opens. The project box shows the whole program as a folder tree, its lists of
  files with no box open too, and a file row says "opening…" while it loads; the code shows at once.
- Fixed: a click on a box showed only the chat; its information is back, first.
- Fixed: Send works on the first click; the "Finished" line and the alerts read as plain words.

## 0.2.3

session-map now keeps an eye on every conversation for you, shows exactly what each one changed, and reads in plain
words from the first visit.

- New: alerts. The server looks at every conversation on the PC every 10 seconds, page open or not, and tells you
  when one finishes, waits for you (a question, a permission), stops in the middle or fails, or when two lines of
  work start to clash. They arrive as a desktop notification (on by default, a click opens the conversation), in
  the page with a bell to pick what you want (browser, sound, phone through ntfy, per project), and in the tab title.
  A page chat always shows one clear state: working, waiting for permission, finished, interrupted or error.
- New: the conversation list reads like project folders. "All projects" shows one folder per project, with the
  orchestration chat on top, then Working now, Waiting for you, Today, Yesterday, Last 7 days and Older. Every row
  has a state chip, a badge for where it runs (VS Code, terminal, the Claude desktop app, phone through Remote
  Control) and its place on the map. A "..." button moves or renames a conversation, and your choice wins over the
  automatic one. The project picker shows each project's color, what works there and what waits.
- New: the Now strip, fixed under the top bar on every tab, with one card per job across all projects: waiting for
  you first, then working, then finished and not seen yet.
- New: every conversation reads like Claude Code: messages with their time, thinking, each step with what went in and
  came out, edits as before and after, the task list, questions and answers, images and helper agents. Search, a jump
  list by day, and a live mirror of a conversation still running elsewhere. The composer takes images, `@` files,
  `/` skills, Esc to stop and arrow up to recall the last message.
- New: the Flow tab opens on this PC without the key, shows an automatic draft when the README has no diagram (with
  Improve with the AI and Save to project), and exports the drawing as SVG, PNG, Markdown or `.mmd`.
- New: relations you can read: zoom, a list sorted by strength, and a panel with every reason and its evidence.
- New: one period for What changed, History, Costs and the activity lists, like a bank statement: Today, 7 to 90
  days, this month, last month or your own dates on a calendar.
- New: signs that explain themselves. Every sign says what it is, why it is happening and what to do now, with the
  button that does it (a clash between two lines of work can be resolved with the AI, which joins nothing before your
  OK). A part's details are split into Summary, Tasks, Conversations, Changes and Files, each with its own color.
- New: a welcome tour of five steps, a "?" next to every area, a help menu with a glossary and a "Show technical
  words" switch; plain words by default in English and Portuguese; friendly empty screens; and DESIGN.md, the visual
  system the page follows.
- New: the real footprint of each conversation. It shows on every project and part whose files it edited, its helpers
  included ("born in X, working in Y"). Every box counts its files and lines, the project lists the files with no box,
  and the Files tab is a folder tree whose files open with colors, line numbers, search and the files they use.
- New: the Changes tab. Every file created, edited, removed or renamed by your conversations and their helpers shows
  up within seconds, with who did it, where, and whether it is not saved yet, saved or released; filters, a
  day-by-day line and the before and after of each change. A removed file keeps what it had.
- New: teams of helpers you can follow: what you asked, the team, each helper with its state and model, and where it
  worked, in Live and in the conversation's panel, with a dot on every box a helper is touching.
- Security: secrets are masked in more places: keys with a prefix in `.env` files (`DB_PASSWORD`, `JWT_SECRET`...),
  values under a secret's name, passwords inside links, and every before and after in the Changes tab. Reading an
  archived conversation now needs the key. A path written like a network share is never looked up, so Windows never
  sends your sign-in to another machine.
- Fixed: after a restart the page opens at once (it waited about a minute), and a long conversation no longer slows
  the whole server down.
- Fixed: a search or filter with no results no longer freezes the page's refresh.
- Fixed: chats started from the map always read "Map", even when their page record is gone.

## 0.2.2

Every conversation in one place, what is being worked on right now, and a say in which model does the work.

- New: the conversation list, a column on the left of the map (a rail when folded, a drawer on the phone). It lists
  every conversation of the project from the last 31 days, wherever it ran (map, VS Code, terminal, automation),
  grouped as Working now (with the latest step), Waiting for you and Recent, each with its place on the map, age, cost
  and origin. Search, This project / All projects. A click opens the branches down to its box, centers it with a
  short pulse and opens the conversation beside the map; VS Code and terminal conversations show their history with
  Open in VS Code / Open in a terminal. The conversations that create the map and the New idea ones are listed too.
  Each box shows how many conversations it holds, and a click on the number filters the list.
- New: Live. The Live button counts what is working now in every project and opens Working now: per conversation, its
  way down the map, its latest steps, its workflows (done/total) with the helper agents still running and their model,
  Show on map and Open conversation, refreshed every 5 seconds. On the map the way to the box being worked on lights
  up, with the latest step under it. Workflow agents silent for 30 minutes are left out.
- New: how a page chat runs. Automatic (the default) has Opus at high size each request: direct for small ones,
  helper agents with an explicit model and effort for medium ones, and, for large or sensitive ones, a plain-words
  explanation with a cost estimate and Yes / No buttons before the reinforced way; such a chat waits under Waiting for
  you. "May reinforce on its own" goes ahead within a monthly limit (`budget.reinforcedMonthlyUSD`). Manual offers
  Maestro, Ultracode (`--effort ultracode`, after a cost warning), Fixed model (Haiku, Sonnet or Opus at low to max)
  and Same as my Claude. The chat header shows the way, the model and effort that really run, the conversation's cost
  and why.
- New: "Waiting for you" counts the open project, with a toggle for all projects.
- New: the import preview of the Flow tab lists, on their own line, the relations that become README arrows.
- Fixed: the chats that make a map or add an idea name a person on an item only when it needs one (a decision, an
  account, a payment, something physical); they used to put people on code work.
- Fixed: right after a restart, the Flow tab answers from the saved copy of the state instead of waiting for the
  first full read of the history.
- Fixed: workflows show their name (Claude Code keeps it as `workflowName`, and in the script's file name while the run
  is going) instead of their id.
- Fixed: "Same as my Claude" reads the effort as Claude Code does: a level saved under the model's full name
  (`claude-opus-5-5`) applies to its alias (`opus[1m]`), and the user file's top-level `effortLevel`, which Opus 5.5
  ignores, is no longer shown for it.

## 0.2.1

The architecture's diagram gets its own tab, and it goes both ways: export it, edit it by hand or with a chat, and
bring it back into the repository after a preview.

- New: the Flow tab. The architecture's mermaid diagram, drawn with a pinned copy of mermaid shipped with the plugin
  (no CDN, strict security level). Each box tied to a part is colored by its situation, with marks for blockers and
  people waiting, and opens that part's chat and details beside the drawing. The README's own arrows are drawn as
  they are; the relations session-map found fill in, dotted, only when the README has no arrows.
- New: export the map as a mermaid flowchart (Copy, Download `.mmd`), and import one back: paste or pick a file, see
  what changes (new parts and the file each gets, moves, parts left out, arrows), then confirm. Only the README's
  mermaid block and a skeleton file per new part are written; nothing is deleted; each apply goes to `actions.log`.
- New: the flow workshop, a shared draft per project. A side chat redraws it from every reply, and tools add boxes,
  arrows and layers, rename, move and remove, with a text editor and undo/redo. Nothing reaches the project until you
  apply it through the import preview.
- New: the chat sheet is as wide as you drag it (arrow keys too; a double click resets), on the map and in the
  workshop.
- Fixed: maps that list only open items read "N open" instead of "0 of N done".
- Fixed: a layer with no arrow in or out no longer pushes the drawing apart (mermaid laid it far from the rest, with an
  empty middle); it stays beside its neighbour, on the screen only.
- Fixed: holding an arrow key on the chat sheet's edge keeps widening it; each press used to measure the old width.

## 0.2.0

The map is now your project's architecture, read from plain markdown in the repository, with every conversation and
branch hung on its parts.

- New: the architecture map. session-map reads the folder set in the config `architecture`, else the first of
  `docs/arquitetura`, `docs/architecture`, `docs/arch`, from the working tree or, failing that, from the main branch
  (from `origin/main` when the local `main` is behind it). The folder's `README.md` gives the layers (a mermaid
  `subgraph` block or `##` headings); each part file gives its paths ("Where in the code") and its checklist ("What's
  missing"), in English or Portuguese, with item codes, status, who, weight and roadmap step.
- New: the mind map page. A horizontal tree of project, layers, parts, groups and items that opens and closes, with
  zoom, drag, search and the open boxes remembered; an outline on the phone. Each box shows done/total, items with you,
  items that block, conversations, who has a branch there, a pulsing dot where a chat is working and a red badge when
  two branches touch the same file.
- New: "Relations" draws dotted curves between parts that share chats, branches, lineage or file links, with the
  reason on tap; "What changed" (today, 7 days, 30 days) lights only the boxes with activity.
- New: the Board lists every item of the map in columns (to do, in progress, done), items that block or wait for a
  person first.
- New: "Waiting for you" gathers items with you, roadmap decisions, branch clashes and chats that ended with a
  question.
- New: chat on any point of the map. The first message carries that point's context (path on the map, the part's
  description, the item's text and file) and the rule that keeps the map true: a new request becomes an item, starting
  marks it in progress, finishing ticks it.
- New: "New idea" opens a chat on the whole project. It proposes the part (or a new part) and the group, shows the line
  it would add, and writes it only after your OK.
- New: projects with no map show a banner to create one: a chat studies the repository, proposes the layers and parts,
  and writes `docs/architecture/` (or `docs/arquitetura/`) only after your OK.
- New: the `architecture` skill teaches the convention to every chat, VS Code and the terminal included; the `board`
  skill cites the item code.
- New: in the chat, "Use on this whole PC" writes `permissions.defaultMode` (only `default`, `acceptEdits` or `auto`,
  never a bypass) into `~/.claude/settings.json` after a confirmation, keeps a backup and can undo.
- Conversations are hung on parts by the item code they cite, then by the files they edited against the parts' paths,
  then by the AI with the parts as candidates; branches by the files of their diff.
- Chats run inside a git worktree now belong to the main checkout's project, so a worktree no longer shows as a second
  project with the same map.
- Item codes may have a longer word after the dash (`pf-lacuna2`).
- Removed: the cells view (organs, tissues, cells and nuclei), the timeline bar, units and their consolidation, links
  and tidying, and the d3-force and d3-quadtree files they used.
- Repository: contributing guide, security policy, code of conduct, issue and pull request templates, Dependabot for
  the workflow actions, this repository's own architecture in `docs/architecture/`, and new screenshots.

## 0.1.3

Conversations started from the page stay, and the page chat runs in your own Claude Code permission mode.

- A conversation opened with Continue vanished once the sheet was closed: the sheet kept it only in memory and opened
  a blank new one every time, and the server never recorded which unit it came from, so the brain left it unsorted
  (or wherever the AI later guessed) and its title was the context block session-map adds to the first message. Now
  the server keeps each page conversation in `page-chats.json` (unit, branch, folder, the person's own first words,
  the permission mode picked, the tools allowed for the whole conversation) and places it in the unit it was opened
  on:
  - the unit's chat sheet lists the conversations opened there, the one used last first; tapping one shows its
    history (from Claude's transcript, or from the running process) and continues it with `--resume`, also after
    the server restarts or the process stopped when idle;
  - reloading the page reopens the conversation that was open (kept in `localStorage`; closing the sheet forgets
    it);
  - the server repeats every message it takes, so a sheet reopened on a running conversation shows the whole turn;
  - a conversation's title is what the person wrote, without the context block.
- The page chat used to force `--permission-mode default` and asked for every tool. It now runs in
  `permissions.defaultMode` from your Claude settings (`~/.claude/settings.json`, then the project's
  `.claude/settings.json`, then `.claude/settings.local.json`; the more specific file wins), `default` when none
  is set. A selector in the chat header changes it per conversation (Same as Claude, Ask every time, Edits on their
  own, Automatic); a running conversation switches from its next step, and the status line shows the mode Claude
  reports. `bypassPermissions` is never passed: a setting with it runs the chat in `auto` and says so in the
  sheet. Whatever the mode still asks about keeps Allow / Deny, and "Always in this conversation" now survives a
  resume.

## 0.1.2

Switching projects no longer leaves a conversation of the previous project open over the new one.

- A chat sheet opened with Continue stayed open after picking another project in the top selector: the brain showed
  the new project while the sheet still named a unit of the old one, and its first message would start the
  conversation in the old project's folder. Picking another project now closes the sheet (the conversation keeps
  running on the PC, as when the sheet is closed by hand); showing the same project again, after a poll or a language
  switch, keeps it open.

## 0.1.1

Related units now show up on real projects, not only in the demo.

- Links between units came out empty once the AI placed chats: edits made in a worktree beside the repo were dropped,
  AI-made units have no paths, a chat's parent was only looked for in its own unit, specs one folder down were never
  read, and links by meaning were never computed. Now:
  - a chat links its unit to the units whose files it edited, in any checkout of the repo (at most the three it edited
    most); OpenSpec folders `specs/<unit>/` count for that unit, and a broad path beside specific ones does not;
  - a branch links the unit it lives in to the units it touches and to its chats' units;
  - a chat that continued work begun in another unit links the two;
  - specs nested under a unit's folder are read, and a unit must be named at least twice to count;
  - units sharing a rare tag, and pairs the AI names as related during consolidation (with a short reason, cached in
    `related.json`), are linked by meaning; a project mapped before this gets one consolidation pass;
  - no link between a unit and the tissue or organ holding it.
- The brain draws the three strongest links per unit and leaves out links to dormant units until one of the two is
  selected; selecting a tissue or organ highlights the links of the cells inside it and lights the units at the other
  end.
- Windows: a short 8.3 folder name and its long name are one folder (project ids, work cells, chat placement); text
  files stay LF in every checkout; PowerShell gets longer to start and a killed chat's folders are removed with
  retries, so the Windows CI runs pass.

## 0.1.0

First release.

- Living brain view: organs, tissues, cells, nuclei and chats, with branches as work in progress.
- Board, map, costs (API-price estimate), archived history with search, and a Discover tab for skills and plugins.
- Chat from the page over your own `claude` CLI, with Remote Control links.
- Skills `/session-map:map`, `/session-map:board` and `/session-map:history`; a `SessionEnd` hook archives conversations.
- Local-only by default; token required for writes and for any access from the network.
