# Security

## Reporting a vulnerability

Please report it privately through GitHub: [Security advisories](https://github.com/dan-abreu/session-map/security/advisories/new). Do not open a public issue. You will get an answer within a week.

## What runs on your machine

- A local HTTP server. It listens on `127.0.0.1` only; `--lan` opens it to your network.
- Every write, and every access from an address other than `127.0.0.1`, needs the token in `~/.claude/session-map/token`. Writes also need a CSRF header.
- A chat started from the page runs your own `claude` CLI and can edit files and run commands on this PC, in the permission mode you pick. `bypassPermissions` is never used.
- Files are served read-only, text only, up to 1 MB, never `.git` and never `.env` files.
- The server writes only to `~/.claude/session-map/` and, if you confirm it on the page, `permissions.defaultMode` in `~/.claude/settings.json` (with a backup); the token also allows that PC-wide change. A project's architecture folder is written by the chats themselves, through your `claude` CLI and in your permission mode, never by the server.
- It sends data out in two cases only: the AI organisation (your own `claude` CLI) and the Discover tab (GitHub API). See the Privacy section of the README.

## Out of scope

Exposing the port to the internet, or sharing the token, is not supported. Use Tailscale or `--local`.
