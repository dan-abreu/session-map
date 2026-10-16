# Flow

The picture of how the parts talk to each other: a mermaid diagram kept in the architecture README, drawn on the Flow tab, with every box tied to a part and colored by what is happening there. It is the second view of the same model as the mind map, so the two never drift apart.

## How it works

The Flow tab draws the first mermaid block of the README (layers are `subgraph`s, arrows are who talks to whom). A box that matches a part opens that part's panel and chat and takes its status color. With no diagram in the README it shows an automatic draft built from the layers, parts and relations, with "Improve with the AI" and "Save to project". The drawing exports as SVG, PNG, Markdown or mermaid, and can be imported as mermaid with a preview of what changes, and a draft studio on the side lets a chat and manual tools edit a draft that touches nothing until "Apply".

## Where in the code

- `server/arch/flow.mjs`
- `server/web/flow.js`
- `server/web/flowview.js`
- `server/web/flowexport.js`
- `server/web/vendor/`
- `server/arch/flowmodel.mjs`
- `server/arch/flowscan.mjs`
- `server/arch/flowcatalog.mjs`
- `server/web/flowlevel.js`
- `server/web/flowgrid.js`
- `server/arch/flowinner.mjs`
- `server/arch/flowjourneys.mjs`

## Rules that must not break

- The only thing ever written to a project is the mermaid block of the architecture README, and new part files from the convention's skeleton; never a deleted part.
- Everything written stays inside the architecture folder, needs the token and is recorded in the action log.
- A project with its own documentation rules is only shown, and written only on an explicit order.
- A map read from the main branch is shown on screen and never written.
- Nothing is executed from an imported file: it is read as data.

## What's missing

### Drawing and studio

- [x] **Claude:** Flow tab drawing the README diagram, boxes tied to parts and colored by status `fl01`
- [x] **Claude:** Mermaid export and import with a preview, never deleting a part `fl02`
- [x] **Claude:** Draft studio with a chat, manual tools and undo, applied only on "Apply" `fl03`
- [x] Move the drawing with the hand, like the map: grab cursor, drag to pan, wheel to zoom around the pointer, clicks on boxes untouched `fl15`
  - Same feel as the mind map (`.mm` uses `cursor: grab` and dragging). On every Flow view: general, Parts, inside a part, Journeys, and the workshop when no tool is picked. From `id85`.

### Fluid Flow

- [x] **Claude:** Read the Flow without a key on this PC `fl04`
  - A read request from `127.0.0.1` must not ask for the key; the key is for writes and for access from outside. Today the mermaid route answers 401 locally and the tab stays blank. Fix every read route and show the "open with the key" message only on write buttons.
- [x] **Claude:** Automatic draft when the README has no diagram `fl05`
  - A project with an architecture but no diagram shows at once a draft built from layers, parts and relations, with no AI, marked "automatic draft".
  - Buttons: "Improve with the AI" (opens the studio already asking for the real flow) and "Save to project" (preview and confirmation).
- [x] **Claude:** Export the drawing as SVG, PNG and Markdown `fl06`
  - SVG and PNG from the drawing on screen; Markdown with the mermaid block. The `.mmd` export stays.

### Detailed Flow

