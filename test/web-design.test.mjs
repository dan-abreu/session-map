// The visual system written in DESIGN.md, held by the stylesheet: one type scale, a 2 px spacing grid, one radius scale,
// shadows and colors only through tokens, motion through duration tokens that reduced motion switches off, and text
// colors that pass WCAG AA on the surfaces they sit on, in light and dark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Every declaration with the selector chain it sits in; custom properties (tokens) are kept apart.
function declarations(text) {
  const out = [];
  const stack = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') { stack.push(buf.trim()); buf = ''; } else if (ch === '}') {
      if (buf.trim()) out.push(...split(buf, stack));
      stack.pop();
      buf = '';
    } else if (ch === ';') { out.push(...split(buf, stack)); buf = ''; } else buf += ch;
  }
  return out;
}
function split(chunk, stack) {
  const at = chunk.indexOf(':');
  if (at < 0) return [];
  return [{ prop: chunk.slice(0, at).trim(), value: chunk.slice(at + 1).trim(), where: stack.join(' > ') }];
}
const all = declarations(css);
const plain = all.filter((d) => !d.prop.startsWith('--') && !/@keyframes/.test(d.where));

function tokens(dark) {
  const map = {};
  for (const d of all) {
    if (!d.prop.startsWith('--') || !/(^|> ):root/.test(d.where)) continue;
    const inDark = /prefers-color-scheme: dark/.test(d.where);
    if (inDark && !dark) continue;
    if (!inDark || dark) map[d.prop] = d.value;
  }
  return map;
}
const light = tokens(false);
const dark = tokens(true);

test('the type scale has seven steps and every font size uses one of them', () => {
  for (const step of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']) assert.ok(light[`--fs-${step}`], `--fs-${step} missing`);
  const bad = plain.filter((d) => /^font(-size)?$/.test(d.prop) && /\d(rem|px)\b/.test(d.value) && !/var\(--fs-/.test(d.value));
  assert.deepEqual(bad.map((d) => `${d.where} { ${d.prop}: ${d.value} }`), []);
});

test('spacing sits on a 2 px grid (1 px only as a hairline nudge)', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 8]) assert.ok(light[`--sp-${n}`], `--sp-${n} missing`);
  const bad = [];
  for (const d of plain) {
    if (!/^(padding|margin|gap|row-gap|column-gap)(-\w+)*$/.test(d.prop)) continue;
    for (const m of d.value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
      const n = Math.abs(Number(m[1]));
      if (n !== 1 && n % 2 !== 0) bad.push(`${d.where} { ${d.prop}: ${d.value} }`);
    }
  }
  assert.deepEqual(bad, []);
});

test('corners come from the radius scale', () => {
  for (const step of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', 'pill']) assert.ok(light[`--r-${step}`], `--r-${step} missing`);
  const bad = plain.filter((d) => /^border(-[a-z]+)*-radius$/.test(d.prop) && /\d+px/.test(d.value));
  assert.deepEqual(bad.map((d) => `${d.where} { ${d.prop}: ${d.value} }`), []);
});

test('colors and shadows outside the tokens are only token references', () => {
  for (const name of ['--shadow-xs', '--shadow-sm', '--shadow-md', '--shadow-lg', '--scrim', '--on-clash']) {
    assert.ok(light[name], `${name} missing in light`);
    assert.ok(dark[name], `${name} missing in dark`);
  }
  const bad = plain.filter((d) => /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(d.value));
  assert.deepEqual(bad.map((d) => `${d.where} { ${d.prop}: ${d.value} }`), []);
});

test('motion uses the duration tokens, and reduced motion turns every animation and transition off', () => {
  for (const name of ['--dur-fast', '--dur-base', '--dur-slow']) assert.ok(light[name], `${name} missing`);
  const timed = plain.filter((d) => /^(transition|animation)(-duration|-delay)?$/.test(d.prop) && !/prefers-reduced-motion/.test(d.where));
  const bad = timed.filter((d) => /\d+m?s\b/.test(d.value.replace(/(?<![\d.])0s\b/g, '')));
  assert.deepEqual(bad.map((d) => `${d.where} { ${d.prop}: ${d.value} }`), []);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration:\s*0\.01ms !important;[^}]*transition-duration:\s*0\.01ms !important;/);
});

