# Changelog

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
