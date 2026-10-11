// The AI study of a slice (fd04 rules 4 and 5). The program picks the files of the slice from the census, puts the TEXT
// of their lines in the request, and records in the read ledger exactly what it sent: never what the AI says it read.
// The AI only names and explains, with ids from a closed list; every claim comes back through the checker, and an
// important point is read again by two independent readers and an adversary. Only included files of the census are
// opened, a secrets file never is, and nothing is written in the project: claims.json and read-ledger.json live in
// brain/<id>/foundation/.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { FILE_MAX, isSecretsFile, safeResolve } from '../files.mjs';
import { costOf, loadPrices, priceFor } from '../cost.mjs';
import { log } from '../log.mjs';
import { aiRunnerDir, runClaudeJSON } from '../ai/runner.mjs';
import { checkAll, checkClaim, vocabularyOf } from './evidence-check.mjs';
import { ledgerDocument, lineCharsOf, mergeSpans, recordRead } from './ledger.mjs';
import { readFd, writeFd } from './store.mjs';

export const DEFAULT_MAX_USD = 5;
export const DEFAULT_MODEL = 'sonnet';
// The instruction every study carries, word for word (fd04 rules 2 and 6).
export const STUDY_RULES = [
  'Use only ids from the list below. Never invent an id, a file or a line.',
  'Read only the text below; never answer from memory.',
  'Every claim of type "fact" or "explain" cites file, line and a quote copied exactly from the text below.',
  'Without proof in the text, answer type "not-found" instead of guessing.',
  'Do not set an origin: the program decides it.',
].join('\n');

const CHARS_PER_TOKEN = 4;
const ANSWER_TOKENS = 8000;
const CHECK_ANSWER_TOKENS = 500;
// What a reader or the adversary gets besides the id list: the statement and a few cited lines.
const CHECK_CHARS = 4000;
const NEAR = 2;
// ponytail: one study sends at most this much text; what is left out stays "missing" in the ledger for the next round.
const MAX_TEXT_CHARS = 200_000;
// ponytail: claims read back from one answer, important points sent to readers, rejected claims kept on file.
const MAX_CLAIMS = 200;
const MAX_IMPORTANT = 5;
const MAX_REJECTED = 200;
const MODEL_IDS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };

const sha16 = (data) => createHash('sha256').update(data).digest('hex').slice(0, 16);
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.from - b.from;
const isLine = (n) => Number.isInteger(n) && n >= 1;

// Included files of the census that may be opened: a secrets file never, even if a census marked it included.
function openableRows(census) {
  const rows = new Map();
  for (const f of census?.files ?? []) {
    if (!f?.included || typeof f.path !== 'string' || !f.sha || isSecretsFile(f.path)) continue;
    if (!isLine(f.lines?.total)) continue;
    rows.set(f.path, f);
  }
  return rows;
}

function subtreeOf(model, focus) {
  const nodes = model?.nodes ?? [];
  if (!nodes.some((n) => n.id === focus)) return [];
  const children = new Map();
  for (const n of nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const out = [];
  const walk = (n) => { out.push(n); for (const c of children.get(n.id) ?? []) walk(c); };
  walk(nodes.find((n) => n.id === focus));
  return out;
}

// The folder a component stands for: "cmp:apps/api/src/routes" -> "apps/api/src/routes/"; "#root" has none of its own.
const folderOf = (node) => (node.id.startsWith('cmp:') && !node.id.includes('#') ? `${node.id.slice(4)}/` : null);

function focusSpans(model, rows, focus) {
  const nodes = subtreeOf(model, focus);
  const whole = new Set();
  const spans = [];
  const all = [...rows.keys()];
  const byId = new Map((model?.nodes ?? []).map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.kind === 'system') all.forEach((p) => whole.add(p));
    else if (n.kind === 'container') {
      for (const pre of n.files ?? []) all.filter((p) => p.startsWith(pre)).forEach((p) => whole.add(p));
    } else if (n.kind === 'component') {
      const folder = folderOf(n);
      if (folder) all.filter((p) => p.startsWith(folder)).forEach((p) => whole.add(p));
      else {
        // "<container>#root": the files of the container that no folder component of it takes
        const ctr = byId.get(n.parentId);
        const siblings = (model.nodes ?? []).filter((s) => s.parentId === n.parentId).map(folderOf).filter(Boolean);
        for (const pre of ctr?.files ?? []) {
          all.filter((p) => p.startsWith(pre) && !siblings.some((s) => p.startsWith(s))).forEach((p) => whole.add(p));
        }
      }
    }
    if (n.kind === 'function') {
      const e = n.evidence?.[0];
      if (e && rows.has(e.file)) spans.push({ path: e.file, from: e.line, to: n.attrs?.endLine ?? e.line });
    } else for (const e of n.evidence ?? []) if (rows.has(e.file)) whole.add(e.file);
  }
  for (const p of whole) spans.push({ path: p, from: 1, to: rows.get(p).lines.total });
  return spans;
}

