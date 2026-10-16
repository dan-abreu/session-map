import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The fundamental rule (id129): nothing is done without being projected in the architecture first. The motor: every
// file of the program must be covered by a mention in the architecture (its own path, or one of its folders), so code
// that was never projected cannot exist. Vendor, styles and the page's own dictionaries are data, not projections.

const root = fileURLToPath(new URL('..', import.meta.url));
const docs = join(root, 'docs', 'architecture');

const walk = (dir) => {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
};

// The projections: every backticked path in the architecture documents, as relative paths from the repo root.
const mentioned = new Set();
for (const f of walk(docs)) {
  if (!f.endsWith('.md')) continue;
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const p = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
    if (/\.(mjs|js|json|html|md)$/.test(p) || p.includes('/')) mentioned.add(p);
  }
}

// The files of the program that must be projected. Data folders are exempt by nature, not by accident.
const EXEMPT = ['server/web/vendor/', 'server/web/css/', 'server/web/i18n-fd/', 'server/web/img/'];
const base = root.endsWith('\\') || root.endsWith('/') ? root : `${root}\\`;
const program = [];
for (const dir of ['server']) {
  for (const p of walk(join(root, dir))) {
    const rel = p.slice(base.length).replace(/\\/g, '/');
    if (EXEMPT.some((e) => rel.startsWith(e))) continue;
    program.push(rel);
  }
}

// A file is covered when its own path is mentioned, or one of its ancestor folders is.
const covered = (rel) => {
  if (mentioned.has(rel)) return true;
  const segs = rel.split('/');
  for (let i = 1; i < segs.length; i++) {
    if (mentioned.has(`${segs.slice(0, i).join('/')}/`)) return true;
  }
  return false;
};

test('nothing is done without being projected: every file of the program is in the architecture (id129)', () => {
  const missing = program.filter((p) => !covered(p));
  assert.deepEqual(missing, []);
});