// WCAG relative luminance and contrast, with alpha fills composited over the surface they sit on.
function parse(value, map) {
  let v = value.trim();
  for (let i = 0; i < 5 && /^var\(/.test(v); i++) v = map[v.slice(4, -1).trim()];
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const rgb = v.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`cannot read color ${value} -> ${v}`);
}
const over = (top, base) => [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
const lum = (c) => {
  const [r, g, b] = c.slice(0, 3).map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const PAIRS = [
  // [text, surface, fill over the surface or null, minimum]
  ...['--bg', '--bg-2', '--bg-3', '--canvas'].flatMap((s) => [['--ink', s, null, 4.5], ['--ink-2', s, null, 4.5]]),
  ['--active-ink', '--bg-2', '--active-fill', 4.5],
  ['--waiting-ink', '--bg-2', '--waiting-fill', 4.5],
  ['--clash-ink', '--bg-2', '--clash-fill', 4.5],
  ['--doing-ink', '--bg-2', '--doing-fill', 4.5],
  ['--idle-ink', '--bg-2', '--idle-fill', 4.5],
  ...['tasks', 'chats', 'branches', 'changes', 'files'].map((k) => [`--k-${k}-ink`, '--bg-2', `--k-${k}-fill`, 4.5]),
  ...['0', '1', '2', '3'].map((l) => [`--lv${l}-ink`, `--lv${l}-bg`, null, 4.5]),
  ['--on-waiting', '--waiting', null, 4.5],
  ['--on-clash', '--clash', null, 4.5],
  ['--bg-2', '--ink', null, 4.5],
  ['--focus', '--bg', null, 3],
  ['--focus', '--bg-2', null, 3],
  // The colors of code in the file viewer (mm26), on the viewer's surface.
  ...['com', 'str', 'kw', 'num', 'tag', 'attr', 'key'].map((k) => [`--syn-${k}`, '--bg-2', null, 4.5]),
];

for (const [name, map] of [['light', light], ['dark', dark]]) {
  test(`text colors pass WCAG AA on their surfaces (${name})`, () => {
    const fails = [];
    for (const [text, surface, fill, min] of PAIRS) {
      const base = parse(`var(${surface})`, map);
      const ground = fill ? over(parse(`var(${fill})`, map), base) : base;
      const r = ratio(parse(`var(${text})`, map), ground);
      if (r < min) fails.push(`${text} on ${fill ?? surface}: ${r.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(fails, []);
  });
}

test('DESIGN.md records the system: the eight sections, every type step and the glossary', () => {
  const doc = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
  for (const s of ['Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts"]) assert.match(doc, new RegExp(`^## ${s}$`, 'm'), s);
  for (const step of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']) assert.ok(doc.includes(`--fs-${step}`), step);
  for (const word of ['line of work', 'saved change', 'team of helpers', 'version history']) assert.ok(doc.includes(word), word);
});

test('two font stacks only, always through their tokens', () => {
  for (const name of ['--font', '--mono']) assert.ok(light[name], `${name} missing`);
  const bad = plain.filter((d) => /^font(-family)?$/.test(d.prop) && /monospace|sans-serif|serif\b/.test(d.value));
  assert.deepEqual(bad.map((d) => `${d.where} { ${d.prop}: ${d.value.slice(0, 60)} }`), []);
});

test('on a phone the project picker shrinks inside the top bar instead of covering the Conversations button', () => {
  const phone = (sel, prop) => plain.find((d) => d.where === `@media (max-width: 719px) > ${sel}` && d.prop === prop)?.value;
  assert.equal(phone('.pp-btn', 'min-width'), '0', 'the button may be narrower than its content');
  assert.equal(phone('.pp-btn', 'max-width'), '100%', 'and never wider than the room the bar gives it');
  assert.equal(phone('.pp-btn', 'overflow'), 'hidden');
});