/**
 * The lines a slice asks for, cut to what may be read: `{ focus: <nodeId> }` (the node and everything under it) or
 * `{ spans: [{ path, from, to }] }`. Only included files of the census, never a secrets file, lines clipped to the file,
 * joined per file. Returns `[{ path, from, to }]` sorted by path.
 */
export function sliceSpans(model, census, slice = {}) {
  const rows = openableRows(census);
  const asked = Array.isArray(slice?.spans) ? slice.spans : typeof slice?.focus === 'string' ? focusSpans(model, rows, slice.focus) : [];
  const per = new Map();
  for (const s of asked) {
    const row = rows.get(s?.path);
    if (!row || !isLine(s.from) || !isLine(s.to) || s.to < s.from || s.from > row.lines.total) continue;
    per.set(s.path, [...(per.get(s.path) ?? []), [s.from, Math.min(s.to, row.lines.total)]]);
  }
  const out = [];
  for (const [path, list] of per) for (const [from, to] of mergeSpans(list)) out.push({ path, from, to });
  return out.sort(byPath);
}

const priceKey = (model) => MODEL_IDS[model] ?? model;
function usd(model, prices, tokensIn, tokensOut) {
  if (!priceFor(priceKey(model), prices)) return null;
  return costOf([{ model: priceKey(model), input: tokensIn, output: tokensOut }], prices).usd;
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * What a study of `slice` will cost, before anything is sent: characters of its lines (from the census; a part of a
 * file counts its share of lines) plus `extraChars` (ids and instructions) -> tokens -> US$ at the model's price, with
 * room for the readers and the adversary of the important points. `ask` = above `maxUSD`, or no price to bound it.
 * A `{ focus }` slice is counted through `graph` (the model.json); without it the focus would count as nothing.
 */
export function estimateStudy(slice, census, prices = loadPrices(), { model = DEFAULT_MODEL, maxUSD = DEFAULT_MAX_USD, extraChars = 0, graph } = {}) {
  const byFocus = !Array.isArray(slice?.spans) && typeof slice?.focus === 'string';
  if (byFocus && !graph) throw new TypeError('estimateStudy: a { focus } slice needs the graph (model.json) to be counted');
  const rows = openableRows(census);
  let chars = 0;
  for (const s of sliceSpans(graph ?? null, census, byFocus ? { focus: slice.focus } : { spans: slice?.spans ?? [] })) {
    const row = rows.get(s.path);
    chars += Math.round(((row.chars ?? 0) * (s.to - s.from + 1)) / row.lines.total);
  }
  const tokensIn = Math.ceil((chars + extraChars + STUDY_RULES.length) / CHARS_PER_TOKEN);
  const main = usd(model, prices, tokensIn, ANSWER_TOKENS);
  const checkIn = Math.ceil((CHECK_CHARS + extraChars) / CHARS_PER_TOKEN);
  const check = usd(model, prices, checkIn, CHECK_ANSWER_TOKENS);
  const calls = 1 + MAX_IMPORTANT * 3;
  const estimateUSD = main === null || check === null ? null : round6(main + MAX_IMPORTANT * 3 * check);
  return { chars, tokensIn, tokensOut: ANSWER_TOKENS, calls, checkUSD: check, estimateUSD, maxUSD, ask: estimateUSD === null || estimateUSD > maxUSD };
}

// Today's text of an openable file, only if it is still the one the census counted (same sha).
function readerOf(root, rows) {
  const cache = new Map();
  return (path) => {
    if (cache.has(path)) return cache.get(path);
    let got = null;
    const row = rows.get(path);
    const abs = row ? safeResolve(root, path) : null;
    if (abs && !isSecretsFile(abs)) {
      try {
        if (statSync(abs).size <= FILE_MAX) {
          const buf = readFileSync(abs);
          const text = buf.toString('utf8');
          const lines = text.split('\n');
          if (lines.at(-1) === '') lines.pop();
          got = { text, lines, sha: sha16(buf) };
        }
      } catch { got = null; }
    }
    cache.set(path, got);
    return got;
  };
}

const numbered = (lines, from, to) => {
  const out = [];
  for (let n = from; n <= to; n++) out.push(`${n}| ${lines[n - 1].replace(/\r$/, '')}`);
  return out.join('\n');
};

function idListOf(model, facts, spans, focus) {
  const files = new Set(spans.map((s) => s.path));
  const inTree = new Set(focus ? subtreeOf(model, focus).map((n) => n.id) : []);
  const nodes = (model?.nodes ?? []).filter((n) => inTree.has(n.id) || (n.evidence ?? []).some((e) => files.has(e.file)));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (model?.edges ?? []).filter((e) => ids.has(e.from) || ids.has(e.to));
  const factList = (Array.isArray(facts?.facts) ? facts.facts : []).filter((f) => files.has(f.file));
  const lines = [
    ...nodes.map((n) => `node ${n.id} | ${n.kind} | ${n.name ?? ''}`),
    ...edges.map((e) => `edge ${e.id} | ${e.kind}`),
    ...factList.map((f) => `fact ${f.id} | ${f.kind} | ${f.file}:${f.line}`),
  ];
  return { text: lines.join('\n'), ids: new Set([...ids, ...edges.map((e) => e.id), ...factList.map((f) => f.id)]) };
}

const CLAIM_HINT = '{"claims":[{"about":"<id from the list>","type":"fact|explain|not-found","text":{"en":"…","pt-BR":"…"},"cites":[{"file":"<path>","line":1,"quote":"<exact text>"}],"factIds":["<fact id from the list>"],"important":false}]}';

/**
 * Reads the slice and builds the request, without calling the AI: what the route shows before asking. Returns
 * `{ spans, sent, prompt, ids, idText, estimate, read }`; `sent` = the spans really put in the request, with the sha of the text.
 */
export function planStudy({ model, facts, census, slice, root, prices = loadPrices(), maxUSD = DEFAULT_MAX_USD, aiModel = DEFAULT_MODEL, maxChars = MAX_TEXT_CHARS }) {
  const rows = openableRows(census);
  const read = readerOf(root, rows);
  const spans = sliceSpans(model, census, slice);
  const sent = [];
  const blocks = [];
  let chars = 0;
  for (const s of spans) {
    const file = read(s.path);
    if (!file || file.sha !== rows.get(s.path).sha || file.lines.length !== rows.get(s.path).lines.total) continue;
    let to = s.from - 1;
    for (let n = s.from; n <= s.to; n++) {
      const size = [...file.lines[n - 1]].length + 1;
      if (chars + size > maxChars) break;
      chars += size;
      to = n;
    }
    if (to < s.from) break;
    sent.push({ path: s.path, from: s.from, to, sha: file.sha });
    blocks.push(`=== ${s.path} lines ${s.from}-${to} ===\n${numbered(file.lines, s.from, to)}`);
    if (to < s.to) break;
  }
  const idList = idListOf(model, facts, sent, slice?.focus);
  const prompt = [
    'TASK: study',
    STUDY_RULES,
    '',
    'ID LIST (use only these ids):',
    idList.text,
    '',
    'TEXT (each line starts with its number):',
    blocks.join('\n\n'),
  ].join('\n');
  const estimate = estimateStudy({ spans: sent }, census, prices, { model: aiModel, maxUSD, extraChars: prompt.length - chars + CLAIM_HINT.length });
  return { spans, sent, prompt, ids: idList.ids, idText: idList.text, estimate, read };
}

const claimId = (c) => `claim:${sha16(JSON.stringify(c && typeof c === 'object' ? [c.about, c.type, c.text?.en, (Array.isArray(c.cites) ? c.cites : []).map((x) => [x?.file, x?.line, x?.quote])] : c))}`;

// What the AI sent, as a claim for the checker. The sha of each cite is the program's: the sha of the text it sent, only
// when the cited line was in it. Whatever sha the AI wrote is dropped, so a file it was not sent stays unproven.
function asClaim(raw, sent) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const shaAt = (file, line) => sent.find((s) => s.path === file && line >= s.from && line <= s.to)?.sha;
  // An empty list the AI left out is still empty; a list of the wrong type goes to the checker as it came (bad-shape).
  const cites = raw.cites === undefined ? [] : Array.isArray(raw.cites)
    ? raw.cites.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const sha = shaAt(c.file, c.line);
      return { file: c.file, line: c.line, quote: c.quote, ...(sha ? { sha } : {}) };
    })
    : raw.cites;
  const claim = { id: claimId(raw), about: raw.about, type: raw.type, text: raw.text, cites, factIds: raw.factIds === undefined ? [] : raw.factIds, important: raw.important === true };
  if (raw.origin !== undefined) claim.origin = raw.origin;
  return claim;
}

