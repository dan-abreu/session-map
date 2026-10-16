# Foundation

Exact facts about a program before any AI talks about it: every file counted letter by letter, every route, screen, table and integration found by code that does not guess, each fact tied to its file and line, and everything else checked against those facts so nothing stays outdated. Decided on 2026-10-09 ("a prioridade é entender os programas"): it comes right after the polish package and before the orchestration chat (`or01`), and new features freeze until it is done.

## How it works

Being built and tested (`server/foundation/`, 52 modules, `test/foundation-*.test.mjs`). The plan: deterministic readers (a census of all files, parsers for each stack, an optional import graph) produce facts with a file, a line and a content hash. Those facts fill one model of the program, from which the mind map and the Flow are drawn. The AI receives the facts of a slice, names, groups and explains them, and a checker rejects any claim it cannot trace back to a file and line. After a change only the changed files are read again, and anything that depended on them is marked out of date. The same facts feed the "Tudo em dia?" checklist, the repository health score and the version line of each project.

## Where in the code

Being built (`fd01` to `fd16`): the blocks so far, the knowledge they read, their test repositories, this file and the professional standard it follows:

- `docs/architecture/foundation.md`
- `docs/standard/`
- `server/foundation/`
- `knowledge/`
- `test/fixtures/repos/`
- `test/fixtures/repo-copy.mjs`

## Rules that must not break

- A fact comes from a tool that reads the files, never from the AI's memory.
- No claim is shown without a file and line that a checker has opened and confirmed; what cannot be confirmed is shown as "not found", never guessed.
- Zero npm stays the default: optional tools (scc, dependency-cruiser) are used only when present, and vendored code is pinned with its license and audited before adoption.
- Without the access a check needs (a token, a network), the line says "not verified", never "failed".
- Automatic fixes never invent contact details, e-mails or legal text.

## What's missing

### Testes quebrados no working tree (14/10/2026)

- [x] **Claude:** `test/foundation-health-accept.test.mjs` falha (6 asserções, "each known gap of acme-shop appears once") — o trabalho não commitado da Foundation mudou a lista de lacunas; acertar o teste ou o código `fd18`
- [x] **Claude:** `test/foundation-health-secrets.test.mjs` falha (1 asserção sobre git real) — conferir se é o teste ou o detector de segredos `fd19`
- [x] **Claude:** `test/foundation-http-health.test.mjs` falha (2 asserções, "POST online fetches") `fd20`
- [x] **Claude:** `test/foundation-optional.test.mjs` falha (1 asserção, "toolOf: depcruise never resolves to a .cmd shim") `fd21`
- [x] **Claude:** `test/foundation-versions.test.mjs` falha (1 asserção, "package.json 1.2.0 with tag v1.1.0 shows both") `fd22`

### Facts from the code

- [x] **important:** Program census, letter by letter, with a 100% read ledger `fd01`
  - A count without AI for every file: characters, words, lines (code, comment, blank), type, size and date; sums per folder, per part and for the whole program; a "Census" tab.
  - The AI's reading is recorded in a read ledger with the same counts: "read X of X characters (100%)", or the files and spans still missing and a new round until closed. Afterwards only files whose hash changed are read again.
  - Every file and line has an owner part; files without one are listed in red. A folder, screen, route or table with no documentation gets documentation written in the project's convention, marked "written from the code".
  - The census follows every change, with the difference shown like a bank statement (what came in, what went out). Files left out on purpose (third-party dependencies, generated files, binaries) are counted and listed apart. Own counter with no dependency; scc used when installed.
  - How to confirm it is done: on a fixture repository the census totals match an independent count file by file; each folder's sum equals its files and the total equals the folders; after a study the ledger reads 100%, and a span skipped on purpose shows up as missing; editing one file changes only that file's row and the statement lists the difference.
