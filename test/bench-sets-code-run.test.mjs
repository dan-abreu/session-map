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
