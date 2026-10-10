---
name: architecture
description: Use when a project keeps an architecture map in docs/arquitetura, docs/architecture or docs/arch, when the user asks for something new, starts or finishes a piece of work, brings a new idea to place, or wants an architecture map for a project that has none.
---

# Architecture map

The session map draws each project as a tree: layers, parts, groups and items, read live from plain markdown files. Keeping those files true is what keeps the map true.

## Where it lives

The folder set in session-map's config `architecture`, else the first that exists: `docs/arquitetura`, `docs/architecture`, `docs/arch`. If it exists only on the main branch and not in this folder, do not edit it here: say in your reply what should change.

- `README.md`: the layers, as a mermaid block (`subgraph id["Layer name"]` holding nodes `ID[Part name]`) or as `##` headings listing the parts, each linked: `[Part name](part-file.md)`.
- One file per part, like this:

```markdown
# Login

Lets people sign in with e-mail and password and keeps them signed in.

## Where in the code

- `apps/web/src/login/`
- `packages/core/src/session.ts`

## What's missing

### Sign in

- [ ] **in progress · Ana and Claude · step 2 of the roadmap:** Show the error message under the field `qx07`
  - Same words as the sign-up page.
- [ ] **with Ana · blocks:** Pick the text of the password reset e-mail `qx08`
- [x] **Claude:** Lock the account after 5 tries `qx06`
```

In Portuguese the sections are `## Onde está no código` and `## O que falta`; tokens `em andamento`, `com o <nome>`, `<nome> e Claude`, `etapa N`, `bloqueia`, `importante`, `detalhe`. English: `in progress`, `with <name>`, `<name> and Claude`, `step N`, `blocks`, `important`, `detail`. Tokens go in one bold prefix ending in `:`, separated by ` · `.

## The three moves

| When | Do |
|---|---|
| The user asks for something new | Add `- [ ] what to do` under "What's missing" / "O que falta" of the right part, in a fitting `###` group, before you start. End it with the next code: the prefix the part's items use, plus the highest number in the folder plus one. |
| You start it | Put `in progress` (`em andamento`) first in its bold prefix, or add `**in progress:**`. |
| It is done | Tick it: `- [x]`. |

Change only that line; leave the rest of the file byte for byte. If the section has a line like "4 open items: ...", update its numbers. Cite the item code in your replies and in the board card: that is how the map hangs the conversation on the part.

## The person's requests

Write every request of the person down the same day, in their own words, never only in your memory. The page's Requests tab reads them.

- **Where:** the registry part of the architecture folder (`ideas.md` or `pedidos.md`, whose items carry an "Asked:" / "Pedido:" line). A project with no registry keeps it in session-map's folder, `~/.claude/session-map/projects/<project id>/pedidos.md` (the id is in the page's link), so nothing is written into the repository without an OK.
- **One item per request**, code `rq` plus the next number (never a prefix the map's items use), ticked when done or discarded:

```markdown
- [ ] Show the orders on the phone `rq12`
  - Pedido: 2026-10-10 05:10 — "the person's exact words"; 2026-10-11 09:00 — "the next time they asked"
  - O que significa: one or two plain sentences.
  - Como conferir: how the person sees it is done.
  - Onde foi: `ord07`, `op03`.
  - Situação: em andamento.
```

English labels: Asked, What it means, How to confirm it is done, Where it went, Status. The status starts with new, accepted, in progress, done, later or discarded (novo, aceito, em andamento, feito, depois, descartado), the detail in brackets: `feito (publicado na v1.4.0)`, `descartado (the reason)`. A request is never deleted.

- **Every request becomes at least one item.** Work that changes the program goes under the right part, and into the Flow when it adds a part or a link. Work that changes no code (research, accounts, releases, documents, a decision only the person can make) goes in the operation part, `operation.md` / `operacao.md` (next to `pedidos.md` when the registry lives in session-map's folder), with `From request \`rq12\`.` / `Do pedido \`rq12\`.` as its first detail line.
- **Keep it moving together:** when an item starts or ends, update the request's status in the same edit.

## Who an item is with

By default an item has no owner, which means Claude does it: leave the owner out. Put `with <name>` (`com o <nome>`) only when the item needs the person: a decision only they can make, an account or access only they can create, a payment, or a physical action. Writing code, tests, docs and configuration is Claude's work even when the person is the one who knows the area: the owner of an item is not who owns the area or who will write the code. The map counts every item with a person as "waiting for you", so a wrong owner buries the real decisions.

## A new idea

Read the README and the likely parts, say which part (or a new part, with its layer) and group it belongs to, show the exact line you would add, and write it only after the user's OK.

## No map yet

Offer to create one, and ask first. With the OK: study the repository, propose the layers and parts in the chat (name, what it is, main folders), wait for a second OK, then write `docs/architecture/` (`docs/arquitetura/` when the project's docs are in Portuguese): the README with the mermaid block and the links, and one file per part (named in lowercase with dashes, never `README.md` in any case) with the opening paragraph, "How it works", "Where in the code", "Rules that must not break" and "What's missing" ("Como funciona", "Onde está no código", "Regras que não podem quebrar", "O que falta"). Nothing is written before the OK.

## Talking to the person

When you tell the person about the map, use their language and plain words: "part" and "item", "line of work" for a branch, "saved" and "joined" for commit and merge, "team of helpers" for workflows and agents, "drawing" for the diagram. Say what you changed and what is waiting for them in one or two short sentences; the item code goes at the end, in backticks, for the map.