- [x] **important:** Deterministic extractors for each kind of project `fd02`
  - Exact inventories without AI: Next.js pages and routes, Fastify routes, Prisma schema (tables and relations), BullMQ queues and jobs, outside integrations by SDK and URL, environment variables by name only; more stacks as projects need them.
  - Generated sections per part (Routes, Screens, Tables, Integrations, Jobs, Configs) kept up to date by themselves; a check that fails when code has no owner part; coverage measured (% of files with an owner, routes, screens and tables documented).
  - Tools: web-tree-sitter (MIT, WASM) vendored with the grammars in use for functions and exports; dependency-cruiser through npx in JS/TS projects for the real file-to-file links; own readers for the rest. Each tool passes a supply-chain audit before it is adopted.
  - How to confirm it is done: on a fixture app with known routes, pages, tables and variables, each extractor lists exactly those, with file and line, and nothing else; adding a route without an owner part makes the check fail; the coverage numbers match a hand count.
- [x] **important:** Architecture core: from facts to one model, then to every view `fd03`
  - Research of 2026-10-09: no open project builds a verified C4 model from code. Copy the method of Graphify and Understand-Anything (a parser for facts, the AI only enriching, every node and arrow marked `EXTRACTED`, `INFERRED` or `AMBIGUOUS` with its file and line), the levels and incremental fingerprint idea of CodeBoarding, and the C4 vocabulary of LikeC4 and Structurizr as a format, not a dependency.
  - Pipeline: facts with evidence and hash → one JSON model (L1 context, L2 containers, L3 components, relations, journeys as ordered relations) → AI enrichment validated against the model → the mind map, the Flow levels and the journeys drawn from it (mermaid only as the renderer) → re-extraction by hash, marking an AI item out of date when its evidence changed.
  - This is the single model of `fl07`; LikeC4 export stays optional.
  - How to confirm it is done: every node and arrow in the model has an origin and at least one evidence that resolves to an existing file and line; an AI item citing an unknown id is rejected by a test; editing a file marks only the items whose evidence is in that file as out of date.
- [x] **important:** Every file finds its owner part on its own, and the map and the Flow follow each change `fd16`
  - First step, done on 2026-10-10: a test file with no owner takes the part of the file it tests, by name (`test/arch-parse.test.mjs` → `server/arch/parse.mjs`), or else of the folder its name points to.
  - Next: a new file takes the part of its folder or of the files it imports; what stays without an owner is listed in red (`fd01`); the 5-minute round rewrites "Where in the code" and the Flow from the code (`fd12`), with a record and Undo under the project's care mode (`fd14`).
  - How to confirm it is done: on session-map the map shows the share of files with an owner next to the old number; adding a file to a part's folder, or a test for a part's file, puts it in that part with no edit to the markdown; after a round, "Where in the code" and the Flow match the code.
- [x] **important:** The skeleton of a file as a tool: its imports, exports and signatures with their lines, no bodies; an agent reads the skeleton, then only the lines it needs `fd17`
  - Built on 2026-10-13: functions nested in another named function are function facts too (`server/foundation/extract/functions.mjs`, id `fn:path#outer>inner`, `attrs.parent`; not map nodes, not call targets); `server/foundation/skeleton.mjs` (imports, exports, class and function signatures with lines, env variables, no bodies; JS/TS/Dart/PHP, refuses a path outside the root and secrets files); the `skeleton` tool in `server/ai/arsenal-mcp.mjs`, reading only under `SM_ROOT`, which `server/chat/hub.mjs` sets to the chat's folder. Measured with the nested functions read: `server/chat/hub.mjs` 63,818 B to 7,146 B (88.8% less), `server/chat/run.mjs` 16,404 B to 1,898 B (88.4% less), `server/web/chat.js` 64,417 B to 5,116 B (92.1% less, no longer a false 99%).
  - Measured on 2026-10-13 with the functions reader: `server/chat/hub.mjs` 63.6 KB to 3.5 KB (94% less), `run.mjs` 89%, `ask.mjs` 88%. `server/web/chat.js` gave a false 99%: functions nested inside another are not read yet, so they come first, or the skeleton misleads.
  - Exact and free, no AI: the census and the extractors already know functions, classes, imports, exports, calls, routes and tables. Also the environment variables the code reads (`process.env`, `os.getenv`), not only the names in `.env.example`.
  - From `id108`.

