import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The vendored disciplines (id140, or46): the two open-source repositories, whole, absorbed into the program — with
// their licenses, their core skills, and every file plain text. The rule is engine, not prose.

const dir = fileURLToPath(new URL('../server/disciplines', import.meta.url));
const walk = (d) => {
  let out = [];
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
};

test('both repositories are vendored whole, with their licenses and the core skills', () => {
  const read = (p) => readFileSync(join(dir, p), 'utf8');
  assert.match(read('ponytail/LICENSE'), /MIT License/);
  assert.match(read('superpowers/LICENSE'), /MIT License/);
  for (const p of ['ponytail/skills/ponytail/SKILL.md', 'ponytail/skills/ponytail-review/SKILL.md', 'ponytail/skills/ponytail-debt/SKILL.md', 'ponytail/AGENTS.md', 'ponytail/hooks/claude-codex-hooks.json', 'superpowers/skills/writing-plans/SKILL.md', 'superpowers/skills/requesting-code-review/SKILL.md', 'superpowers/skills/verification-before-completion/SKILL.md', 'superpowers/AGENTS.md']) {
    assert.ok(read(p).length > 200, `${p} is vendored whole`);
  }
  const audit = read('AUDIT.md');
  assert.match(audit, /github\.com\/DietrichGebert\/ponytail/);
  assert.match(audit, /github\.com\/obra\/superpowers/);
});

test('every vendored file is plain text: no binary sneaks in', () => {
  const bad = [];
  for (const f of walk(dir)) {
    const rel = f.slice(dir.length + 1).replace(/\\/g, '/');
    if (rel === 'AUDIT.md') continue;
    const buf = readFileSync(f);
    if (buf.includes(0)) bad.push(rel);
    if (statSync(f).size > 512 * 1024) bad.push(`${rel} (too big: ${statSync(f).size})`);
  }
  assert.deepEqual(bad, []);
});
