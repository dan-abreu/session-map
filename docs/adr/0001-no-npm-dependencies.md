# 0001 — No npm dependencies, no build step

**Status:** accepted (2026-10-09). **Where:** [CONTRIBUTING.md](../../CONTRIBUTING.md), `package.json`.

**Context.** session-map is a plugin people install into Claude Code and run on their own computer. It reads their
conversations and files, so every dependency is code of strangers inside that trust, and every build step is a thing that can
break on a machine nobody controls. A native module also breaks the plugin on some systems (the in-page terminal, `mm13`, was
parked for exactly that).

**Decision.** Node 20 or newer, the standard library only, plain ES modules served as they are, no bundler. Third-party code
that is worth having is kept whole and visible in the repository (`server/disciplines`, listed under `vendored` in
`.claude/session-map.json`), never installed behind the person's back.

**Consequences.** The program is small to audit and starts at once. We write some things a library would give (the element
helper of the page, the DevTools driver of the smoke test). A lockfile exists only to say there is nothing to lock.
