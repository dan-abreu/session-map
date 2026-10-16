import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The registry's own rules, now engine (or43, items 4-6): a request never disappears (every referenced id exists),
// no personal data in the registry (no personal paths, e-mails or home shortcuts), and every entry asks on a real
// date, never in the future.

const ideas = readFileSync(fileURLToPath(new URL('../docs/architecture/ideas.md', import.meta.url)), 'utf8');
const closed = readFileSync(fileURLToPath(new URL('../docs/architecture/ideas-closed.md', import.meta.url)), 'utf8');
const registry = `${ideas}\n${closed}`;

// An item header defines a code: "- [ ] ... `id123`" or "- [x] ... `id123`".
const defined = () => new Set([...registry.matchAll(/^-\s*\[[ x]\]\s[^\n]*`(id\d+)`/gm)].map((m) => m[1]));

test('a request never disappears: every referenced id still exists in the registry (or43 #4)', () => {
  const found = defined();
  assert.ok(found.size >= 100, 'the registry is real');
  const refs = new Set();
  for (const f of ['orchestration', 'server', 'readers', 'page-chat', 'flow', 'state-builder', 'mind-map-page', 'foundation', 'architecture-map', 'watcher-and-alerts', 'bootstrap-and-inspection', 'plugin-and-terminal', 'operation']) {
    try {
      const text = readFileSync(fileURLToPath(new URL(`../docs/architecture/${f}.md`, import.meta.url)), 'utf8');
      for (const m of text.matchAll(/\b(id\d{1,4})\b/g)) refs.add(m[1]);
    } catch { /* a part that does not exist yet */ }
  }
  const gone = [...refs].filter((id) => !found.has(id));
  assert.deepEqual(gone, [], 'a request that other parts still point to must exist: it was never deleted');
});

test('no personal data in the registry: no personal paths, e-mails or home shortcuts (or43 #5)', () => {
  const hits = [];
  const lines = registry.split('\n');
  for (const line of lines) {
    // The technical folders the registry legitimately names (~/.dsh, ~/.claude) are not the owner's personal paths.
    if (/`[A-Za-z]:[\\/]|[\\/]Users[\\/]|[\\/]home[\\/]/.test(line) || /~\/(?!\.(dsh|claude)\b)/.test(line)) hits.push(line.trim().slice(0, 120));
    if (/\S+@\S+\.\S+/.test(line)) hits.push(line.trim().slice(0, 120));
  }
  assert.deepEqual(hits, [], 'the registry holds the owner\'s words, never his paths, e-mails or home');
});

test('every request asks on a real date, never in the future (or43 #6)', () => {
  const bad = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const m of registry.matchAll(/^  - Asked: ([^\n]+)/gm)) {
    const dates = m[1].match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    if (!dates.length) { bad.push(`no date: ${m[1].slice(0, 60)}`); continue; }
    for (const d of dates) {
      const at = new Date(`${d}T00:00:00`);
      if (Number.isNaN(at.getTime())) bad.push(`bad date: ${d}`);
      else if (at > today) bad.push(`future date: ${d}`);
    }
  }
  assert.deepEqual(bad, []);
});
