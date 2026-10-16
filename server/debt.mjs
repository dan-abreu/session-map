// The debt ledger (id134, or45): ponytail's own motor, inside the system. Walks the program's code and harvests every
// deferred comment — `// shortcut:` and `// ponytail:` — with its file, line and text, so "later" never becomes
// "never". The route serves it; the level "O programa" draws it. No AI reads a skill to know what was deferred.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEBT_RE = /\/\/\s*(?:shortcut|ponytail):\s*(.+)$/;

export function harvestDebts(root, { read = readFileSync } = {}) {
  const base = root.endsWith('/') || root.endsWith('\\') ? root : `${root}\\`;
  const walk = (dir) => {
    let out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const rel = p.slice(base.length).replace(/\\/g, '/');
        if (['node_modules', '.git', 'vendor', 'i18n-fd', 'css', 'img', '.dev', 'disciplines'].some((x) => rel === x || rel.startsWith(`${x}/`))) continue;
        out = out.concat(walk(p));
      } else if (/\.(mjs|js|ts|py|rs|go|rb|php|java|html|css)$/.test(e.name)) {
        out.push(p);
      }
    }
    return out;
  };
  const debts = [];
  for (const file of walk(root)) {
    const rel = file.slice(base.length).replace(/\\/g, '/');
    let text;
    try { text = String(read(file, 'utf8')); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      const m = DEBT_RE.exec(line);
      if (m) debts.push({ file: rel, line: i + 1, text: m[1].trim() });
    });
  }
  return debts;
}

export function debtLedger({ root = fileURLToPath(new URL('..', import.meta.url)) } = {}) {
  return { generatedAt: new Date().toISOString(), debts: harvestDebts(root) };
}

// The route's cache: the harvest walks the whole repository, and the page polls — one walk a minute is the right
// economy (the ponytail review of 2026-10-15: the same answer for every poll costs nothing to repeat).
const CACHE_MS = 60_000;
let cachedAt = 0;
let cachedDebts = null;
export function debtLedgerCached({ root = fileURLToPath(new URL('..', import.meta.url)) } = {}) {
  const now = Date.now();
  if (cachedDebts && now - cachedAt < CACHE_MS) return cachedDebts;
  cachedDebts = debtLedger({ root });
  cachedAt = now;
  return cachedDebts;
}
