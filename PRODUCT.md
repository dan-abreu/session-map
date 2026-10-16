# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The owner first:** a person who builds software with Claude Code without being a programmer. He keeps session-map open beside his Claude conversations, on the PC and on the phone (same network), many times a day, to see what is happening and decide what comes next. Brazilian Portuguese is his language.
- **Other people next (confirmed 2026-10-11):** session-map is released for anyone using Claude Code, coders or not. Someone opening it for the first time must understand it without a manual: the screen explains itself.

## Product Purpose

session-map shows, on one page, everything Claude is doing on a project: the project drawn as a map of parts with what is missing in each, every Claude conversation hung on the part it works on, what is working now and what waits for the person. From any point of the map the person starts or continues a conversation, or leaves the project's orchestrator to drive the work on its own. Success: the person looks once and knows what is going on and what needs them ("bateu o olho, entendeu"), and gets work moving without hunting for controls.

## Positioning

The live map of the project with each AI conversation attached to the part it is changing. Conversation lists, IDE panels and dashboards show chats or files; none shows the project's own architecture with the work happening on it, read from plain markdown in the repository and from Claude Code's own files on the PC.

## Operating Context

- Runs locally: a Node server started by the Claude Code plugin (`/session-map:map`), opened in the browser through a link that carries the person's key; also reachable from the phone on the same network, and a look-only link for other people.
- Reads Claude Code conversation files, git and the project's architecture folder (`docs/architecture/`); writes only session-map's own folder and, with consent, the architecture files.
- Lives next to Claude Code (terminal, VS Code, desktop app): the person switches between them all day.

## Capabilities and Constraints

- Map of the project (layers, parts, groups, items, progress, files), conversation list, Now strip, page chat with Claude (the brain's Conversa: weighed per message, routed by the Cérebro), the orchestrator per project, the Cérebro tab, alerts, Home, Foundation reports, the Flow drawing, outside AIs (the arsenal).
- No runtime dependencies and nothing to install beyond Node; no build step for the page.
- English and Brazilian Portuguese; plain words by default, technical words behind a switch.
- Works in light and dark themes.

## Brand Commitments

- Name: session-map (lowercase). Voice: plain, short, friendly words; never jargon by default; every sign says what, why and what to do.
- Colors carry meaning and always the same one: waiting for you (amber, always first), working (green), blocked or clash (red), in progress (blue).

## Evidence on Hand

- Real screenshots of the current map and chat: `.dev/redesign/before/` (2026-10-11), and README images from the demo project (`docs/images/`, synthetic data labeled as such).
- No testimonials, customers or usage numbers exist; never invent them.

## Product Principles

1. One look is enough: one main thing per screen, the same fact counted once and the same way everywhere.
2. The map is the product: everything else serves it and gets out of its way.
3. The screen teaches itself: words and order make the next step obvious to a first-time person; help explains, it never compensates for clutter.
4. Work moves without the person, and the person always sees it: autonomy is visible, stoppable and honest about cost.
5. Calm by default: color and motion only where something means something.

## Accessibility & Inclusion

- WCAG AA contrast in both themes, full keyboard use, visible focus, screen-reader labels; respects reduced motion.
- Usable at 390 px wide with nothing cut or overlapping.
