---
name: map
description: Use when the user wants to open the session map, see all their Claude Code conversations at once, or get the link to check their chats from a phone or another device.
---

# Session map

Opens the local session-map page and hands back its links.

1. Check whether the server already answers:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/links.mjs" $ARGUMENTS`
   If it prints links, go to step 3.
2. Otherwise start it in the background (Bash with `run_in_background`), then wait for it:
   `node "${CLAUDE_PLUGIN_ROOT}/server/main.mjs" --lan`
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/links.mjs" --wait $ARGUMENTS`
   If the user passed `--local`, start the server without `--lan`.
3. Show the printed links as they are. The `?k=` token is the user's own key to their own page: print it, do not redact it, and tell them not to share the network link.

`--port N` changes the port (default 4001); pass it to both commands. If the wait fails, say the server did not start and show the last line it logged to stderr.