### Trust

- [x] **important:** Anti-hallucination rules for every reading `fd04`
  - 1, facts only from deterministic tools: the AI gets the list, it does not discover it. 2, closed vocabulary: the AI may only cite ids from the inventory; an unknown id is rejected. 3, every claim carries a file and line that an automatic checker opens and compares; a claim without proof, or whose proof does not match, is removed.
  - 4, reading per file or chunk with the text present, never from memory. 5, important points read by two independent readers plus an adversarial checker; a disagreement becomes "not confirmed". 6, visible badges: confirmed by the code, AI interpretation, not found (the AI is told to say "not found" rather than guess).
  - 7, measured: test repositories with an answer key give the accuracy and the invention rate of each version, which gate the release; the owner's corrections become new examples.
  - How to confirm it is done: a planted false claim in a test run is removed by the checker; every claim on screen shows one of the three badges; the release check fails when the invention rate on the answer-key repositories goes above the agreed limit.

### Everything up to date

- [x] **important:** Release gate for session-map itself: nothing outdated ships `fd05`
  - From the next release on: README screenshots regenerated from `--demo` at every version; before publishing, the same version in `package.json`, `plugin.json`, the CHANGELOG and the README; the CHANGELOG section present; the README cites only features that exist (a feature ↔ code map); links resolve; done items ticked in `docs/architecture/`.
  - The publish is refused when any check fails.
  - How to confirm it is done: changing the version in one file only makes the gate fail; a README sentence about a feature that does not exist makes it fail; a release made through the gate has screenshots dated that day.
- [x] **important:** Documentation watcher for any project `fd06`
  - Flags documentation that cites something that no longer exists, new code with no documentation (the AI writes it in the convention), architecture, Flow, README and CHANGELOG that disagree with each other, versions and numbers that do not match, and images older than the screen they show.
  - Each finding says what it is, why and what to do, with "Update with the AI"; in automatic mode it updates on its own, with a record and Undo.
  - How to confirm it is done: renaming a route in a test project flags every document that still names the old one; a screenshot older than the last change of its screen is flagged; Undo restores an automatic update.
- [x] **important:** The official "Tudo em dia?" checklist, eight groups `fd07`
  - Each line shows confirmed, warning or not verified, so the panel proves what was checked:
  - 1, code ↔ map ↔ Flow: census at 100% with owners, the golden rule, screens, routes, tables, jobs and integrations ↔ architecture both ways, drawn links ↔ real imports. 2, documents (README, CHANGELOG, CONTRIBUTING, SECURITY, docs, ADRs) ↔ code, links, screenshots older than the screen, API docs ↔ routes, database docs ↔ schema and migrations.
  - 3, numbers and versions consistent, done items ticked. 4, configs and secrets used ↔ documented (names only). 5, quality: tests passing, parts without tests, inspection findings, missing translations. 6, dependencies: old versions, known vulnerabilities, licenses.
  - 7, git: unsaved or unpushed changes, idle or already merged branches, clashes, issues and board cards ↔ items. 8, conversations: decisions not yet written in the architecture or docs, requests that did not become an item.
  - Left out for now (optional later): the live server's version endpoint and outside accounts.
  - How to confirm it is done: the panel shows all eight groups for a project with every line in one of the three states; breaking one thing per group in a test project turns exactly that line to warning; a request left in a conversation without an item shows in group 8.

### A professional repository

