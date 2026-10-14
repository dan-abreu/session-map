# Plan: the person's message is rewritten organized before the work and before the book (id111)

**Status:** built (page chat). Files: `server/chat/tidy-words.mjs`, `hub.mjs` (`start`, `send`), `prompt.mjs` (`personsWords`), `test/tidy-words.test.mjs`.

## The idea

The owner writes the way people talk: loose, with slips. A cheap AI (Haiku) rewrites each longer message organized and
coherent (lists for several asks, dictation cleaned, nothing added). **The rewrite is the request**: the working AI reads it,
and the book keeps it as the chapter's request. It gives the working AI the same mental order a person would.

```
message typed -> [tidy: Haiku] -> prompt = organized request
                                          + the person's own words at the end, between two marks
                                -> the working AI reads that prompt
                                -> the page bubble shows the person's own words (personsWords)
                                -> the book chapter opens with the organized request (the tail is the original)
```

## Decisions (a senior's defaults)

1. **Where:** the page chat (`start` for the first message, `send` for the next ones). The terminal is not touched.
2. **Original kept:** a tail between `[session-map: the person's own words, kept as written]` and `[end of the person's own words]`,
   so a misread by the cheap AI loses nothing.
3. **Skips:** under 15 words, slash commands, over 12 000 characters, messages the orchestrator or a restart sends.
4. **Failure is quiet:** no answer, a rewrite under 25 % or over 3x the size, or bad JSON sends the message as it is;
   a failed call is not repeated for 30 minutes.
5. **Gear:** the file `<state>/tidy-words.off` turns it off. A switch in Configurações is a later item.
6. **Old texts** are not redone.

## Left for later

- The book shows the organized request followed by the labeled original; folding that tail needs `book.mjs`
  (another chat has uncommitted changes there).
- The Configurações switch for the gear, with i18n.
