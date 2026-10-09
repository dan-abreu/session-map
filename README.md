# session-map

[![test](https://github.com/dan-abreu/session-map/actions/workflows/test.yml/badge.svg)](https://github.com/dan-abreu/session-map/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/release/dan-abreu/session-map)](https://github.com/dan-abreu/session-map/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Português](README.pt-BR.md)

A Claude Code plugin that draws your project's **architecture as a mind map** and hangs every Claude conversation, branch and commit on the part it belongs to. Layers open into parts, parts into groups and items; each item is a line of plain markdown in your repository. You see what is done, what is in progress, what waits for you, what it costs, and you start a chat on any box, or drop in a new idea and let the AI put it in the right place.

![The mind map](docs/images/mind-map-desktop.png)

| Board | On a phone |
|---|---|
| ![The board](docs/images/board-desktop.png) | ![The map on a phone](docs/images/mind-map-phone.png) |

The screenshots come from `--demo`, which uses invented data.

## Install

```text
/plugin marketplace add dan-abreu/session-map
/plugin install session-map@session-map
```

**Requirements:** Claude Code and Node.js 20 or newer on your `PATH`. The native Claude Code installer does not bring Node; without it the server, the hook that archives finished chats and the commands do not run.

## Getting started

1. Run `/session-map:map` and open the link it prints.
2. Pick a project. If it already has an architecture folder, the map shows it at once. If not, a banner offers to create one: a chat studies the repository, proposes the parts, and writes nothing until you say OK.
3. Click a box to see its conversations, branches and files, and to chat about exactly that point. **New idea** opens a chat on the whole project: it proposes the part and the group, shows the line it would write, and writes it only after your OK.

## Architecture map

The map reads plain markdown, so it works with or without Claude, and your teammates can read it on GitHub. Where it looks: the folder set in the config `architecture`, else the first that exists of `docs/arquitetura`, `docs/architecture`, `docs/arch` (the working tree first, then the main branch).

- `README.md` of the folder: the layers, as a mermaid `subgraph` block or as `##` headings listing the parts.
- One file per part: a title, an opening paragraph, "Where in the code" (paths in backticks, which hang chats and branches on the part), and **What's missing**, the checklist:

```markdown
### Sign in

- [ ] **in progress · Ana and Claude · step 2 of the roadmap:** Show the error under the field `lg07`
- [ ] **with Ana · blocks:** Pick the text of the reset e-mail `lg08`
- [x] **Claude:** Lock the account after 5 tries `lg06`
```

English and Portuguese section names both work. The `architecture` skill teaches this to every chat, VS Code included, so a new request becomes an item, starting marks it in progress, and finishing ticks it. See [docs/architecture](docs/architecture/README.md) for this repository mapped the same way.

## Commands

| Command | What it does |
|---|---|
| `/session-map:map` | Starts the local server if it is not running and prints the links (this PC and your local network). `--local` skips the network link, `--port N` changes the port (default 4001). |
| `/session-map:board` | The current chat writes a short card about itself (area, branch, doing now, what is left, what waits for you) that the map reads. |
| `/session-map:history` | Searches the archived conversation history and answers with short matches. |
| `/session-map:architecture` | Teaches any chat the architecture map convention: where it lives, how to add an item, mark it in progress and close it, and how to create a map (asking first) for a project that has none. |

Without the plugin: `node server/main.mjs [--lan] [--port 4001]`, or `--demo` for sample data.

**Terminal only?** `node server/cli.mjs` (or `session-map` once the package is linked) prints the map as text: layers and parts with ● working / ○ quiet / ! waiting / ✓ all done, then the "Waiting for you" list and costs. It asks the running server and, if there is none, reads your history directly with the AI off. `--project <name>` narrows it, `--watch` redraws every 5 seconds, `--json` prints the state.

## Files

Open a part, an item or a branch and its **Files** section lists the files, new and changed ones marked. Tapping one opens it read-only (up to 1 MB, text only, never `.git`, never `.env` files) with the lines the branch changed highlighted. **Open in VS Code** opens that file on this PC, **Open terminal in this folder** opens a shell there, and **VS Code on your phone** appears when you set `tunnelUrl`. Reading files needs the token, like the chat.

## On your phone

`/session-map:map` prints a link with `?k=<token>`. Open it once and the browser keeps the token in a cookie. The token is in `~/.claude/session-map/token`; every write and every access from outside `127.0.0.1` needs it, so treat the network link like a password. The page listens on all interfaces only with `--lan`. Away from home, put both devices on [Tailscale](https://tailscale.com) and use the `100.x` link it prints. Do not expose the port to the internet.

## Chat from the page

For chats that run on this PC, turn on **Enable Remote Control for all sessions** in `/config`: the page then offers a button that continues that conversation from claude.ai or the Claude app. The page can also start and drive its own chats with your `claude` CLI.

**Conversations stay.** A conversation started on a box of the map is listed in that box's chat (the one used last first), and the map shows it on that part. Closing the sheet does not stop it; tapping it again shows its history and continues it (`claude --resume`), even after the server restarts. Reloading the page reopens the conversation that was open.

**Permissions.** A page chat runs in the permission mode of your own Claude Code: `permissions.defaultMode` from `~/.claude/settings.json`, then the project's `.claude/settings.json`, then `.claude/settings.local.json` (the more specific file wins, as in Claude Code). With nothing set, that is `default`, which asks before every tool that is not already allowed. The selector in the chat header changes it for that conversation only: **Same as Claude**, **Ask every time** (`default`), **Edits on their own** (`acceptEdits`) or **Automatic** (`auto`); the choice is kept per conversation and switches a running one from its next step. Whatever the mode still asks about appears in the sheet with **Allow** / **Deny** (no answer in 25 s denies it), and **Always in this conversation** is remembered for that conversation, also after a resume. `bypassPermissions` is never used: if your settings say so, the page runs the chat in `auto` and tells you.

**Every Claude on this PC.** Next to the selector, **Use on this whole PC** makes the chosen mode the default of your own Claude Code. After you confirm it, the server writes `permissions.defaultMode` (`default`, `acceptEdits` or `auto`, never `bypassPermissions`) into `~/.claude/settings.json` and leaves the other keys alone. VS Code and the terminal read that file too, so the mode applies to every new conversation on this PC. Before the first change a copy of the file goes to `settings.json.session-map-bak` next to it, and **Undo the last change** puts back the value from before.

> **Security:** a chat started from the page can edit files and run commands on this PC, like any Claude Code session, and in `acceptEdits` or `auto` it does part of that without asking you. Anyone holding your token can drive it, pick its mode, and switch the mode of every Claude on this PC to `auto`. Keep the token private and the page off the open internet.

## Costs are estimates

Costs are the API-price equivalent of the tokens in your local history. They are not your subscription bill.

## Internal formats may change

The plugin reads Claude Code's local files (sessions, transcripts, skills). Those formats are not a public contract and may change; everything that depends on them lives in `server/sources/claude.mjs`, so a break is a one-file fix.

## Privacy

The server reads `~/.claude` (or `CLAUDE_CONFIG_DIR`) and writes to `~/.claude/session-map/` (token, config, archive, notes and logs) and, only when you confirm it on the page, `permissions.defaultMode` in `~/.claude/settings.json`. The architecture folder of a project is written by the chats, through your `claude` CLI and in your permission mode, not by the server. Data leaves your machine in two cases.

**AI organisation, on by default.** The map places the conversations the code could not place with your own `claude` CLI (`claude -p`, model `haiku`), so it goes to Anthropic like any Claude Code prompt. Only conversations that no item code and no edited file could place are shown to the AI, once each. A call sends a digest of one conversation, never the transcript: its title, up to 8 of your prompts cut to 160 characters, up to 30 file paths, up to 10 commit subjects, the branch name, and the name, layer, purpose and folders of each part of the project's architecture. At most 30 calls per hour. Every call counts against your subscription limits or your API spend. To turn it off, put this in `~/.claude/session-map/config.json`:

```json
{ "ai": { "enabled": false } }
```

The map then places chats by the item codes they cite, by the files they touch and by the cards from `/session-map:board`.

**Discover tab.** It asks the GitHub API for public plugin repositories, and looks up the marketplaces you already added, only when you open the tab. If `GITHUB_TOKEN` is set, or `gh auth token` answers, that token goes to GitHub with these requests, for a wider search and a higher rate limit.

The network link (`--lan`) is plain HTTP: on a network you do not trust, use Tailscale or `--local`.

## Configuration

Machine-wide settings live in `~/.claude/session-map/config.json`. Every key is optional:

```json
{
  "ai": { "enabled": true, "model": "haiku", "maxCallsPerHour": 30 },
  "budget": { "monthlyUSD": 100 },
  "currency": { "code": "BRL", "rate": 5.4 },
  "tunnelUrl": "https://vscode.dev/tunnel/my-pc",
  "projects": {
    "c:/dev/shop": { "roadmap": "docs/ROADMAP.md", "decisions": { "heading": "Decisions", "pendingWhen": "pending" }, "autoFetchMinutes": 15 }
  }
}
```

- `ai`: the AI organisation (see Privacy). `"ai": { "enabled": false }` turns it off.
- `budget.monthlyUSD`: shows how much of a monthly budget the estimated cost has used.
- `currency`: shows costs in another currency, at the rate you give (1 USD = `rate`).
- `tunnelUrl`: the link of your [VS Code Remote Tunnel](https://code.visualstudio.com/docs/remote/tunnels) (https only); it adds a **VS Code on your phone** button next to the files.
- `projects`: per-project settings, keyed by the project folder in lower case with `/`. The same keys can sit in `<project>/.claude/session-map.json`; the entry here wins.
  - `roadmap`: a Markdown file, relative to the project, whose `[x]`/`[ ]` (or ✅/⬜) lines become milestones. `decisions` reads the lines under the heading named `heading` that contain `pendingWhen` as decisions waiting for you.
  - `autoFetchMinutes`: runs `git fetch` that often so branches pushed from other machines show up. Off by default.
  - `ai`: `{ "enabled": false }` here turns the AI off for that project only.


## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
