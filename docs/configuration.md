# Configuration

session-map needs no setup. Everything below is optional, and the template with the same names is [.env.example](../.env.example).
Nothing in the program loads a `.env` file by itself: export a variable in your shell (or set it in the shortcut that starts
the server) only if you want to change a default.

## For people

| Variable | What it changes | Default |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | Where Claude Code keeps its files; session-map reads them and writes to `<this>/session-map/`. | `~/.claude` |
| `SESSION_MAP_DIR` | The folder of session-map's own state, for the hooks that run outside the server. | `<CLAUDE_CONFIG_DIR>/session-map` |
| `CHROME_PATH` | The Chrome used by the README screenshots and the browser smoke test (scripts only). | the usual install places |
| `DSH_DIR` | Where the DeepSeek helper keeps its files. | `~/.dsh` |
| `DSH_SKILLS` | The skills folder of the DeepSeek helper, written by `scripts/dsh-skills-sync.mjs`. | `~/.dsh/skills` |
| `CLAUDE_SKILLS` | The skills folder that sync reads. | `~/.claude/skills` |

Project settings (not the environment) live in `config.json` of the state folder; a repository can also carry
`.claude/session-map.json`, for example `{"vendored": ["server/disciplines"]}` to say which folders hold other people's code
(see the [glossary](glossary.md)).

## Set by the program

These are given by the server to the processes it starts. Setting them by hand does nothing useful.

| Variable | Given to | Meaning |
|---|---|---|
| `SM_URL` | the map tools of a chat | The address of the server. |
| `SM_DIR` | the map tools of a chat | The state folder, where the session token is. |
| `SM_ROOT` | the map tools of a chat | The project folder the tools may write the architecture to. |
| `SM_SESSION_ID` | the map tools of a chat | The chat the tools belong to. |
| `SM_PERMISSION_URL`, `SM_PERMISSION_SECRET` | the permission door | Where a chat asks the owner before a risky tool, and the secret that proves the ask is the server's. |
| `SM_ORCHESTRATOR` | the permission door | Marks the project's conductor chat, which also gets the conductor's tools. |
| `SM_RESTARTED` | the restarted server | Tells the new process that it replaced an old one. |
| `SESSION_MAP_PAGE_CHAT` | a chat started from the page | Tells the hooks that the book is already in its settings. |
