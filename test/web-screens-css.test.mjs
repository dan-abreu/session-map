// The same visual rules web-design holds for style.css (type scale, 2 px grid, radius scale, colors through tokens,
// motion through duration tokens), applied to the block stylesheets css/fd-*.css. fd-screens.css only imports three of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../server/web/css/', import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(text) {
  const out = [];
  const stack = [];
  let buf = '';
  const split = (chunk) => {
    const at = chunk.indexOf(':');
    return at < 0 ? [] : [{ prop: chunk.slice(0, at).trim(), value: chunk.slice(at + 1).trim(), where: stack.join(' > ') }];
  };
  for (const ch of text) {
    if (ch === '{') { stack.push(buf.trim()); buf = ''; } else if (ch === '}') {
      if (buf.trim()) out.push(...split(buf));
      stack.pop();
      buf = '';
    } else if (ch === ';') { out.push(...split(buf)); buf = ''; } else buf += ch;
  }
  return out;
}

const files = readdirSync(DIR).filter((f) => /^fd-.*\.css$/.test(f));
const plain = files.flatMap((f) => declarations(read(f)).filter((d) => !d.prop.startsWith('--') && !/@keyframes/.test(d.where)).map((d) => ({ ...d, f })));
const show = (d) => `${d.f}: ${d.where} { ${d.prop}: ${d.value} }`;

test('fd-screens.css only imports the three screen stylesheets, and they exist', () => {
  const imports = [...read('fd-screens.css').matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?\s*;/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['fd-nav.css', 'fd-home.css', 'fd-saude.css']);
  assert.equal(read('fd-screens.css').replace(/@import[^;]*;/g, '').trim(), '');
  for (const f of imports) assert.ok(existsSync(new URL(f, DIR)), f);
});

test('font sizes use the type scale tokens', () => {
  const bad = plain.filter((d) => /^font(-size)?$/.test(d.prop) && /\d(rem|px)\b/.test(d.value) && !/var\(--fs-/.test(d.value));
  assert.deepEqual(bad.map(show), []);
});

test('spacing sits on a 2 px grid (1 px only as a hairline nudge)', () => {
  const bad = [];
  for (const d of plain) {
    if (!/^(padding|margin|gap|row-gap|column-gap)(-\w+)*$/.test(d.prop)) continue;
    for (const m of d.value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
      const n = Math.abs(Number(m[1]));
      if (n !== 1 && n % 2 !== 0) bad.push(show(d));
    }
  }
  assert.deepEqual(bad, []);
});

test('corners come from the radius scale', () => {
  const bad = plain.filter((d) => /^border(-[a-z]+)*-radius$/.test(d.prop) && /\d+px/.test(d.value));
  assert.deepEqual(bad.map(show), []);
});

test('colors and shadows are only token references', () => {
  const bad = plain.filter((d) => /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(d.value));
  assert.deepEqual(bad.map(show), []);
});

test('motion uses the duration tokens', () => {
  const timed = plain.filter((d) => /^(transition|animation)(-duration|-delay)?$/.test(d.prop) && !/prefers-reduced-motion/.test(d.where));
  const bad = timed.filter((d) => /\d+m?s\b/.test(d.value.replace(/(?<![\d.])0s\b/g, '')));
  assert.deepEqual(bad.map(show), []);
});

test('the checks see the block stylesheets', () => {
  assert.ok(files.includes('fd-screens.css'));
  assert.ok(files.length >= 4);
});
