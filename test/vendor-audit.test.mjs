import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The foundation's rule (or43, item 7): vendored code is pinned with its license and audited before adoption. The
// audit is vendor/AUDIT.md, one line per file; a vendored file without its line, or a line without version, license
// or date, fails here — the rule is engine, not prose.

const vendorDir = fileURLToPath(new URL('../server/web/vendor', import.meta.url));
const audit = readFileSync(join(vendorDir, 'AUDIT.md'), 'utf8');
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

test('every vendored file has its audit line with version, license and date', () => {
  const files = readdirSync(vendorDir).filter((f) => f.endsWith('.min.js')).sort();
  assert.ok(files.length >= 5, 'the vendor folder is not empty');
  for (const f of files) {
    assert.ok(audit.includes(`| ${f} |`), `${f} has an audit line`);
    const line = audit.split('\n').find((l) => l.includes(`| ${f} |`)) ?? '';
    const cells = line.split('|').map((c) => c.trim());
    assert.ok(/^[\d.]+$/.test(cells[2] ?? ''), `${f} has a version`);
    assert.ok((cells[3] ?? '').length >= 2, `${f} has a license`);
    assert.ok(DATE_RE.test(cells[5] ?? ''), `${f} has an audit date`);
  }
});

test('no audit line points at a file that is not there', () => {
  const files = new Set(readdirSync(vendorDir));
  for (const m of audit.matchAll(/\| ([a-z0-9.-]+\.min\.js) \|/g)) {
    assert.ok(files.has(m[1]), `audit line for a missing file: ${m[1]}`);
  }
});
