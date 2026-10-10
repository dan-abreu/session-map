// Read ledger (fd01): which lines of which files the AI was actually shown, counted in characters, and the rounds still
// needed to close the gap. The caller records what it put into the request itself, never what the AI says it read.
// Pure on purpose: the text of a file reaches this module only as `lineChars(path)` (one number per line), so the
// module never opens a file and a test can feed it anything.

const VERSION = 1;

// Characters of each line of a text, newline included, so the numbers add up to the census' `chars` (code points).
// Lines are split on \n only, the same rule as `lineCount` in sources/count.mjs.
export function lineCharsOf(text) {
  const out = [];
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', start)) {
    out.push([...text.slice(start, i + 1)].length);
    start = i + 1;
  }
  if (start < text.length) out.push([...text.slice(start)].length);
  return out;
}

const isLine = (n) => Number.isInteger(n) && n >= 1;

// Sorted, overlapping and touching spans joined: [[41,80],[1,40]] -> [[1,80]].
export function mergeSpans(spans) {
  const sorted = spans.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]);
    else out.push(s);
  }
  return out;
}

export function emptyLedger() {
  return { version: VERSION, generatedAt: null, files: {} };
}

const copyEntry = (e) => ({ sha: e.sha, spans: e.spans.map((s) => [s[0], s[1]]), reads: e.reads.map((r) => ({ ...r })) });

// A ledger of another version is ignored (contract section 0): the reading starts over.
function filesOf(ledger) {
  const out = {};
  if (!ledger || ledger.version !== VERSION || !ledger.files) return out;
  for (const [path, e] of Object.entries(ledger.files)) out[path] = copyEntry(e);
  return out;
}

function checkSpans(spans) {
  if (!Array.isArray(spans) || spans.length === 0) throw new TypeError('spans must be a non-empty list of [from, to] lines');
  for (const s of spans) {
    if (!Array.isArray(s) || s.length !== 2 || !isLine(s[0]) || !isLine(s[1]) || s[1] < s[0]) {
      throw new TypeError(`spans must be [from, to] with 1 <= from <= to, got ${JSON.stringify(s)}`);
    }
  }
}

// Returns a new ledger with `spans` of `path` added. A different `sha` than the one on record means the file changed:
// what was read of the old content is dropped. One read per run and model, however many spans the run sent.
export function recordRead(ledger, path, sha, spans, meta = {}) {
  if (typeof path !== 'string' || !path) throw new TypeError('path must be a non-empty string');
  if (typeof sha !== 'string' || !sha) throw new TypeError('sha must be a non-empty string');
  checkSpans(spans);
  if (typeof meta.run !== 'string' || typeof meta.model !== 'string') throw new TypeError('meta needs run and model');
  const at = meta.at ?? new Date().toISOString();
  const files = filesOf(ledger);
  const old = files[path];
  const entry = old && old.sha === sha ? old : { sha, spans: [], reads: [] };
  entry.spans = mergeSpans([...entry.spans, ...spans]);
  if (!entry.reads.some((r) => r.run === meta.run && r.model === meta.model)) entry.reads.push({ run: meta.run, model: meta.model, at });
  files[path] = entry;
  return { version: VERSION, generatedAt: at, files };
}

function lineCharsFor(lineChars, path) {
  if (typeof lineChars !== 'function') throw new TypeError('lineChars(path) is needed to count a partly read file');
  return lineChars(path);
}

// Lines of `file` that count as read (clipped to the file) and lines still missing, as spans.
function coverage(entry, file) {
  const total = file.lines.total;
  if (total === 0) return { read: [], missing: [] };
  const read = entry && entry.sha === file.sha
    ? mergeSpans(entry.spans.filter(([a]) => a <= total).map(([a, b]) => [a, Math.min(b, total)]))
    : [];
  const missing = [];
  let next = 1;
  for (const [a, b] of read) {
    if (a > next) missing.push([next, a - 1]);
    next = b + 1;
  }
  if (next <= total) missing.push([next, total]);
  return { read, missing };
}

const sumChars = (per, spans) => spans.reduce((acc, [a, b]) => acc + per.slice(a - 1, b).reduce((x, y) => x + y, 0), 0);
const included = (census) => census.files.filter((f) => f.included).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

// `readChars / totalChars` over the included files of the census. An entry whose sha is not the census' counts as
// unread. Characters are counted per line; if the lines handed in do not add up to the census' `chars` the file
// changed behind the census, so it counts as unread rather than guessed. `percent` rounds down: 99.9 is not 100.
export function ledgerSummary(ledger, census, { lineChars } = {}) {
  const entries = ledger && ledger.version === VERSION && ledger.files ? ledger.files : {};
  let readChars = 0;
  let totalChars = 0;
  const missing = [];
  for (const file of included(census)) {
    totalChars += file.chars;
    let { read, missing: gaps } = coverage(entries[file.path], file);
    if (read.length && gaps.length) {
      const per = lineCharsFor(lineChars, file.path);
      if (!Array.isArray(per) || per.length !== file.lines.total || per.reduce((a, b) => a + b, 0) !== file.chars) {
        read = [];
        gaps = [[1, file.lines.total]];
      } else {
        readChars += sumChars(per, read);
      }
    } else if (read.length) {
      readChars += file.chars;
    }
    if (gaps.length) missing.push({ path: file.path, spans: gaps });
  }
  const percent = totalChars === 0 ? 0 : Math.floor((readChars * 100) / totalChars);
  return { readChars, totalChars, percent, missing };
}

// The whole `read-ledger.json` of the contract: entries that no longer match the census are dropped.
export function ledgerDocument(ledger, census, { lineChars, now = new Date() } = {}) {
  const entries = ledger && ledger.version === VERSION && ledger.files ? ledger.files : {};
  const files = {};
  for (const file of included(census)) {
    const e = entries[file.path];
    if (e && e.sha === file.sha) files[file.path] = copyEntry(e);
  }
  return { version: VERSION, generatedAt: now.toISOString(), files, summary: ledgerSummary(ledger, census, { lineChars }) };
}

// Slices { path, from, to, chars } that cover exactly the lines not yet read and fit in `maxChars` (cut between lines,
// a big file becomes several slices, a slice never crosses a file). A single line longer than `maxChars` cannot be cut
// without breaking the "spans are lines" contract, so it goes alone and carries `oversize: true`.
export function planRounds(ledger, census, { maxChars, lineChars } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new TypeError('maxChars must be a positive integer');
  const entries = ledger && ledger.version === VERSION && ledger.files ? ledger.files : {};
  const slices = [];
  for (const file of included(census)) {
    const { missing } = coverage(entries[file.path], file);
    if (!missing.length) continue;
    const per = lineCharsFor(lineChars, file.path);
    if (!Array.isArray(per) || per.length !== file.lines.total) throw new Error(`lineChars-mismatch: ${file.path} changed since the census`);
    for (const [a, b] of missing) {
      let from = a;
      let chars = 0;
      for (let line = a; line <= b; line++) {
        if (line > from && chars + per[line - 1] > maxChars) {
          slices.push({ path: file.path, from, to: line - 1, chars });
          from = line;
          chars = 0;
        }
        chars += per[line - 1];
      }
      slices.push({ path: file.path, from, to: b, chars });
    }
  }
  for (const s of slices) if (s.from === s.to && s.chars > maxChars) s.oversize = true;
  return slices;
}
