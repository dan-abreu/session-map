# 0004 — The main chat's model never moves on its own

**Status:** accepted (2026-10-14), applied 2026-10-15 (`or35`). **Where:** `server/ai/policy.json` (`chat`), `server/chat/hub.mjs`.

**Context.** A first design weighed every message and swapped the chat's process to a cheaper model for small ones. Each swap
dropped the prompt cache and put the owner's chat on a weak model in the middle of a thought; one conversation spent US$ 10 in
compactions. The real cause of the thrash was elsewhere (a 100 k summary window set for a hook), but the swap made it worse
and hid it.

**Decision.** The chat has one level, Opus at high effort, written in the policy file. The brain still weighs each message and
names its phase (talk, plan, build), but the phase never changes the chat's model. Work is delegated to agents, each at the
level of its kind; a model the owner names wins.

**Consequences.** The chat costs more on small messages and never loses the thread or the cache. Any cheaper path (a strong
model that understands and a cheap one that answers) must first win a measured bench; it was built and never run.
