import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The browser modules have no build step: calling a sibling module's function without importing it only fails, as a
// ReferenceError, the day that branch runs (the empty conversation list did). This catches the whole class.
const DIR = new URL('../server/web/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const source = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')]));

const exported = new Map();
for (const [file, code] of Object.entries(source)) {
  for (const m of code.matchAll(/^export (?:async )?(?:function\*?|const|let|class) ([A-Za-z_$][\w$]*)/gm)) exported.set(m[1], file);
}

const escape = (s) => s.replace(/\$/g, '\\$');
const callsIt = (code, name) => new RegExp(`(?<![.\\w$])${escape(name)}\\s*\\(`).test(code);
// Its own function, variable or parameter of that name (a destructured or listed parameter counts).
const declares = (code, name) => new RegExp(`(?:function\\*?|const|let|var|class)\\s+${escape(name)}\\b|[({,]\\s*${escape(name)}\\s*[,})=]`).test(code);
const imports = (code, name) => [...code.matchAll(/^import\s*\{([^}]*)\}\s*from/gm)]
  .some((m) => m[1].split(',').some((s) => s.trim().split(/\s+as\s+/).at(-1) === name));

test('every browser module imports the sibling functions it calls', () => {
  const missing = [];
  for (const [file, code] of Object.entries(source)) {
    for (const [name, home] of exported) {
      if (home === file || !callsIt(code, name) || imports(code, name) || declares(code, name)) continue;
      missing.push(`${file} calls ${name}() from ${home} without importing it`);
    }
  }
  assert.deepEqual(missing, []);
});
