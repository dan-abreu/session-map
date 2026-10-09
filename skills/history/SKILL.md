---
name: history
description: Use when the user asks what was discussed or decided in an earlier or deleted Claude Code conversation and the answer may sit in the session-map archive.
---

# History search

Search the archived conversations and report the matches.

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/history-search.mjs" $ARGUMENTS` (add `--project <name>` to narrow it).

Return the script's output as it is: title, first request, last answer and session id for up to five matches. Do not open whole conversations; only when the user picks one, read that one by its session id. With no matches, say so and suggest other words.

## Talking to the person

Answer in the person's language and in plain words: for each match say what the conversation was about, when, what was asked and how it ended. Keep the conversation number for yourself unless they ask for it; use it to open the one they pick.
