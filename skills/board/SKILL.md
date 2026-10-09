---
name: board
description: Use when the user asks to update this conversation's card on the session map, or when a big step closes, the work front changes, or a question is left waiting for the user.
---

# Board card

The session map reads the **last** valid `session-map` block in this conversation. Write one as plain text in your reply; no file, no command.

````text
```session-map
{"title":"Step 5 - official messages","area":"messaging","front":"official-messages","milestone":"5",
 "doing":"registering the 12 templates","todo":["group 4","push"],"waiting":["register the card with the provider"],
 "decided":["templates stay in the core package"],"estimateUSD":3}
```
````

| Field | Meaning |
|---|---|
| `title` | Short name of this conversation |
| `area` | The area (cell) of the project it belongs to |
| `front` | Branch or worktree being worked on |
| `milestone` | Step or milestone id |
| `doing` | What is happening now |
| `todo`, `waiting` | Lists; `waiting` is only what needs the user |
| `decided` | Decisions worth keeping in the area's memory |
| `estimateUSD` | Expected cost of the whole front |

Keep it short: valid JSON, at most 15 lines, texts of one line, lists of a few items. Omit fields you do not know.

Renew the card when a big step closes and when the work moves to another front. Invalid fields are ignored; invalid JSON drops the whole card.
