import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// "- [ ] task", "- [x] task", Kiro's "- [-] task" (in progress) and its optional "- [ ]* task". Only an x counts as done.
const TASK_RE = /^\s*[-*]\s+\[([ xX-])\]\*?\s+(.*\S)\s*$/;
const TODO_MAX = 8;

// Spec-driven tools that keep one markdown checklist per piece of work: where the folders live, and what to call the tool.
const TOOLS = [
  { tool: 'OpenSpec', dir: ['openspec', 'changes'], skip: ['archive'] },
  { tool: 'Spec Kit', dir: ['specs'] },
  { tool: 'Kiro', dir: ['.kiro', 'specs'] },
  { tool: 'Agent OS', dir: ['agent-os', 'specs'] },
];

function readTasks(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  let done = 0;
  let total = 0;
  const todo = [];
  for (const line of text.split(/\r?\n/)) {
    const m = TASK_RE.exec(line);
    if (!m) continue;
    total++;
    if (m[1] === 'x' || m[1] === 'X') done++;
    else if (todo.length < TODO_MAX) todo.push(m[2]);
  }
  return { done, total, todo };
}

export function readOpenSpec(root) {
  const out = [];
  for (const { tool, dir, skip = [] } of TOOLS) {
    const base = join(root, ...dir);
    let names;
    try {
      names = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !skip.includes(e.name)).map((e) => e.name);
    } catch {
      continue;
    }
    for (const change of names.sort()) {
      const found = readTasks(join(base, change, 'tasks.md'));
      if (found) out.push({ tool, change, ...found });
    }
  }
  return out;
}