- [x] **important:** Repository health from a 91-item checklist `fd08`
  - The checklist researched on 2026-10-09 (GitHub community standards, OpenSSF Scorecard and Best Practices badge, SLSA, AGENTS.md) has 91 items in 8 categories, each with how to detect it, who it applies to and a severity (essential, recommended, advanced):
  - community files (13: README, LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, SUPPORT, issue and PR templates, CODEOWNERS, …); security and supply chain (18: no secrets in files or history, secret scanning, branch protection, safe workflows, minimal token permissions, pinned actions, update bot, known vulnerabilities, SAST, signed releases, SBOM, …); versions and releases (7: one semantic version, tags, CHANGELOG, release notes, conventional commits, …); documentation (10: docs folder, setup, architecture, ADRs, runbooks, API, database, glossary, roadmap, valid links).
  - engineering hygiene (18: CI on every PR, tests, lint, formatter, type check, build, coverage, hooks, `.editorconfig`, `.gitignore`, `.gitattributes`, `.env.example`, lockfile, pinned runtime, …); product, users and operation (9: privacy policy, terms, accessibility, i18n, observability, incident response, backup, status page, support); project management (7: labels, milestones, board, triage, response time, maintainers, stale policy); extras of 2025–2026 (9: AGENTS.md, CLAUDE.md, AI-use policy, llms.txt, description and topics, social image, badges, OpenSSF badge, SPDX headers).
  - Rules: without a token a check reads "not verified", never "failed"; nothing that does not apply is charged (a library needs no privacy policy); content is checked, not only that a file exists; files are looked for in the root, `.github/` and `docs/`; monorepos per package; the Scorecard list is read from its source; an automatic fix is a draft with clear placeholders, never invented contacts or legal text.
  - A score from 0 to 100; each gap with what it is, why and what to do, plus "Resolve with the AI" (middle path or automatic mode).
  - How to confirm it is done: on a test repository with known gaps, each gap appears once with its category and severity, a private repository is not charged for public-only items, a check that needs the API reads "not verified" without a token, and the score changes when one gap is fixed.
- [x] **important:** Versions always in sight `fd09`
  - On top of each project: the version of its code (`package.json`, `VERSION` or the latest tag) and, when an endpoint is configured, the version running live, with a mark when they differ.
  - The main pieces (Node and frameworks) with a warning when old or vulnerable; session-map's own version with a notice of a newer one; a suggestion of the next version number from the kind of change.
  - How to confirm it is done: a project with `package.json` at 1.2.0 and a tag v1.1.0 shows both and the mismatch; a framework with a known advisory shows the warning; after a `feat` commit the suggested next version is a minor bump.
- [x] **important:** A Projects home page `fd10`
  - The first page lists every project with its version, health score, "Tudo em dia?" summary, what is working now, what waits for the owner, the month's cost and the last activity; it anticipates, showing problems and offering to solve them before the owner notices.
  - How to confirm it is done: with three projects, the home page shows one row each with all seven values, and a click opens that project's map.

### After the foundation

- [ ] **in progress:** Redo the maps of the owner's projects with the foundation, measure, then test with outside people `fd11`
  - Redo the architecture of session-map and of the owner's projects with the census and the extractors and measure the coverage; only then start the orchestration chat (`or01`); then a test with two or three people from outside. Includes the redo offered in `bi06`.
  - How to confirm it is done: each redone map shows its coverage numbers (files with an owner, routes, screens and tables documented) next to the old map's, and the notes of the outside test are written down.
- [x] **blocks:** The code is the source of truth; the architecture markdown is an output `fd12`
  - The model is built from the code files (census, extractors, import graph); boxes are made of code files; the markdown is generated and checked against the code with file:line evidence, and the watcher flags any mismatch. First step of the foundation.

### Care and size of documents

- [x] **important:** Document-size watcher with a safe split by topic and exact code pointers `fd13`
  - A watcher measures lines and KB of the documents of a project and warns past a threshold (warning / strong): agent instructions 150 / 200 lines; always-loaded memory or index 150 lines / 200 lines or 25 KB; SKILL.md 400 / 500; an architecture part 300 / 500, with a summary required above 100; README 200 / 400; plans 300 / 500; registries 400 / 800; a changelog is archived by year or major version. Thresholds are configurable; generated code blocks are ignored.
  - The split is by topic, never by line count: cuts only at second-level headings, never inside a code block or a table; each piece becomes a file named after its heading; the original becomes an index; every internal link and anchor in the repository is rewritten, and if one would break nothing is written. Files that only grow at the end (a changelog, a log) are archived, never split.
  - In Suggest mode the split is shown as a proposal with a diff; in Automatic mode it is applied and logged in Changes with Undo.
  - Code is pointed to by path and symbol (`file#name`), with the line worked out when the document is opened, never a fixed line number; a pointer whose path or symbol no longer exists is flagged.
  - How to confirm it is done: a test document of 320 lines with several second-level headings is flagged; the proposal shows the pieces and the index with no link broken; applying it keeps every non-empty line (the sets of lines before and after are equal) and Undo restores the original; a pointer to a renamed symbol is flagged.
