import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$/;
const TODO_MAX = 8;

export function readOpenSpec(root) {
  const base = join(root, 'openspec', 'changes');
  let names;
  try {
    names = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'archive').map((e) => e.name);
  } catch {
    return [];
  }
  const out = [];
  for (const change of names.sort()) {
    const file = join(base, change, 'tasks.md');
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    let done = 0;
    let total = 0;
    const todo = [];
    for (const line of text.split(/\r?\n/)) {
      const m = TASK_RE.exec(line);
      if (!m) continue;
      total++;
      if (m[1] === ' ') {
        if (todo.length < TODO_MAX) todo.push(m[2]);
      } else done++;
    }
    out.push({ change, done, total, todo });
  }
  return out;
}
