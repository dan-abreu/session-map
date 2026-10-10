---
name: session-map
description: A living map of your project, with every Claude Code conversation hung on its parts, understood at a glance.
colors:
  bg: "#edf1ef"
  surface: "#f8faf9"
  surface-sunk: "#e2e8e5"
  line: "#cbd5d1"
  ink: "#142320"
  ink-soft: "#4a5c57"
  working: "#2f7a5f"
  waiting: "#b8730d"
  doing: "#2f74c0"
  clash: "#c2410c"
  relation: "#7b68d6"
  focus: "#1f6fb0"
  kind-tasks: "#2f7a5f"
  kind-chats: "#2f74c0"
  kind-branches: "#7b5fd0"
  kind-changes: "#1f8a96"
  kind-files: "#6b7a75"
  dark-bg: "#0b1113"
  dark-surface: "#121a1d"
  dark-ink: "#e2eae6"
  dark-ink-soft: "#9db0a9"
  dark-surface-sunk: "#1a2427"
  dark-line: "#26332f"
typography:
  label-small:
    fontFamily: "ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 650
  label:
    fontSize: "0.75rem"
    fontWeight: 600
  body-small:
    fontSize: "0.8125rem"
    lineHeight: 1.5
  body:
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  title:
    fontSize: "0.9375rem"
    fontWeight: 650
  headline:
    fontSize: "1.0625rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  display:
    fontSize: "1.25rem"
    fontWeight: 650
    letterSpacing: "-0.015em"
  code:
    fontFamily: "ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
rounded:
  2xs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 14px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "36px"
  icon-button:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    size: "36px"
  help-dot:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    size: "20px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
---

# Design System: session-map

The tokens live in `server/web/style.css` (`:root` and its dark twin) and `test/web-design.test.mjs` holds the page to them. This file says how to use them, so every new screen looks like the old ones.

## Overview

**The quiet workbench.** session-map is opened next to Claude Code, many times a day, by people who may never have coded. It must be understood at a glance ("bateu o olho, entendeu"): one main thing per screen, plain words, icon plus text, colors that always mean the same thing, and nothing that moves without a reason. The look is calm and paper-like in light mode and deep green-black in dark mode; color is spent only on meaning (working, waiting, blocked, the five kinds of information).

Rules that hold everywhere:

- Every area has a title and a "?" with one sentence (`data-help="<area>"`, words in `help.<area>`).
- Every sign says what it is, why it is happening and what to do, with the button that does it (`signals.js`).
- Every list has an empty state with a drawing, a title and a sentence that says what to do (`empty.js`).
- Default words are plain; "Show technical words" in the help menu swaps in the originals (`TECH` in `i18n.js`).

## Colors

Semantic tokens only; a raw hex, `rgb()` or shadow outside `:root` fails the test. Every text color passes WCAG AA on the surface it sits on, in light and dark (checked by the test).

| Token | Meaning |
|---|---|
| `--bg`, `--bg-2`, `--bg-3`, `--canvas` | page, raised surface, sunk surface, map canvas |
| `--ink`, `--ink-2` | main text, secondary text (never lighter than `--ink-2` for text) |
| `--line` | borders and dividers |
| `--active` / `-ink` / `-fill` | a conversation is working; finished well |
| `--waiting` / `-ink` / `-fill` | waiting for you (always amber, always first) |
| `--doing` / `-ink` / `-fill` | in progress |
| `--clash` / `-ink` / `-fill` | blocked, clash between lines of work, errors |
| `--rel` | relations between parts |
| `--focus` | keyboard focus ring (3:1 on every surface) |
| `--k-tasks`, `--k-chats`, `--k-branches`, `--k-changes`, `--k-files` (+ `-ink`, `-fill`) | the five kinds of information, the same in map, panels, lists, Now strip and alerts |
| `--lv0`…`--lv4` | the map's levels: project, layer, part, group, item |
| `--syn-com`, `--syn-str`, `--syn-kw`, `--syn-num`, `--syn-tag`, `--syn-attr`, `--syn-key` | code colors in the file viewer and in a change's before and after (AA on `--bg-2`) |
| `--scrim`, `--shadow-*`, `--on-clash`, `--on-waiting`, `--on-strong-*` | overlays, depth and text on strong fills |

