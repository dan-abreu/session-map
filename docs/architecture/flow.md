# Flow

The picture of how the parts talk to each other: a mermaid diagram kept in the architecture README, drawn on the Flow tab, with every box tied to a part and colored by what is happening there. It is the second view of the same model as the mind map, so the two never drift apart.

## How it works

The Flow tab draws the first mermaid block of the README (layers are `subgraph`s, arrows are who talks to whom). A box that matches a part opens that part's panel and chat and takes its status color. The diagram can be exported and imported as mermaid with a preview of what changes, and a draft studio on the side lets a chat and manual tools edit a draft that touches nothing until "Apply".

## Where in the code

- `server/arch/flow.mjs`
- `server/web/flow.js`
- `server/web/flowview.js`
- `server/web/vendor/`

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

### Fluid Flow

- [ ] **important:** Read the Flow without a key on this PC `fl04`
  - A read request from `127.0.0.1` must not ask for the key; the key is for writes and for access from outside. Today the mermaid route answers 401 locally and the tab stays blank. Fix every read route and show the "open with the key" message only on write buttons.
- [ ] **important:** Automatic draft when the README has no diagram `fl05`
  - A project with an architecture but no diagram shows at once a draft built from layers, parts and relations, with no AI, marked "automatic draft".
  - Buttons: "Improve with the AI" (opens the studio already asking for the real flow) and "Save to project" (preview and confirmation).
- [ ] **important:** Export the drawing as SVG, PNG and Markdown `fl06`
  - SVG and PNG from the drawing on screen; Markdown with the mermaid block. The `.mmd` export stays.

### Detailed Flow

- [ ] **A single model behind every view** `fl07`
  - One JSON model (nodes, labeled arrows, journeys, a hash of the files of each node); the views are generated from it and mermaid is only the drawing layer (the Structurizr, Ilograph and C4 pattern).
  - Separate "declared" (README and architecture) from "detected" (chats, branches, code), with an "AI" or "confirmed" badge.
  - The AI generates it, caches it in the session-map storage and regenerates only the nodes whose hash changed, per folder, with a cheap model.
- [ ] **Level 1, the general view, with actors and outside services** `fl08`
  - Actors (customer, professional, owner or panel) and outside services (messaging, AI provider, hosting, database, storage, error tracking, e-mail), and a label on each arrow saying what passes.
  - Starts here, with a fixed legend and filters by journey.
- [ ] **Level 2, inside a part** `fl09`
  - A double click opens the part's inner flow: components taken from "How it works", "Where in the code" and who it talks to, plus the code itself, with live colors per component.
- [ ] **Level 3, Journeys tab** `fl10`
  - Three to six numbered end-to-end flows (for example from a request to its acceptance), each step tied to a part, with live colors (the Structurizr dynamic view).

### Stays in step

- [ ] **Diagram that updates itself** `fl11`
  - Mode `flow.sync`: `auto` (default), `suggest` or `off`. New part → a box in its layer's `subgraph`; new link (weight 2 or more, repeated evidence) → a dotted "related" arrow; a part that vanished → a box marked "gone?", never erased on its own.
  - Batches at most once an hour, written only inside the mermaid block, each one an activity event ("Flow updated: +1 part, +2 links") with Undo (the previous block is kept in the session-map storage). Once a day the AI swaps "related" for the real reason.
  - `suggest` shows a banner "the Flow may be out of date" and an "Update with the AI" button that opens the studio with the changes.
  - Tests: an idempotent batch, never deletes, undo, respects `off` and `suggest`, never writes outside the block.
- [ ] **Golden rule: architecture and Flow move together, nothing is born in only one** `fl12`
  - The single model (`fl07`) is the source and the two are synced both ways: a new part or feature in the map gives a box and arrows in the Flow; a new box in the Flow gives a part with the skeleton in the architecture.
  - A small task is only an item in the architecture and shows in the Flow as a signal, with no box.
  - Invariant tests: no part without a box, no box without a part (except actors and outside services). Also see `pt04` and `wa10`.

### Any format

- [ ] **Export in more formats** `fl13`
  - Deterministic, from the diagram model: draw.io (mxGraph XML) and PlantUML (component and deployment), beside the mermaid, SVG, PNG and Markdown ones.
- [ ] **Import from any format, with the AI filling in** `fl14`
  - draw.io, PlantUML, Graphviz, Excalidraw, or an image or PDF of a drawing: the AI (the user's own `claude`, a model that sees images) converts it to mermaid and matches each box to a part; the result goes through the same import preview.
  - With `flow.sync: auto` it applies with an event and Undo; with `suggest` it shows the preview. New parts get the convention's skeleton.
  - Limits: 5 MB per file, an allowed list of types, nothing executed from the file (draw.io and Excalidraw read as data).
