# session-map

[Português](README.pt-BR.md)

A Claude Code plugin that turns every conversation on your machine into a living brain in the browser. Each project is a body: **organs** and **tissues** group **cells** (areas of the work), each cell has a small **nucleus** (what is decided, what is left) and its **neurons** are your chats. Branches show up as work in progress, and a board, a cost view and a searchable history sit next to the brain.

![The brain view](docs/screenshot-brain.png)
![The board view](docs/screenshot-board.png)

The screenshots come from `--demo`, which uses invented data.

## Install

```text
/plugin marketplace add dan-abreu/session-map
/plugin install session-map@session-map
```

## Commands

| Command | What it does |
|---|---|
| `/session-map:map` | Starts the local server if it is not running and prints the links (this PC and your local network). `--local` skips the network link, `--port N` changes the port (default 4001). |
| `/session-map:board` | The current chat writes a short card about itself (area, branch, doing now, what is left, what waits for you) that the map reads. |
| `/session-map:history` | Searches the archived conversation history and answers with short matches. |

Without the plugin: `node server/main.mjs [--lan] [--port 4001]`, or `--demo` for sample data.

## On your phone

`/session-map:map` prints a link with `?k=<token>`. Open it once and the browser keeps the token in a cookie. The token is in `~/.claude/session-map/token`; every write and every access from outside `127.0.0.1` needs it, so treat the network link like a password. The page listens on all interfaces only with `--lan`. Away from home, put both devices on [Tailscale](https://tailscale.com) and use the `100.x` link it prints. Do not expose the port to the internet.

## Chat from the page

For chats that run on this PC, turn on **Enable Remote Control for all sessions** in `/config`: the page then offers a button that continues that conversation from claude.ai or the Claude app. The page can also start and drive its own chats with your `claude` CLI.

> **Security:** a chat started from the page can edit files and run commands on this PC, like any Claude Code session. Anyone holding your token can drive it. Keep the token private and the page off the open internet.

## Costs are estimates

Costs are the API-price equivalent of the tokens in your local history. They are not your subscription bill.

## Internal formats may change

The plugin reads Claude Code's local files (sessions, transcripts, skills). Those formats are not a public contract and may change; everything that depends on them lives in `server/sources/claude.mjs`, so a break is a one-file fix.

## Privacy

Everything stays on your machine. The server reads `~/.claude` (or `CLAUDE_CONFIG_DIR`) and writes only to `~/.claude/session-map/`: token, config, archive, notes and logs. Nothing is sent anywhere, except the optional Discover tab, which asks GitHub for public plugin repositories, and the AI features you turn on, which run through your own `claude` CLI.

## License

MIT. See [LICENSE](LICENSE).
