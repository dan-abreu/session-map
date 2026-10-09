# Changelog

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
