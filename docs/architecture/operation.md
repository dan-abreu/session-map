# Operation

The work on session-map that changes no code: the owner's decisions, releases, accounts, routines and documents. Each activity says which request it came from.

## Where in the code

Nothing here is code; the part is this file:

- `docs/architecture/operation.md`

## What's missing

### The owner's decisions

- [ ] **with the owner:** Look at the Requests tab and say whether any request is missing or wrong `op01`
  - From the request `id76`.
- [x] **with the owner:** Approve the whole foundation in one delivery (estimated US$ 360–570) `op02`
  - From the request `id59`.
- [ ] **with the owner:** On the phone, the box tabs with icons only or with their words `op03`
  - Asked of the owner on 2026-10-10 with the v0.2.4 screenshots; no answer yet.
- [ ] **with the owner:** The "Why session-map exists" section in the README `op04`
  - Proposed after the polish; waits for his OK.

- [ ] **with the owner:** Fable's "last word" on critical deliveries: at high effort (cheaper, today's choice) or at max `op08`
  - From `or04` on 2026-10-10: Fable costs 2.5× Opus; as the final check it runs at high. Say "máximo" to change it.
- [ ] **with the owner:** Rate the Portuguese texts of the bench without knowing which AI wrote each `op09`
- [ ] **with the owner:** Review the list of skills on: each one's whole description rides in the system prompt of every chat `op18`
  - From `id147`. The fixed context of a page chat is 39k–79k tokens; every on skill adds its full description (`id140`), and context rot degrades quality too. The owner turns off the ones he does not use, in Discover.
- [x] The blueprint of the program, with the zoom and the installations drawn per room `op10`
  - From request `id128`.
  - `.dev/execucao/census-blueprint.mjs` reads the parts, the files, the exports, the routes, the hooks and the MCP tools, joins the health from the last full suite run, and draws `.dev/prints/planta-baixa-session-map.html`: 14 clickable rooms, each with its complete inventory (files, functions, tests, installations) and the part's open architecture items inside the room, so the drawing itself shows what the architecture holds. Regenerate with `node .dev/execucao/census-blueprint.mjs`.
- [x] The map of the interface: every area, screen, section and button of the page `op11`
  - From request `id128`.
  - `.dev/execucao/census-ui.mjs` reads the page's own screens from the code — the 13 areas of `nav.js`, each area's view files, their headings, buttons, tabs and dialogs, with the labels resolved from the page's own texts — and draws `.dev/prints/mapa-da-interface.html`: a clickable tree of the whole interface (13 áreas, 1096 itens), what the person sees and touches, area by area, down to the last button. Regenerate with `node .dev/execucao/census-ui.mjs`.
- [x] The delivery motor: the ritual, the live proof and the bridge skills `op12`
  - From request `id131`.
  - The ritual (`ritual-de-entrega` in `~/.dsh/skills`) names the three motors in order: syntax, the test suites, the live proof, the map, the card, the honest report. The live proof is mechanical — `node .dev/execucao/prova-viva.mjs --token=<key>` asks the running server (routes with real data, served page with the newest fixes) and exits red when anything is stale. Until a motor covers everything, the bridge is the installed skills, used: architecture, board, grilling before medium+ work, and the superpowers plugin (installed from the official directory, on and off per project in the page — `op13`).
- [x] The on/off switch for downloaded skills: verified live, the redundancy removed `op13`
  - From request `id132`.
  - The button already existed (`rd09` + the project list of `mm52`): one click per plugin, a confirmation, saved into the user's settings, reaching the chats opened after it. The check on 2026-10-14 read the live state: 16 plugins listed per project with their switch, the superpowers installed by the official directory and on. The hand-made clone in `~/.claude/plugins/superpowers` was redundant and was removed — the official install is the one source.
- [x] The mapping of superpowers onto the program's engines `op14`
  - From request `id133`.
  - `.dev/execucao/superpowers-no-motor.md` marries each of the 15 disciplines to the engine that already holds it (guard, contract, release gate, the ritual, `id129`): 11 motor, 2 motor parcial, 2 reading — the two reading ones became `or44` in the Orchestration part.
- [x] Ponytail and superpowers installed and on, used as part of the engine `op15`
  - From request `id135`.
  - Installed on 2026-10-14 through the official channels: ponytail via `claude plugin marketplace add DietrichGebert/ponytail` + `claude plugin install ponytail@ponytail`; the superpowers already stood installed by the official directory. The live project list shows both with their switch on (`ponytail@ponytail · ligado`, `superpowers@anthropic-plugin-directory · ligado`). The engine parts hold their disciplines: the doors and the plans (`or44`), the debt ledger and the contract's `skipped` line (`or45`), the switch (`rd09`).
  - The file is C:Usersdanie.claudesession-mapenchuns6-10-10-21-43-44pt-blind.md; the automatic checks passed almost everyone, so his rating decides who writes for him (`or12`, `or19`).

### Releases

- [x] **Claude:** Publish the Requests tab as the next version, after the owner looks at the screenshots `op05`
  - From the request `id76`.

### Closing the open work

- [x] **with the owner:** Say which open activities go to "later" and approve the finishing waves `op06`
  - From the request `id88`.
  - Decided on 2026-10-10: the reinforced way is approved; later: `mm12`, `mm13`, `sv02`, `sv05`, `bi01`–`bi10` (but `bi06`), `or09`, `or10`, `fl14`, `mm17`–`mm19`, and the request `id28`.
- [x] **Claude:** Publish what is ready as v0.3.0, so the owner's brother can see the new version, while other work goes on `op07`
  - From the request `id94`.
  - Done on 2026-10-11: v0.3.0 tagged and pushed; the screens of the foundation still in progress (health, versions, care) ship unhooked, their texts on a pending list in the tests until each block merges them.

### Research and studies

- [x] Study the ideas of ECC and compare them with session-map's engines `op16`
  - From request `id145`.
  - Done on 2026-10-15: the notes in `research_notes/Ideias do ECC/ecc.md` (memory, instincts, context controls, hooks, skills, rules, AgentShield, tokens and philosophy) and the comparison in `research_notes/Ideias do ECC/comparacao-session-map.md`, which ends with four ideas worth borrowing (`or48`, `pt08`, `pt09`, `bi14` — proposed only, nothing written in the parts) and three small notes. Nothing was installed and no code changed; the map files and the code stay untouched until the owner picks the ideas.

- [x] Map every token spend of the program, inputs and outputs, item by item `op17`
  - From request `id147`.
  - The study started on 2026-10-15: the chat's fixed context, history and compaction (`server/chat/`), the engine's own AI calls (`server/ai/`), the outside AIs, the skills loaded, the book and the summaries — each spend separated by input and output, with its size, price, cache behavior and the lever that would cut it. The notes live in `research_notes/Gasto de tokens/`; nothing in the code changes without the owner picking the levers first.
  - Done on 2026-10-15: the study is complete in `research_notes/Gasto de tokens/gasto-de-tokens.md` — prices, the 16 AI functions, the policy, the fixed-context caps, the three reading reports (chat, engine, measurement), the ranked decision menu, and the per-provider research (sections 12–13). The owner approved the plan ("vamos fazer") and the levers became items (`or49`–`or54`, `pc36`, `op18`); the build starts with the accounting trio.
