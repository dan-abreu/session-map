# Watcher and alerts

Watches every Claude session on this PC, whatever the project or tool, and tells the owner when something needs attention: a job finished, a question waits, something failed, two lines of work will clash. Every alert explains itself and offers the next step.

## How it works

The server compares each session's state from one read to the next and turns the changes into events. Events reach the owner through the page (browser notification, sound, tab title), through a native desktop toast and, if switched on, through a phone alert. Every sign shown anywhere in the program has the same three parts: what it is, why it is happening, what to do now, plus a button that does it.

## Where in the code

- `server/collect.mjs`
- `server/brain/`
- `server/web/live.js`

## Rules that must not break

- Native toasts run through `execFile` with no extra dependency.
- A phone alert carries only the project and the situation, never the content, and stays off until the owner turns it on with a notice that it passes through an outside service.
- No sign without the three explanation fields.

## What's missing

### Watching

- [ ] **important:** Watch every session on the PC for changes of state `wa01`
  - Sessions from VS Code, the terminal and the map, in any project. Detect: finished (busy → idle with a final answer), waiting for you (a pending question or permission), error or interruption, and a new clash between lines of work.
- [ ] **important:** Alerts in the browser `wa02`
  - Notification API (permission asked once, with an explanation, works with the tab in the background), an optional short sound, and the tab title changing ("(2) session-map").
- [ ] **important:** Native desktop toast `wa03`
  - Windows through PowerShell (`Windows.UI.Notifications`), macOS through `osascript`, Linux through `notify-send`; on by default, and a click opens session-map on that chat.
- [ ] **important:** Phone alert through ntfy (optional) `wa04`
  - A random topic of the owner's; off until switched on.
- [ ] **important:** Alert preferences per project, and grouping `wa05`
  - Config `notify: {browser, desktop, ntfy: {enabled, topic}, perProject}`; similar alerts collapse ("3 jobs finished").

### Signs that explain themselves

- [ ] **important:** One format for every sign: what it is · why · what to do + a button `wa06`
  - A test fails if any kind of sign has the three fields empty.
- [ ] **important:** Branch clash sign with a recommendation `wa07`
  - Which branches, who owns them, the files they share, why it makes a conflict, the advice (join the most advanced first, then update the other). Buttons: "Resolve with the AI" (opens an activity chat with the task and asks for an OK before joining), "See files", "Ignore".
- [ ] **important:** The other signs in the same format `wa08`
  - Waiting for you (the question, the chat, the project, Answer); Blocks something else (what, why, what unblocks it); Error or interruption in plain words (Try again, Continue); Relation (why, whether it asks for action); High cost (why it was spent and a suggestion).

### Limits and the map

- [ ] **Watch the plan's weekly limit** `wa09`
  - Read the limit warnings in the histories (such as "hit your weekly limit" and the reset time) and hold what is not urgent.
- [ ] **Warn about new code outside the map and the Flow** `wa10`
  - "New feature outside the map: add it?"; in `flow.sync` mode `auto` it adds it. Part of the golden rule in `fl12`.
