# Changelog

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