- [ ] **later:** A single model behind every view `fl07`
  - Parked on 2026-10-16 (the finish plan): the remaining half (the AI enrichment and the owner's "confirmed") has no owner call yet. The one model itself is done (`fd25`): the Flow's model is what the Foundation's round builds, what `GET /api/foundation/<id>/model` serves and what "Tudo em dia?" reads.
  - One JSON model (nodes, labeled arrows, journeys, a hash of the files of each node); the views are generated from it and mermaid is only the drawing layer (the Structurizr, Ilograph and C4 pattern).
  - Separate "declared" (README and architecture) from "detected" (chats, branches, code), with an "AI" or "confirmed" badge.
  - The AI generates it, caches it in the session-map storage and regenerates only the nodes whose hash changed, per folder, with a cheap model.
  - Done without the AI: `GET /api/arch/<project>/model` builds it from the README, the part files and the code, in the background, cached in the session-map storage (only changed files are read again); every fact has "declared" and "detected" evidence (file and line). Still to do: the AI enrichment and the owner's "confirmed".
- [x] **Level 1, the general view, with actors and outside services** `fl08`
  - Actors (customer, professional, owner or panel) and outside services (messaging, AI provider, hosting, database, storage, error tracking, e-mail), and a label on each arrow saying what passes.
  - Starts here, with a fixed legend and filters by journey.
  - Done on the server: actors (browser, phone on the network, terminal, Claude Code, and the people of each app's screens) and outside services found in the code, an arrow per part and service with words from the README or the catalog, and the drawing of the general view, which can never be imported back as parts. The page has the level switch, the legend, the facts list and zoom; the view opens at a size that reads (whole when that still reads, else as wide as the area and scrolled down), and "Fit to screen" shows it whole. An arrow the README left without words takes them from what its two parts are (a small table of roles in the catalog: readers hand on "data read", a state builder "the current state", a server "what the screen shows" to a page; a part that hands on to several others says what each one gets, such as the state builder giving the Flow "what is happening in each part"), else "code it shares" when the code shows the link; with nothing known it is drawn without words and counted, never with a placeholder. Arrows to one service with the same words are drawn once, from the part with the most evidence, naming the others. The drawing is laid out in bands, top to bottom (`server/web/flowgrid.js`): who uses it, then one band per layer, then this computer and the internet side by side; labels sit in the gaps between bands, so they never overlap. Words from the AI stay with `fl07`.
- [x] **Level 2, inside a part** `fl09`
  - A double click opens the part's inner flow: components taken from "How it works", "Where in the code" and who it talks to, plus the code itself, with live colors per component.
  - Done without the AI: `GET /api/arch/<project>/model/part/<part>` (read without a key on this PC; the colours need the key) builds the inside of a part from the model build kept in memory, writing nothing. Its pieces are the paths "Where in the code" names (a big folder keeps its folders, its entry and its most linked files, and groups the rest as "+N files in …"), each with the first sentence of the file's opening comment; arrows between pieces come from the imports, and every arrow of the general view reaches the piece whose file shows it (a README-only one starts at the entry piece). Rows top to bottom: what comes in, where it starts, what other parts call, the work, the pieces it leans on, where it hands things on. A piece is green when a conversation working now changed it, blue when it changed in the last ten minutes, with a ring when it has changes not saved yet. The page opens it with a double click, Shift+Enter or the "See … inside" button (the way in on a phone), and goes back by the breadcrumb or Escape. A piece four or more others of the part use is not reached by a bundle of "uses" arrows: its box says how many use it, and the facts list keeps every arrow. A band that wraps stays one band, titled once. A file comment in another language than the page moves to the hover title, and the box says instead how the piece is tied to the others. The view opens whole when that still reads, and the floating legend never hides its last band. Still to do: words from the AI for each piece and the owner's "confirmed".
- [x] **Level 3, Journeys tab** `fl10`
  - Three to six numbered end-to-end flows (for example from a request to its acceptance), each step tied to a part, with live colors (the Structurizr dynamic view).
  - Done without the AI: the model carries its journeys (`server/arch/flowjourneys.mjs`, started from a small catalog in `flowcatalog.mjs`): from a person or a program that sends something in, along the arrows with words (at most one step against an arrow, six steps in all), to the end the catalog names; the same model always gives the same journeys, each marked "detected". On this project: you open the map, a Claude Code conversation shows up, you ask in the page chat and the AI answers, an alert reaches your phone, you type a command in the terminal, an alert shows on the screen. The page has a "Journeys" level next to "Overview | Parts": the list, the numbered steps in plain words (each tied to a part, one click opens it) and the path drawn alone, top to bottom; in the general view the journey filter now works, opens framed on the path near life size, and dims everything outside it while keeping it readable. A step against an arrow says who is asked and what comes back ("asks “Page chat”, which answers with: …"). A name the README wrote keeps its words, in quotes, inside a sentence; the common layer names ("What it reads", "What you touch") are said in the page language. Still to do: the AI that rewrites the steps in better words, and the owner's "confirmed".

### Stays in step

- [x] **The functions census** `fl16`
  - A mechanical walk over the program's own modules, no AI: for every function, the part that owns it (from the part files' "Where in the code"), what it is for (the first sentence of its opening comment) and who is responsible — a script (plain code), a bot (loops, timers, watchers, robots) or the AI (calls the model or drives the claude process). Cached per file version; orphans (functions no part claims) are reported, never hidden.
  - Built on 2026-10-14: `server/arch/flowowner.mjs` (the pure classifier, server > ai > bot > script, with the reasons for the hover, tested in `test/flowowner.test.mjs`) and the census inside `buildFlowModel` (`server/arch/flowmodel.mjs`, `model.files`, model version 2, cached with the model). The first census found 309 modules and 17 orphans, and the parts claimed them all (`server/budget.mjs`, `ledger.mjs`, `savings.mjs`, `waste.mjs`, `statement-route.mjs` → State builder; `lookstate.mjs`, `newproject.mjs`, `restart.mjs` → Server; `cards.mjs` → Mind map page; `background.mjs` → Orchestration; `server/bench/` → Bootstrap and inspection). Today: 312 code functions, zero orphans; the census watches the next one.
  - Refined the same day: the classifier learned the false friends — the server entry wins over the AI (main.mjs is the bot), pure ai/ helpers and pure runner imports are not "the AI", the page modules are always scripts, a parser's `for (;;)` is not a loop, schedulers count by their import (never by a name in a regex literal), and the robots by definition (restart, clerk, livemark) are named. Today's robots: watcher, background, restart, clerk, livemark and main.mjs — nothing else.
  - From `id120`.
- [x] **The Functions level** `fl17`
  - The Flow gains a level that lists every function of the program, grouped by part, with its purpose, where it comes from (path) and its owner badge (script · bot · AI), filterable by owner and searchable; the pieces of a part's inner view (`fl09`) carry the same badge. The owner is a mechanical fact (fl16), never an AI's opinion.
  - Built on 2026-10-14: the Functions button on the level bar (`server/web/index.html`), the list with the owner chips, the search and the "No box" filter (`renderFunctions` in `server/web/flowview.js`), the owner chip on the inner-view pieces (`decorate`, `fl-owner` classes), the owner legend, and the pt/en words (`flow.fn.*`, `flow.owner.*` in `server/web/i18n.js`). The inner view carries `owner` and `ownerCounts` per piece (inner model version 2, `server/arch/flowinner.mjs`).
  - Refined the same day: the list groups by layer then by part (the layer of each function comes from the model), shows only functions by default (an "Everything" chip adds docs and tests), and each row says what the function is for (first sentence of its opening comment) and how it works (the next sentences, or the part file's own words about it), both masked like the rest of the page.
  - From `id120`.
- [ ] **later:** Diagram that updates itself `fl11`
  - Parked on 2026-10-16 (the finish plan): it writes into the project on its own, so it waits for the care mode the owner has not chosen for every project (the one model is done, `fd25`).
  - Mode `flow.sync`: `auto` (default), `suggest` or `off`. New part → a box in its layer's `subgraph`; new link (weight 2 or more, repeated evidence) → a dotted "related" arrow; a part that vanished → a box marked "gone?", never erased on its own.
  - Batches at most once an hour, written only inside the mermaid block, each one an activity event ("Flow updated: +1 part, +2 links") with Undo (the previous block is kept in the session-map storage). Once a day the AI swaps "related" for the real reason.
  - `suggest` shows a banner "the Flow may be out of date" and an "Update with the AI" button that opens the studio with the changes.
  - Tests: an idempotent batch, never deletes, undo, respects `off` and `suggest`, never writes outside the block.
- [ ] **later:** Golden rule: architecture and Flow move together, nothing is born in only one `fl12`
  - Parked on 2026-10-16 (the finish plan): the single model it needs is there now (`fd25`); what is left is the writing in both directions, which waits for the care mode the owner has not chosen for every project.
  - The single model (`fl07`) is the source and the two are synced both ways: a new part or feature in the map gives a box and arrows in the Flow; a new box in the Flow gives a part with the skeleton in the architecture.
  - A small task is only an item in the architecture and shows in the Flow as a signal, with no box.
  - Invariant tests: no part without a box, no box without a part (except actors and outside services). Also see `pt04` and `wa10`.

### Any format

- [x] **Export in more formats** `fl13`
  - Deterministic, from the diagram model: draw.io (mxGraph XML) and PlantUML (component and deployment), beside the mermaid, SVG, PNG and Markdown ones.
- [ ] **later:** **Import from any format, with the AI filling in** `fl14`
  - Parked on 2026-10-16 (triage): nice to have: importing drawings from other tools is not the base.
  - draw.io, PlantUML, Graphviz, Excalidraw, or an image or PDF of a drawing: the AI (the user's own `claude`, a model that sees images) converts it to mermaid and matches each box to a part; the result goes through the same import preview.
  - With `flow.sync: auto` it applies with an event and Undo; with `suggest` it shows the preview. New parts get the convention's skeleton.
  - Limits: 5 MB per file, an allowed list of types, nothing executed from the file (draw.io and Excalidraw read as data).
  - Later, by the owner's choice on 2026-10-10 (`op06`).