function citedText(claim, read) {
  const blocks = [];
  const spans = [];
  for (const c of claim.cites) {
    const file = read(c.file);
    if (!file) continue;
    const from = Math.max(1, c.line - NEAR);
    const to = Math.min(file.lines.length, c.line + NEAR);
    blocks.push(`=== ${c.file} lines ${from}-${to} ===\n${numbered(file.lines, from, to)}`);
    spans.push({ path: c.file, from, to, sha: file.sha });
  }
  return { text: blocks.join('\n\n'), spans };
}

const readerPrompt = (claim, idText, text) => [
  'TASK: reader',
  'Say which id of the list the statement is about and which fact ids of the list support it. Use only ids from the list;',
  'read only the text below; without proof, answer about null and no fact ids.',
  '',
  'ID LIST (use only these ids):',
  idText,
  '',
  `STATEMENT: ${claim.text.en}`,
  '',
  'TEXT (each line starts with its number):',
  text,
].join('\n');

const adversaryPrompt = (claim, text) => [
  'TASK: adversary',
  'Try to knock the statement down. For each citation, decide if the cited line really supports the statement.',
  'List the numbers of the citations that do not. When in doubt, list it.',
  '',
  `STATEMENT: ${claim.text.en}`,
  'CITATIONS:',
  ...claim.cites.map((c, i) => `[${i}] ${c.file}:${c.line} "${c.quote}"`),
  '',
  'TEXT (each line starts with its number):',
  text,
].join('\n');

