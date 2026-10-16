# Finish the program: nothing built and switched off, nothing open without a reason, a release that can be proven

What it is, for an engineer who never saw this codebase: session-map is a week old and grew fast across many chats. The comb of 2026-10-16 (`research_notes/Pente fino/pente-fino-2026-10-16.md`) found little dead code and one large class of defect: **code that is built and tested but that nothing runs** (the Foundation's refresh round ran only the reading step; "Tudo em dia?" had no caller). This plan turns "finished" into things that can be measured, and orders the work to reach them.

## Definition of done (each line is a command or a screen, not an opinion)

1. **Everything built is switched on.** Every module of `server/` is reached by the server, the command line, a hook or the page — or is a script on purpose, or is parked with a reason. Proof: the reachability script of the comb lists no unwired module outside the parked ones (`fd25` decides the last block).
2. **The checklist of the program speaks for itself.** "Tudo em dia?" on this repository has no warning left unexplained: each warning is fixed or accepted in the map with a reason; unverified lines say why (`not-applicable`, `no-token`), never `no-data` because a step never ran. Proof: `uptodate.json` of this project.
3. **Nothing open without a reason.** Open tasks are only the ones in this plan; every other item is done, dropped or parked (`later`); requests with every item ticked are closed (`requestsOf().unconfirmed` is 0). Proof: the Requests tab.
4. **The suite is green on a clean export of the commit** (not only in the working tree), and `node scripts/release-gate.mjs --publish` passes.
5. **The live program is verified**: the server starts, `/api/state` loads, each tab of the page opens, and the log of a run of ten minutes holds no warning that is not known and explained.
6. **A release exists**: version, CHANGELOG and README say the truth, the tag is pushed (the owner's OK for the tag and the push).

## Tasks

### Task 1: the Foundation round runs every block (`fd24`)
Files: `server/foundation/blocks.mjs`, `refresh.mjs`, `summary.mjs`. Test: `node --test test/foundation-blocks.test.mjs`.
Status: done 2026-10-16 — verified on the running server: `project.foundation` carries `uptodate`, `health` and `version`.

### Task 2: the OpenAI price page answers again, and a failing page is not asked at every look
Files: `server/ai/providers.mjs`, `server/ai/prices-watch.mjs`. Test: `node --test test/ai-prices-watch.test.mjs test/ai-providers.test.mjs`.
Status: done 2026-10-16.

### Task 3: one model (`fd25`)
The Foundation's model block (routes empty, `views.mjs`, `enrich.mjs`, `evidence-check.mjs`) and the Flow's model (`arch/flowmodel.mjs`) are two. Decide with the owner: the Flow reads the Foundation's `model.json`, or the block is dropped. Files: `server/foundation/http/model.mjs`, `server/arch/flowmodel.mjs`. Test: `node --test test/foundation-model.test.mjs test/arch-flowmodel-fixtures.test.mjs`.
Status: waits for the owner.

### Task 4: the Foundation's screens are mounted (`fd26`), Versions included
Files: `server/web/foundationareas.js`, `server/web/areas.js`, `server/web/app.js`. Test: `node --test test/foundation-areas.test.mjs test/web-versionsview.test.mjs test/web-home.test.mjs`, then `node scripts/smoke-browser.mjs --compare` on the running page.
Status: done 2026-10-16 — ten views on four areas; every area and sub-page draws with real data and no complaint in a real browser.

### Task 5: the Requests tab reviews (`mm27`)
Keep / Later / Discard for each request, and "can close" computed from the items. Files: `server/web/requestsview.js`, `server/web/requests.js`. Test: `node --test test/web-requests.test.mjs`.
Status: not started.

### Task 6: the whole program works (`or67`)
The rows that are declared and not wired, and the restart of the server. Files: `server/ai/brainpanel.mjs`, `server/ai/functions.json`. Test: `node --test test/brainpanel.test.mjs`.
Status: not started.

### Task 7: prompt-cache economy (`sv17`) and the tidier (`pc36`)
Files: `server/chat/context.mjs`, `server/chat/tidy-words.mjs`. Test: `node --test test/chat-context.test.mjs`. Proof of the gain: the share of cache read in `node scripts/agent-usage.mjs`'s companion measure after a day of use.
Status: not started.

### Task 8: measure the Foundation on the owner's projects (`fd11`)
Files: `docs/architecture/foundation.md`, `scripts/measure-foundation.mjs`. Test: `node --test test/foundation-measure.test.mjs`, then a run on each of the owner's projects; the coverage numbers of each redone map next to the old map's go in `docs/architecture/foundation.md`.
Status: not started.

### Task 9: the repository health list (35 failing of 91)
Decide with the owner which items apply to a local plugin (CODEOWNERS, SUPPORT, `.editorconfig`, runtime pin, pinned actions, token permissions, an update bot, SAST, a glossary, ADRs), do those, and mark the rest not applicable in the profile. Files: `.editorconfig`, `.github/CODEOWNERS`, `SUPPORT.md`, `.github/workflows/`, `package.json`. Test: `node --test test/foundation-health-accept.test.mjs`, then the score in `health.json` of a new round.
Status: quick wins done 2026-10-16 (`fd27`, `fd28`): 33 → 37 of 91 pass; the rest are items that do not apply to a local plugin, waiting for the owner's scope (mark them not-applicable or build them).

### Task 10: the release
Version, CHANGELOG ("Unreleased" is written), README, the gate in `--publish` mode on a clean export, the tag and the push. Files: `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`, `README.md`, `README.pt-BR.md`. Test: `node --test test/release-gate.test.mjs`, then `node scripts/release-gate.mjs --publish` on a clean export. Status: after tasks 3 to 9; the tag and the push need the owner's OK.
