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
- [ ] **in progress:** A quiet chat with a team of helpers still working is never closed for being idle `pc12`
  - Today the hub ends a page chat 30 minutes after its last turn (`IDLE_MS` in `server/chat/hub.mjs`), which kills a workflow or background helpers still running inside it.
  - Before closing, look at the session's helper files (`<session>/subagents/`): anything written within the idle window postpones the close.
- [x] **Claude:** Reopening a running chat is quick and never shows it empty or cut `pc13`
  - Before, the history left out every turn of the running process (they should come as events), but the hub keeps only the last 2000 events and each streamed piece of text was one: a long chat reopened empty or cut. The page also drew the whole chat again for every replayed event, so reopening one froze for a while.
  - Now the pieces go once their whole text arrives (and go first when the events are full), the history ends at the first message the events still hold (by its place in the transcript, or by time for a turn longer than the events) and tells the page where to replay from, and the page draws once per frame.
  - How to confirm it is done: in a page chat with several long replies, reload the page: the whole dialogue shows at once, from the first message.
  - Fixed in the code on 2026-10-10; it reaches the page with the next version.
- [x] **Claude:** Opening a chat never waits for the map to be worked out again `pc14`
  - The chat's routes (list, history, image, helper) awaited a fresh collect whenever the state was older than 3 s, and a collect of every project takes 20 to 30 s on this PC (hundreds of git processes): opening a chat froze that long.
  - They answer with the newest finished state at once while the next one is collected.
  - How to confirm it is done: with the page open for a while, open a chat: its messages show in under a second.

### How it runs

- [x] **Claude:** Automatic and Manual ways a page chat runs, with the model and effort shown `pc07`
  - Automatic (default): Opus at high sizes each request by the CLAUDE.md rule: small ones directly, medium ones through helpers with an explicit model and effort, large or sensitive ones only after a plain explanation, an estimate and the owner's Yes (or within the monthly limit `budget.reinforcedMonthlyUSD`).
  - Manual: Maestro, Ultracode (after a cost warning), a fixed model and level, Same as my Claude. The compact button by Send shows the way, the model and the effort that really run; its menu says why and what it cost so far. Released in v0.2.2.
- [x] **Claude:** The chat sheet as wide as the owner drags it `pc08`
  - A handle on the edge, arrow keys, the width remembered, a double click resets; on the map and in the Flow workshop. Released in v0.2.1.
- [x] **Claude:** Send works on the first click, even when the text box is not focused `pc09`
  - The key hints under the box are hidden but keep their line: before, focus entering the form showed them, Send jumped up under the pointer mid-click and the message never left.
  - How to confirm it is done: type a message, click anywhere outside the box (or change the model in the menu by Send), then click Send once: the message goes and the box empties.
  - Released in v0.2.4.
- [x] **Claude:** The "Finished" line and the alerts read as plain words, without the reply's formatting marks `pc10`
  - How to confirm it is done: ask for an answer with bold text and a list; when it ends, the line above the box and the alert show "Finished: Short answer: …", never `**` or backticks.
  - Released in v0.2.4.
- [x] **Claude:** The chat looks like Claude's, with most of the height for the dialogue `pc11`
  - The way it runs, the model, the effort, the permissions and "use this mode in every Claude on this PC" live in the menu of one compact button by Send ("Automatic · Opus · high"); nothing of it sits at the top.
  - The header is one thin line: where the conversation is, its title, New chat, ⋯ (rename or move, archive, open where it lives) and close.
  - Released in v0.2.4.
  - Headings inside a reply stay close to the text size (1.15, 1.08 and 1 times the text), with tight margins.
  - How to confirm it is done: open a project chat; only the title line sits above the messages; the button by Send opens its menu and Esc or a click outside closes it; a reply with headings reads like the rest of the text, a step bolder.