// The same claim twice in one answer is one claim (its id comes from its content).
function onceEach(claims) {
  const seen = new Set();
  return claims.filter((c) => {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') return true;
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// ponytail: one study per project at a time, in this process: two would race on claims.json and read-ledger.json.
const running = new Set();

const asReader = (v) => (v && (v.about === null || typeof v.about === 'string') && Array.isArray(v.factIds) && v.factIds.every((x) => typeof x === 'string')
  ? { role: 'reader', about: v.about, factIds: v.factIds } : null);
const asAdversary = (v) => (v && Array.isArray(v.rejects) && v.rejects.every(Number.isInteger) ? { role: 'adversary', rejects: v.rejects } : null);

/**
 * One AI study of a slice. `{ id, model, facts, census?, slice, root, smDir, exec?, bin?, confirm?, maxUSD?, aiModel?,
 * prices?, now? }`. Above the ceiling without `confirm` it returns `{ ok: false, ask: true, estimateUSD }` and calls
 * nothing. A failed call writes nothing. Otherwise claims.json (approved + rejected[]) and read-ledger.json are written
 * and it returns `{ ok: true, run, estimateUSD, spentUSD, approved, rejected, read }`. While a study of the same project
 * runs, another answers `{ ok: false, error: 'busy' }` and calls nothing.
 */
export async function studySlice(args) {
  const key = `${args?.smDir}
${args?.id}`;
  if (running.has(key)) return { ok: false, error: 'busy' };
  running.add(key);
  try {
    return await studyOnce(args);
  } finally {
    running.delete(key);
  }
}

async function studyOnce({
  id, model, facts, census, slice, root, smDir, exec, bin, confirm = false, maxUSD = DEFAULT_MAX_USD,
  aiModel = DEFAULT_MODEL, prices = loadPrices(), now = () => new Date(), runAI = runClaudeJSON,
}) {
  const at = now();
  const cen = census ?? readFd(smDir, id, 'census.json', null);
  if (!cen) return { ok: false, error: 'no-census' };
  const plan = planStudy({ model, facts, census: cen, slice, root, prices, maxUSD, aiModel });
  const { estimate } = plan;
  if (!plan.sent.length) return { ok: false, error: 'empty-slice', estimateUSD: estimate.estimateUSD };
  if (estimate.ask && !confirm) return { ok: false, ask: true, estimateUSD: estimate.estimateUSD, maxUSD };
  const allowed = confirm ? Math.max(maxUSD, estimate.estimateUSD ?? 0) : maxUSD;
  const run = `study-${at.toISOString().slice(0, 19)}`;
  const call = (prompt, schemaHint) => runAI(prompt, { model: aiModel, cwd: aiRunnerDir(smDir), schemaHint, exec, ...(bin ? { bin } : {}) });

  const main = await call(plan.prompt, CLAIM_HINT);
  if (!main.ok) return { ok: false, error: main.error, estimateUSD: estimate.estimateUSD, spentUSD: main.costUSD ?? 0 };
  let spent = main.costUSD ?? 0;
  const reads = [...plan.sent];

  const raw = Array.isArray(main.value?.claims) ? main.value.claims.slice(0, MAX_CLAIMS) : [];
  const claims = onceEach(raw.map((c) => asClaim(c, plan.sent)));
  const vocab = vocabularyOf(model, facts);
  const linesOf = (file) => {
    const got = plan.read(file);
    return got ? { lines: got.lines, sha: got.sha } : null;
  };

  // fd04 rule 5: two readers who are not told the answer, then an adversary, for each important point that passed.
  const readings = new Map();
  const important = claims.filter((c) => c?.important && checkClaim(c, vocab, linesOf, facts).ok).slice(0, MAX_IMPORTANT);
  for (const claim of important) {
    if (spent + 3 * (estimate.checkUSD ?? 0) > allowed) break;
    const { text, spans } = citedText(claim, plan.read);
    const got = [];
    for (const prompt of [readerPrompt(claim, plan.idText, text), readerPrompt(claim, plan.idText, text)]) {
      const r = await call(prompt, '{"about":"<id from the list or null>","factIds":["<fact id>"]}');
      spent += r.costUSD ?? 0;
      const reading = r.ok ? asReader(r.value) : null;
      if (reading) got.push(reading);
    }
    const a = await call(adversaryPrompt(claim, text), '{"rejects":[0]}');
    spent += a.costUSD ?? 0;
    const adversary = a.ok ? asAdversary(a.value) : null;
    if (adversary) got.push(adversary);
    readings.set(claim.id, got);
    reads.push(...spans);
  }

  const checked = checkAll(claims, { vocab, linesOf, facts, model, now: at.toISOString(), run, readingsOf: (c) => readings.get(c.id) });

  // The ledger: exactly the lines the program put in the requests, never the AI's own list of what it read.
  let ledger = readFd(smDir, id, 'read-ledger.json', null);
  for (const s of reads) ledger = recordRead(ledger, s.path, s.sha, [[s.from, s.to]], { run, model: aiModel, at: at.toISOString() });
  const lineChars = (path) => {
    const got = plan.read(path);
    return got ? lineCharsOf(got.text) : null;
  };
  const ledgerDoc = ledgerDocument(ledger, cen, { lineChars, now: at });
  writeFd(smDir, id, 'read-ledger.json', ledgerDoc);

  // claims.json: a study of a focus replaces what was said about the ids of that focus; the rest stays.
  const prev = readFd(smDir, id, 'claims.json', null);
  const replaced = typeof slice?.focus === 'string' ? plan.ids : new Set();
  const fresh = new Set(checked.approved.map((c) => c.id));
  const kept = (Array.isArray(prev?.claims) ? prev.claims : []).filter((c) => !replaced.has(c.about) && !fresh.has(c.id));
  const all = [...kept, ...checked.approved].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rejected = [...(Array.isArray(prev?.rejected) ? prev.rejected : []), ...checked.rejected].slice(-MAX_REJECTED);
  writeFd(smDir, id, 'claims.json', { version: 1, generatedAt: at.toISOString(), run, claims: all, rejected });

  log('info', 'foundation-study', { project: id, run, approved: checked.approved.length, rejected: checked.rejected.length, spentUSD: round6(spent) });
  return { ok: true, run, estimateUSD: estimate.estimateUSD, spentUSD: round6(spent), approved: checked.approved.length, rejected: checked.rejected.length, read: ledgerDoc.summary };
}
