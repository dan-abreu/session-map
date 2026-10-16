# Architecture decision records

One short file per decision that shaped the program and would be expensive to rediscover: what was decided, why, and what it
costs. A decision that changes is not edited: a new record replaces it and says so. The plan itself (what is built, what is
open) lives in [docs/architecture](../architecture/README.md); the words used here are in the [glossary](../glossary.md).

| Record | Decision |
|---|---|
| [0001](0001-no-npm-dependencies.md) | No npm dependencies, no build step |
| [0002](0002-the-architecture-map-is-the-source.md) | The architecture map is the one source of what the agents know |
| [0003](0003-the-guard-is-open-by-default.md) | The guard is open by default; strict is a choice |
| [0004](0004-the-chat-never-moves-on-its-own.md) | The main chat's model never moves on its own |
| [0005](0005-built-is-not-done.md) | Built is not done: a feature is done when something runs it |
