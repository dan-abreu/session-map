// The bench's "code" set (or12), run for real in the bench's sandbox: every reference passes its own tests, and the
// wrong solutions the checkers wrote for the loose spots are now caught. A test file that a wrong answer passes would
// score that answer as right, so each mutant here is a spot the tests once left open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCodeItem } from '../server/bench/sandbox.mjs';

const set = JSON.parse(readFileSync(new URL('../server/bench/sets/code.json', import.meta.url), 'utf8'));
const item = (id) => set.items.find((i) => i.id === id);

// [item id, why, [from, to] replacements in the reference] or [item id, why, full code].
const MUTANTS = [
  ['redact-cpf', 'a word boundary instead of "not glued to a digit"', [['(?<!\\d)', '\\b'], ['(?!\\d)', '\\b']]],
  ['extract-json', 'quotes before the first brace are tracked', `export function extractJSON(text) {
  if (typeof text !== 'string') return { ok: false, error: 'not text' };
  let inString = false; let start = -1; let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (c === '\\\\') i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '{') { if (start === -1) start = i; depth++; }
    else if (c === '}' && start !== -1 && --depth === 0) {
      try { return { ok: true, value: JSON.parse(text.slice(start, i + 1)) }; } catch (e) { return { ok: false, error: 'does not parse' }; }
    }
  }
  return { ok: false, error: start === -1 ? 'no object in the answer' : 'not closed' };
}`],
  ['split-headings', 'an indented fence is not a fence', [["line.trimStart().startsWith('```')", "line.startsWith('```')"]]],
  ['split-headings', 'a short section is re-packed', [['if (text.length <= maxChars) { out.push(text); continue; }', '']]],
  ['parse-args', 'parseFloat instead of Number', [['Number(value)', 'parseFloat(value)']]],
  ['parse-args', 'Infinity accepted', [['!Number.isFinite(n)', 'Number.isNaN(n)']]],
  ['parse-args', 'a separate empty argument accepted', [["if (value === '')", "if (value === '' && eq !== -1)"]]],
  ['checklist-line', 'a + bullet', [['[-*]', '[-*+]']]],
  ['checklist-line', 'no space after the box', [['\\]\\s+(', '\\]\\s*(']]],
  ['checklist-line', 'a code with no digits', [['[a-z]+\\d+', '[a-z]+\\d*']]],
  ['checklist-line', 'a code starting with digits', [['[a-z]+\\d+', '[a-z0-9]+']]],
  ['win-path', 'any drive letter lowercased', [['/^([A-Za-z]):/', '/([A-Za-z]):/g']]],
  ['format-usd', 'toFixed rounding', [['Math.round(Math.abs(n) * 100)', 'Math.round(Number(Math.abs(n).toFixed(2)) * 100)']]],
  ['daily-cost', 'the total sums rounded values', [['total += v;', 'total += r4(v);']]],
  ['pick-model', 'mechanical work moves up at large', [["if (kind === 'mechanical') return { model: 'sonnet', effort: 'medium' };", "if (kind === 'mechanical') return size === 'large' ? { model: 'opus', effort: 'high' } : { model: 'sonnet', effort: 'medium' };"]]],
  ['pick-model', 'search moves up at large', [["if (kind === 'search') return { model: 'haiku', effort: 'low' };", "if (kind === 'search') return size === 'large' ? { model: 'sonnet', effort: 'medium' } : { model: 'haiku', effort: 'low' };"]]],
  ['pick-model', 'small logic goes down to haiku', [[": { model: 'sonnet', effort: 'high' };", ": size === 'small' ? { model: 'haiku', effort: 'low' } : { model: 'sonnet', effort: 'high' };"]]],
  ['rank-conversations', 'localeCompare instead of <', [['(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)', 'a.id.localeCompare(b.id)']]],
  ['frontmatter', 'the word null is text', [["v === '' || v === 'null' || v === '~'", "v === '' || v === '~'"]]],
  ['glob', 'brace alternatives not escaped', [[".split(',').map(escapeText)", ".split(',')"]]],
  ['age-text', 'rounds instead of down', [['Math.floor(ms / 1000)', 'Math.round(ms / 1000)']]],
  ['age-text', 'minutes rounded up early', [['Math.floor(ms / 60_000)', 'Math.round(ms / 60_000)']]],
  ['age-text', 'a negative age is shown', [[' || ms < 0', '']]],
  ['slugify', 'a dash left by the cut', [["s.slice(0, 40).replace(/-+$/, '')", 's.slice(0, 40)']]],
  ['slugify', 'accents dropped as letters', [[".normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')", '']]],
  ['slugify', 'an empty result is kept', [[" || 'untitled'", '']]],
  ['merge-ranges', 'ranges that touch stay apart', [['a <= last[1] + 1', 'a <= last[1]']]],
  ['merge-ranges', 'a pair the wrong way round is kept', [['.map(([a, b]) => (a <= b ? [a, b] : [b, a]))', '.map(([a, b]) => [a, b])']]],
  ['merge-ranges', 'the end of a bigger range is overwritten', [['last[1] = Math.max(last[1], b)', 'last[1] = b']]],
  ['budget-state', 'the level comes from the rounded percentage', [['share >= 0.8 ?', 'Math.round(share * 100) >= 80 ?']]],
  ['budget-state', 'the percentage is rounded', [['Math.floor(share * 100)', 'Math.round(share * 100)']]],
  ['budget-state', 'exactly the limit is not over', [['share >= 1 ?', 'share > 1 ?']]],
  ['semver-compare', 'numbers in a pre-release compared as text', [['if (pn && qn) return sign(Number(p) - Number(q));', 'if (pn && qn) return p < q ? -1 : 1;']]],
  ['semver-compare', 'a pre-release is newer than its release', [['if (!x.pre) return 1;\n  if (!y.pre) return -1;', 'if (!x.pre) return -1;\n  if (!y.pre) return 1;']]],
  ['semver-compare', 'more identifiers are older', [['return sign(x.pre.length - y.pre.length);', 'return sign(y.pre.length - x.pre.length);']]],
  ['semver-compare', 'a numeric identifier is newer than a text one', [['if (pn) return -1;\n    if (qn) return 1;', 'if (pn) return 1;\n    if (qn) return -1;']]],
  ['plan-order', 'ready items go first-come first-served instead of first in the input', `export function planOrder(items) {
  if (!Array.isArray(items)) return { ok: true, order: [] };
  const list = [];
  const seen = new Set();
  for (const it of items) if (it && typeof it === 'object' && typeof it.id === 'string' && !seen.has(it.id)) { seen.add(it.id); list.push(it); }
  const left = new Map(list.map((it) => [it.id, new Set((Array.isArray(it.after) ? it.after : []).filter((x) => seen.has(x)))]));
  const queue = list.filter((it) => left.get(it.id).size === 0).map((it) => it.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const it of list) { const s = left.get(it.id); if (s.delete(id) && s.size === 0) queue.push(it.id); }
  }
  if (order.length === list.length) return { ok: true, order };
  return { ok: false, stuck: list.filter((it) => !order.includes(it.id)).map((it) => it.id) };
}`],
  ['plan-order', 'an unknown id blocks the item', [['.filter((x) => known.has(x))', '']]],
  ['plan-order', 'a repeated id counts twice', [[' && !known.has(it.id)', '']]],
  ['wrap-text', 'a line may be one character too long', [['<= width) current +=', '<= width + 1) current +=']]],
  ['wrap-text', 'empty lines are dropped', [["    if (!words.length) {\n      out.push('');\n      continue;\n    }", '    if (!words.length) continue;']]],
  ['wrap-text', 'a long word joins the line before it', [["        if (current) {\n          out.push(current);\n          current = '';\n        }\n", '']]],
  ['wrap-text', 'a long word is not cut', [['while (word.length > width)', 'while (false)']]],
  ['short-title', 'no fallback when the head is left empty', [['(head || s.slice(0, max - 1))', '(sp > 0 ? head : s.slice(0, max - 1))']]],
];

function mutate(reference, change) {
  if (typeof change === 'string') return change;
  let code = reference;
  for (const [from, to] of change) {
    assert.ok(code.includes(from), `the reference no longer holds ${from}`);
    code = code.replace(from, to);
  }
  return code;
}

const expected = new Map();

test('every reference passes its own tests in the sandbox', async () => {
  for (const it of set.items) {
    const r = await runCodeItem({ code: it.reference, tests: it.tests });
    assert.equal(r.ok, true, `${it.id}: ${r.tail}`);
    expected.set(it.id, r.total);
  }
});

test('the wrong solutions the checkers found are now caught', async () => {
  for (const [id, why, change] of MUTANTS) {
    const it = item(id);
    assert.ok(it, id);
    const r = await runCodeItem({ code: mutate(it.reference, change), tests: it.tests, expectedTests: expected.get(id) ?? null });
    assert.equal(r.ok, false, `${id} (${why}): a wrong solution still passes`);
  }
});
