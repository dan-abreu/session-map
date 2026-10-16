# Glossary

The words this project uses, in the order a newcomer meets them. Where the page has a plain word and a programmers' word for
the same thing, both are given (the page switches between them with **Show technical words**).

**Architecture map.** The folder `docs/architecture/` of a project: a README with the layers, one markdown file per part, and
a checklist of what is built and what is missing under each part. The convention the plugin teaches and keeps. See the
[ADR on the map as the source](adr/0002-the-architecture-map-is-the-source.md).

**Part.** One file of the map: what it owns, where it lives in the code, the rules that must not break, the tests that cover
it, and its open work under "What's missing".

**Item.** One line of a part, `- [ ]` open or `- [x]` done, with a short code (`fd24`, `mm62`: two letters for the part, two
digits for the order). Marked `**in progress:**` while someone works on it, or `**later:**` when it is parked on purpose.

**Later (parked).** The state of an item that is not wanted now and not given up: it stays in the file with its reason, and is
left out of the counts of what is open.

**Request (registry entry).** A wish of the owner in his own words and with its date, in `ideas.md`, numbered `id###`. Its
work becomes items of the right part. A request is **done** when every item it points to is done and something runs it
([ADR 0005](adr/0005-built-is-not-done.md)); one whose items are all ticked but whose entry is still open is *unconfirmed*.

**Foundation.** The exact facts about a program before any AI talks about it: every file counted letter by letter, the
routes, screens, tables and integrations found in the code, the versions in use, and the health of the repository. Kept as
JSON in `~/.claude/session-map/brain/<project>/foundation/`.

**Census.** The Foundation's count of the files of a project, with what was left out (dependencies, generated files, folders
named `vendored` in the project's config) and why.

**Vendored.** Other people's code kept whole in the repository (`server/disciplines`). Listed under `vendored` in
`.claude/session-map.json`, so the census counts it as a library and the health checks do not judge it as the project's own.

**Model.** What a project is made of, as the page draws it in the Flow: its parts, the people who use it, the outside services, and the arrows between them, each with the lines of the README and of the code it rests on. There is one ([ADR 0006](adr/0006-one-model-the-flows.md)); the refresh round keeps it fresh and "Tudo em dia?" reads it.

**Refresh round.** One pass of the Foundation: read the files, then the blocks (model, versions, guide, health, "Tudo em
dia?"). It runs when the owner asks and when the program notices the files moved.

**Block.** One step of the refresh round that writes one JSON file of the Foundation and one piece of the summary.

**Health.** The Foundation's list of what a repository should have (licence, security policy, CI, ignore rules, changelog…),
each item *ok*, *missing* or *does not apply*, with the one thing to do for the missing ones. The page tab is Saúde (*Health*).

**"Tudo em dia?" (Up to date?).** The check of what in the project is old: dependencies, runtime, actions, the model names it
calls, each marked current, behind or not verified.

**Care (cuidado).** The mode that says what the program does by itself with a finding: *automatic* (does it and tells),
*suggest* (proposes and waits for a click), *look* (only lists). The owner chooses; the program recommends.

**Specialist.** An agent that owns one part of the code and is written from the map ([ADR 0002](adr/0002-the-architecture-map-is-the-source.md)).
Called `sm-<part>` in Claude Code. Its **card** is what the map gives it: where the code is, the rules, the tests.

**Kind (tag).** The first word of an agent's description in brackets (`[code]`, `[debug]`, `[review]`…). It picks the model,
the level and the method the policy gives that kind of work.

**Cérebro.** The tab where the owner says which AI, model and level does each function (the entry brain, the talk, planning,
code, review, the risky work, the bulk work). The engine reads it at each call; no AI is written into the code.

**Policy.** `server/ai/policy.json`: the table that maps a kind of work to a model and a level, and fixes the main chat
([ADR 0004](adr/0004-the-chat-never-moves-on-its-own.md)).

**Guard.** The door in front of the agents (`server/chat/guard.mjs`). Open by default; *strict* is a choice
([ADR 0003](adr/0003-the-guard-is-open-by-default.md)).

**Conductor (brain).** The senior chat of a project that sees the whole map, hands focused work to activity chats and hears
back from them.

**Smoke test.** A short test that reads the *running* program the way the page does and names what a change took away.
`scripts/smoke.mjs` reads the server; `scripts/smoke-browser.mjs` opens the page in a real browser.

**Release gate.** The checks that run before a version is published (the full suite on a clean copy, the agent files in sync
with the map, the ticked items). It runs on a `v*` tag.