Project colors and people's initials come from a hue (`oklch(var(--owner-l) var(--owner-c) <hue>)`), so they stay readable in both themes.

## Typography

One system font stack (`--font`) and a mono stack (`--mono`) only for code, file paths and item codes. Seven steps, nothing in between:

| Token | Size | Use |
|---|---|---|
| `--fs-2xs` | 11px | badges, counters, fine print |
| `--fs-xs` | 12px | meta lines, chips, hints |
| `--fs-sm` | 13px | lists, secondary text |
| `--fs-md` | 14px | body (the page default) |
| `--fs-lg` | 15px | small titles, leads |
| `--fs-xl` | 17px | panel and dialog titles |
| `--fs-2xl` | 20px | view titles |

Titles use weight 650–700 and `text-wrap: balance`; paragraphs stay under about 60 characters wide; numbers that line up use `.num` (tabular figures).

## Layout

- Spacing sits on a 2 px grid; prefer the `--sp-*` steps (4, 8, 12, 16, 20, 24, 32). 1 px only as a hairline nudge.
- Tight inside a group, generous between groups; more space above a heading than below it.
- The page is a grid: top bar, the global Now strip, the conversation list on the left, the stage (map or view) on the right. Panels and chats are sheets on the right on desktop and bottom sheets on phones.
- Phones start below 720 px: one column, the map becomes an indented list, sheets slide up from the bottom, the chat input stays above the keyboard (`interactive-widget=resizes-content`). Nothing may be cut or overlap at 390 px.

## Elevation & Depth

Flat surfaces separated by borders; shadows only for what floats above the page.

| Token | Use |
|---|---|
| `--shadow-xs` | boxes on the map, cards at rest |
| `--shadow-sm` | hover on cards and captions |
| `--shadow-md` | hover on map boxes, lit boxes |
| `--shadow-lg` | menus, popovers, dialogs, sheets on phones, the tour card |
| `--scrim` | behind dialogs, bottom sheets and the tour |

## Shapes

Corners come from `--r-*`: 4 for small chips, 6 for inner controls, 8 for buttons and inputs, 12 for cards and blocks, 16 for sheets, dialogs and the tour card, pill for counters and status chips, 50% for dots. Icons are the SVG sprite in `index.html` (24 px box, 1.6–2 px stroke, round caps); no emoji stand in for icons.

## Components

Each component has every state: default, hover, focus-visible (2 px `--focus` ring), active (1 px press), disabled (45% opacity, no hover), and where it applies loading, empty and error.

