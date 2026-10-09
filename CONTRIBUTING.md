# Contributing

Thanks for helping. session-map is small on purpose: Node 20 or newer, no npm dependencies, no build step.

## Run it

```text
node server/main.mjs --demo     # invented data, writes nothing to your disk
node server/main.mjs            # your own history
node --test "test/*.test.mjs"   # the whole suite
```

## Rules

- **Test first.** A change comes with a test that fails without it. Tests use temporary folders and never touch your `~/.claude`.
- **English in code and commits**; page texts exist in English and Portuguese (`server/web/i18n.js`).
- **Conventional Commits**: `feat(web): ...`, `fix(arch): ...`, `docs: ...`.
- **No personal data** in files, fixtures or screenshots: folder names, names, addresses. Fixtures are invented.
- **No shell**: run programs with `execFile`.
- Keep `docs/architecture/` true: if you add a piece of work, add it as an item under "What's missing" of the right part (the `architecture` skill describes the format).

## Pull requests

Small and focused. Say what and why; the template has the checklist. CI runs the suite on Linux and Windows with Node 20 and 24.

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
