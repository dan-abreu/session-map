# Bootstrap and inspection

Gives a repository with no map a complete architecture and Flow, then keeps an eye on it with the strictest reviewer there is. The first reads every file; the second looks for everything that is wrong, down to the comma.

## How it works

On first use of a repository without a map, session-map explains what it will do, asks permission and shows time and cost. Helpers study the repository area by area and write the architecture and Flow into a draft kept in session-map's own storage, not in the repository; a big "Save to project" button then writes them. The same reading feeds an inspection that turns each problem into an item on the right part.

## Where in the code

- `server/chat/`
- `server/brain/`
- `server/arch/`
- `server/bench/`

## Rules that must not break

- Nothing is written to the project until the owner presses "Save to project" (unless the "save automatically" switch is on).
- Every file is read in full; the report states "100% read" or lists what is missing.
- The inspector never says "clean" without listing what it checked.

## What's missing

### Testes quebrados no working tree (14/10/2026)

- [x] **Claude:** `test/bench-run.test.mjs` falha (6 asserções, "every contestant does every item in a fixed order") — o bench mudou no trabalho não commitado; acertar o teste `bi11`
- [x] **Claude:** `test/bench-sandbox.test.mjs` falha (12 asserções, "a correct module passes every test") `bi12`
- [x] **Claude:** `test/bench-sets-code-run.test.mjs` falha (1 asserção, "every reference passes its own tests in the sandbox") `bi13`

### First use of a repository with no map

- [ ] **Offer a map and Flow, with permission, time and cost** `bi01`
  - Explain, ask, and show the estimate (time and cost) before starting. Ask again only if it passes about US$ 5 (config `bootstrap.maxUSD`); the default is the "complete" study with its estimate visible.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **Study the whole repository by area and write architecture and Flow** `bi02`
  - A helper per large folder plus a reviewer, reading code, configs, README and docs. Then: the architecture in the standard (layers → parts, fixed sections, the project's language); the Flow at three levels (see `fl08`, `fl09`, `fl10`) with labeled arrows; a check against real files (no part or box without an existing path); a final summary of findings, risks, what is missing and questions for the owner, which land in "Waiting for you".
  - Only what needs a human is "with the owner".
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **Middle path: a draft first, then "Save to project"** `bi03`
  - It builds on its own, without asking, in the session-map storage. A big "Save to project" button writes the architecture and the Flow; a switch saves automatically; "Redo" and "Erase the map" are there too.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **Exhaustive study with a coverage report** `bi04`
  - An inventory of all files (`git ls-files`), each assigned to a part, coverage in % and the list of orphans; a checklist per part (screens and features, routes and services, data and entities, outside integrations, automatic jobs, configs and secrets by name only, tests and test gaps, half-done things).
  - A completeness critic runs in rounds until one round finds nothing; the project's issues and board cards are imported as items.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **Reading rule: 100% of the files, with a ledger** `bi05`
  - Every file read in full (big ones in chunks, all of them), recorded per file (hash and "read in full") in a read ledger in the session-map storage. The report shows "100% read" or what is missing and runs more rounds until closed; afterwards only what changed (by hash) is read again.
  - Left out on purpose and listed in the report: third-party dependencies, generated files (build, dist, lockfiles) and binaries (images, video, fonts). Estimate first; Sonnet helpers, Opus review.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **with the owner:** Redo the first, shallow map of an earlier project with this method `bi06`
  - Offered after v0.2.3; waiting for the owner's answer.

### Perfectionist inspection

- [ ] **Inspect every file for everything that is wrong** `bi07`
  - Text: spelling, commas, accents, mixed languages, poor messages. Code: unused, repeated, confusing names, forgotten TODOs, half-done. Defects: unhandled cases, swallowed errors. Security: exposed secrets, wide permissions, personal data. Missing tests. Contradicting documentation, broken links. UI: cut-off text, no label, contrast, phone.
  - Each finding becomes an item on the right part with `file:line`, a weight (grave, important, detail) and "what it is · why it matters · how to fix".
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **"Fix with the AI" and a second check for grave findings** `bi08`
  - A button to fix with the AI, in batch for details (grouped). Grave and security findings pass a second, adversarial check before they are shown.
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **The picky inspector** `bi09`
  - Relentless line by line (comma, extra space, inconsistent name, 1 px misalignment, a sentence that could be clearer); repeats rounds until one whole round finds nothing; grave first, details grouped with "fix all".
  - Later, by the owner's choice on 2026-10-10 (`op06`).
- [ ] **session-map inspects itself before each release** `bi10`
  - Later, by the owner's choice on 2026-10-10 (`op06`).
