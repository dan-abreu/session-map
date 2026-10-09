# Page chat

Lets the page start and continue Claude conversations on a point of the map, and place a new idea in the right part.

## How it works

A chat is a `claude` CLI process per conversation, driven over its stream. The first message carries a short context for the point that was clicked: the path in the map, what the part is about and the item's text. Permission questions come back to the page with Allow and Deny. A conversation survives closing the sheet and a server restart (`--resume`); one the restart cut off mid-turn says so and offers Continue.

## Where in the code

- `server/chat/`

## Rules that must not break

- The mode `bypassPermissions` is never used.
- Writing the user's Claude settings needs the token, a backup first, and can be undone.

## What's missing

### Conversation

- [x] **Claude:** One chat per map point, with the maintenance rule in the first message `pc01`
- [x] **Claude:** "New idea" chat that proposes the part and writes only after an OK `pc02`
- [x] **Claude:** Attach an image to a message `pc03`
  - Paste, drop or pick up to four images (PNG, JPG, GIF, WebP); they go to claude as image blocks and show on the message (mm22).

### Permissions

- [x] **Claude:** Mode per conversation, or one mode for every Claude on this PC, with undo `pc04`

### Chat states

- [x] **Claude:** Clear state on every page chat `pc05`
  - Working, finished (with the final summary), interrupted, waiting for permission. A chat that ended must never look stuck.
  - An on-screen notice when a chat finishes.
- [x] **Claude:** A server restart must not kill a running chat `pc06`
  - Either the process runs detached, or the chat resumes automatically with "the chat was interrupted by the restart, continue?".
