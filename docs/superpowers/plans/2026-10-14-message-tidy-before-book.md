# Plan: the person's message is tidied before the work and before the book (id111)

**Status:** waiting for the owner's approval. No code written.

## The idea

The owner writes the way people talk: loose, with slips. A cheap AI first rewrites each message as a clear request
(a short title, the ask in plain sentences, a list of tasks when there are several, decisions already given). The
tidied text is what goes to the tasks and what the book keeps as the chapter's request. The owner's original words stay
saved beside it and one click shows them.

## Where it sits

```
message typed -> [1 tidy: cheap AI] -> tidied request + original kept
                                     -> the AI that works reads the tidied request (original on demand)
                                     -> the book chapter opens with the tidied request (cap-N.md, "## Pedido")
```

Today `book-tidy.mjs` only words titles and summaries of *closed* chapters, after the fact. This step is new and runs
*before* the turn.

## Decisions taken (a senior's defaults; change any of them)

1. **Where it hooks:** the prompt hook (`UserPromptSubmit`) of the book, not the page. So it works in the page chat and
   in the terminal alike. The hook returns the tidied request as added context ("Request, tidied: ..."); the original
   message still reaches the AI untouched, so nothing is lost if the cheap AI misreads.
2. **Model:** `[text]` kind, Haiku low, by the policy. Cost guard: skipped for short messages (about 12 words or less),
   for answers to a question the AI asked, and for slash commands. Backoff after a failure, as `tidy.fail` already does.
3. **Never replaces the original.** Stored as `tidy-requests.json` per session: `{ n, original, tidied }`.
4. **The book shows the tidied request as the chapter's request**, the original one fold below it.
5. **A gear:** one switch, on/off, in Configurações. Off = today's behaviour. Nothing else changes.
6. **Honest limit:** a rewrite can change the meaning. So the AI is told the original is the truth and the tidied text
   is a reading aid; the page shows both.

## Tasks

| # | Task | Kind -> model/level | Test |
|---|---|---|---|
| 1 | `tidy-request.mjs`: prompt, schema, skip rules, store | `[code]` Sonnet medium | unit: skips short, keeps original, backoff, bad JSON |
| 2 | Hook: call it before the turn, inject "Request, tidied" | `[code]` Sonnet medium | hook test with a fake runner |
| 3 | Book: chapter request = tidied, original folded | `[code]` Sonnet medium | book.test, web-chat-around |
| 4 | Gear in Configurações + i18n (en, pt) | `[screen]` Sonnet medium | i18n parity test |
| 5 | One review of the delivery by another family (OpenAI or Gemini) | `[review]` | n/a |

Sub-chapters wired into the page panel (2.1, 2.2) stay a separate item, not part of this one.

## Open points (for the owner, not blocking)

- Is "short message skipped" right, or should every message be tidied?
- Should the tidied request also be shown in the chat bubble, or only in the book?

Size: medium. Estimated cost of building: low (Sonnet medium, 3 files plus tests). Running cost: one Haiku call per
longer message.
