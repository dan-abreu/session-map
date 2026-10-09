# Server

The local HTTP server that serves the page, the state and every action. It listens on `127.0.0.1` unless started with `--lan`.

## How it works

Reads need nothing from `127.0.0.1`; every write, and every access from another address, needs the token (and a CSRF header for writes). Writes are recorded in an action log. `--demo` serves invented data and never touches the disk.

## Where in the code

- `server/main.mjs`
- `server/auth.mjs`
- `server/actions.mjs`
- `server/files.mjs`
- `server/launch.mjs`

## Rules that must not break

- No token, no write, no read from outside the machine.
- Files are served read-only, text only, never `.git` and never `.env`.

## What's missing

### Safety

- [x] **Claude:** Token cookie, CSRF header and an action log `sv01`
- [ ] **important:** HTTPS for the network link without Tailscale `sv02`

### Reach

- [x] **Claude:** `--demo` with invented data for screenshots `sv03`