- [x] **important:** One care mode per project for everything that writes `fd14`
  - A single choice per project replaces the scattered switches: Automatic (does everything and logs it in Changes with Undo; recommended for people who are not technical), Suggest (tips with what, why and before/after, and Accept / Not now / Never; nothing is written to the repository without an OK) and Look only. It is asked once at first use in plain words and can be changed per project.
  - It governs every feature that writes: documents, architecture, Flow sync and fixes. Sensitive actions (delete, publish, money, accounts) always ask for confirmation, in every mode. The rule applies to everything session-map creates or maintains in any project, and to session-map itself.
  - How to confirm it is done: in a test project, Suggest leaves the repository byte-identical until a tip is accepted; Automatic applies the same tip, shows it in Changes and Undo restores the files; Look only writes nothing; a delete asks for confirmation in all three modes; the mode is asked once and survives a restart.

- [x] **Claude:** The watcher's version and count fixes are a motor edit, checked by the same judge `fd23`
  - From `id153`. A `version-mismatch` finding already names the found and expected versions and the line; the motor swaps the number on that line. A `docs-disagree` count ("12 routes" against 10 in the code) swaps the number where the rule read it. Both go through the program's own judge (no extra changes, no new secret, no new finding, no broken link) and fall back to the AI when the judge refuses. `server/foundation/docfix.mjs`; the estimate is US$ 0 for the motor path.
  - Built on 2026-10-15: `motorFix` in `server/foundation/docfix.mjs` (version swap on the finding's own line, count swap through `swapCount` exported from `server/foundation/docwatch-agree.mjs`); the AI route stays as the safety net when the judge refuses; `estimateFix` is US$ 0 for the two rules; tests in `test/foundation-docfix.test.mjs` (34 verdes).

### The professional standard

- [x] **important:** Professional standard: every idea goes through `docs/standard` `fd15`
  - The specification in `docs/standard/` (Brazilian Portuguese, 14 stages plus an index) says what happens to every idea of a non-technical founder, from "I want this" to live, selling and maintained: idea and product, design and architecture, code, tests, security and LGPD, versions and release, operation and costs, documentation, brand and design, marketing and content (with video), sales, support and retention, legal and company, finance, and work with AI.
  - Each stage lists the steps a professional takes, who does them (role, model and reasoning level, skills and tools), the deliverables, the checks with how each is detected, what the founder decides (with a recommendation), the amateur mistakes it prevents and its sources, marked verified, vendor, convention or not verified.
  - In session-map: every idea is classified (trivial, small, medium, large, plus sensitive), filtered by the project profile, and walked through the stages that apply; every check ends in passed, failed, not verified (with the reason) or not applicable; nothing is "done" without its evidence; the checks are the steps of the N0–N4 ladder and feed "Tudo em dia?" (`fd07`) and the repository health (`fd08`); the care mode (`fd14`) governs what is written, and sensitive actions always ask.
  - Legal, LGPD and tax stages always carry "not legal or accounting advice"; laws, prices and platform limits are checked at the source on the day they are used.
  - How to confirm it is done: a test idea marked "medium + sensitive" shows the applicable stages and hides the ones the profile excludes, each with the reason; every check of those stages shows one of the four states with its evidence or reason; a check left "not verified" keeps the level provisional instead of failing it; the idea cannot be marked done while an essential check is failed; every file in `docs/standard/` stays at or under 300 lines.