- **Button** (`.btn`, `.btn.primary`, `.btn.danger`): the verb says what happens ("Install", "Resolve with the AI"); one primary per group.
- **Icon button** (`.icon-btn`, `.bar-icon`): always with `aria-label` and `title`.
- **Segmented control** (`.seg`): two to six choices, the chosen one filled with `--ink`.
- **Help dot** (`.help-dot`): the "?" after an area title; one sentence in a popover (`#helpTip`).
- **Help menu** (`#helpMenu`): the welcome tour again, "Show technical words", the glossary.
- **Tour** (`tour.js`): five steps, a ring around the place and a card; Esc skips, arrows move, focus stays on the card.
- **Sign card** (`.sig`): what · why · what to do, then the buttons; tone colors from the sign's kind.
- **Kind block** (`.kind`): title with the kind's icon and color, a "comes from" line, then content.
- **Empty state** (`.empty-state`, `.is-compact` in columns and lists): drawing, title, one sentence, optional button.
- **Skeleton** (`.skeleton`, `.sk-bar`, `.sk-box`): only while the first data loads; removed as soon as it arrives.
- **Toast** (`#toast`): a short confirmation at the bottom, gone after about 3 seconds.
- **Change row** (`.chg-btn`): kind chip (Created green, Edited blue, Removed red, Renamed violet), file name in mono with its folder, lines `+N −M`, then where · who · time, and the state chip (Not saved yet amber, Saved green, Released blue). A click opens the before and after in the file dialog (`.is-change`, as tall as its content).
- **Fresh chip** (`.bx-chip.is-fresh`): "+N files · +M lines now" on a box for 10 minutes after a change, in the changes color with a live dot; the box's border lights too.
- **File tree** (`.ftree`): native `<details>` folders, folders first, single-folder chains on one line, a count per folder.
- **Conversation list** (`.cv-folder`, `.cv-group`, `.cv-row`): each project is a card whose sticky title carries its colour band (a tint and a 3 px top line of the project hue), name and counters; inside, titled sections (Working now green, Waiting for you amber, then the dated ones) with an icon in a tinted square, a count pill and a title that sticks under the card's title. A row: title with time on the right, the state chip (dot + word) and the origin badge with cost on the right, then the place on the map on its own line. "Finished, not seen yet" tints the row blue until it is opened. The row never repeats the project of its card.
- **Team of helpers** (`.wf`, `workflows.js`): what was asked (a sunk box with the item it names), then the team indented on a hairline: colour swatch, name, state chip, n/total and a bar in the team colour, the phase now and the phase chips, then each helper with its state in a word, model chip, place and last step; the panel adds its files and saved changes with "Saved" or "Released in vX". Team colours come from eight hues far from amber and red (`--wf-h`), and teams on the page never share one.
- **Helpers on a box** (`.bx-agents`): one pulsing dot per helper at work in its team's colour, followed by "N helpers"; the tooltip names the helper, the team and its last step.
- **Sheet** (`.sheet`): panels, chats, lists; a close button, Esc closes, resizable on desktop.
- **Chat composer**: one line when empty, grows to 40% of the panel, then scrolls; under it, attach, the compact button of how the chat runs (`.run-toggle`, "Automatic · Opus · high") and Send. The button opens a menu above the box (`.chat-menu`) with the way, the model, the effort, the permissions and "use this mode in every Claude on this PC"; Esc or a click outside closes it.
- **Chat header** (`.chat-head`): one thin line, as in Claude: where the conversation is (hidden on a phone), its title cut with an ellipsis, New chat as an icon, ⋯ (`.chat-more-menu`, a `role="menu"` with arrow keys) and close.
- **Reply text** (`.md`): headings stay close to the text (1.15em, 1.08em, 1em, weight 650, 4 px above), so a reply reads as a reply, not a page.

## Do's and Don'ts

Do:

- Write for someone who never coded: "line of work" (branch), "saved change" (commit), "join" (merge), "send to the online copy" (push), "helpers" and "team of helpers" (agents, workflow), "the map's main page" (README), "drawing as text" (Mermaid), "what it would cost if paid per use" (token cost), "version history" (git), "connector" (MCP server), "automatic step" (hook). The technical word goes in `TECH`, never in the default text; `test/web-plain.test.mjs` fails on jargon.
- Say what happened and what to do in every error and notice; never show a raw code (a parser message may sit behind "Technical details").
- Keep motion short (`--dur-fast` 140 ms, `--dur-base` 180 ms, `--dur-slow` 240 ms) and purposeful: opening, moving focus, live status. Reduced motion turns it all off with one rule.
- Put the same icon and color on the same kind of thing everywhere.

Don't:

- Add a font size, radius, shadow or color that is not a token.
- Add a screen without a "?" for its area, an empty state, a phone layout and both languages.
- Use color alone to carry meaning: a dot always has a word next to it.
- Animate layout, or start any motion that the person did not cause, except live status.
