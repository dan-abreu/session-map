# Session Map library (knowledge packages)

Each `knowledge/<id>.json` is one package of guidance: what a good project does, why, how, and how to tell it is done.
The program that reads them (`server/foundation/library.mjs`) holds no guidance text. The guidance is data, so it can be
reviewed, dated and replaced without touching code.

> **Guidance, not legal or accounting advice.** Packages organize what to check and what to ask a lawyer or an
> accountant. They never say a project is "compliant". Laws, prices and tax rules change; every item shows its source
> and the date it was last checked. / **Orientação, não parecer.** Os pacotes organizam o que conferir e o que levar
> ao advogado ou ao contador. Nunca dizem que um projeto está "em conformidade".

## Two layers

- **Shared** (this folder, in the repository): reviewed, versioned, public. Nothing personal goes here.
- **Local** (`~/.claude/session-map/knowledge/`, on your machine): your own packages and research results. A local
  package with the same `id` replaces the shared one. It is never committed to a project.

A file that is not valid is listed as invalid and skipped; the rest of the library keeps working.

## Package format

The file name is the id: `stack-next.json` has `"id": "stack-next"`. At most 300 lines per file.

```json
{ "version": 1, "id": "stack-next", "kind": "stack",
  "title": { "en": "Next.js", "pt-BR": "Next.js" },
  "applies": { "types": ["web"], "stacks": ["next"], "signals": [], "countries": [], "money": [], "audience": [], "stages": [] },
  "checkedAt": "2026-10-10", "status": "confirmed", "disclaimer": null,
  "lifecycle": { "product": "next", "cycles": [ { "cycle": "16", "supportUntil": null, "securityUntil": "2027-10-01", "source": "https://example.com/releases" } ] },
  "items": [ {
    "id": "next.security-headers", "front": "security", "ladder": "N2", "severity": "R", "effort": 1,
    "title": { "en": "", "pt-BR": "" }, "what": { "en": "", "pt-BR": "" }, "why": { "en": "", "pt-BR": "" },
    "how": { "en": "", "pt-BR": "" }, "doneWhen": { "en": "", "pt-BR": "" },
    "example": { "en": "Your route {route} ...", "pt-BR": "Sua rota {route} ..." },
    "appliesIf": { "signals": ["login"] },
    "detect": { "kind": "content", "files": ["next.config.*"], "contains": ["headers"] },
    "standard": ["05.cabecalhos-de-seguranca"],
    "source": { "name": "Official docs", "url": "https://example.com/docs", "trust": "V" } } ] }
```

- `kind`: `general stack type legal finance marketing sales`.
- `applies`: empty or absent means every project. Different fields are ANDed, values inside one field are ORed.
  `appliesIf` on an item works the same way and turns the item into "not applicable" when it does not match.
- `front`: `organization quality security operation legal product marketing finance`.
- `ladder`: `N0` to `N4`, the maturity step the item belongs to. `severity`: `E` essential, `R` recommended, `A` advanced.
  `effort`: 1 (minutes) to 3 (days).
- Every text is `{ "en", "pt-BR" }`, in simple words. `example` may use only `{route} {table} {integration} {app}`:
  they are filled with facts found in the project, and the example is left out when there is no fact.
- `detect.kind`: `file` (`anyOf` paths), `content` (`files` plus `contains` or `matches`, optional `minLines`),
  `health` (`id` of a repository-health item), `dep` (`name`), `supported-version` (`stack`, uses `lifecycle`) or
  `manual`. Paths stay inside the project; `.env` files are never a target (`.env.example` is fine).
- `source.trust`: **V** verified (official, link opened), **F** vendor or commercial blog, **C** convention without an
  open source, **NV** not verified. `V` and `F` need an `https` url. An `NV` item makes the package `"status": "recheck"`.
- `disclaimer` (`en` and `pt-BR`, "guidance, not advice") is required for `legal` and `finance` packages and for any
  item with the `legal` or `finance` front.

## How old is too old

A package is `stale-source` (check it again) when `checkedAt` is older than: 90 days for `legal` and `finance`, 180 days
for `stack`, 365 days for everything else. The Library screen lists them with a "recheck" button.

## Contributing

1. Open every source before citing it; never write a url from memory. If you cannot open it, use `NV` and `recheck`.
2. Copy the trust mark from `docs/standard/README.md` section 7; never promote a `C` to a `V`.
3. Keep it factual and short. No personal data, no real company names (use "Ana" and "acme" in examples).
4. Run `node --test "test/knowledge-packages.test.mjs"`: it validates every file here.
