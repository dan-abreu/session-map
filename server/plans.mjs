// The plans engine (id133, or44): the superpowers writing-plans refinement as a motor. A plan is not prose to
// trust — it is an artifact this module validates mechanically: a title, tasks, and every task naming the files it
// touches and the test that proves it. The guard's door reads from here: a 3+ agent workflow passes only when it
// names a plan that exists AND parses.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLANS_DIR = 'docs/superpowers/plans';
// The path a workflow text names, or null: plans/<file>.md, with or without the docs/superpowers prefix.
const NAMED_RE = /(?:docs\/superpowers\/)?plans\/([A-Za-z0-9_.-]+\.md)/;

// One task block: from its "### " line to the next "### " or "## ". A task is valid when it names at least one
// file (a backticked path with an extension) and one test (a "test" word with a name or a run line).
function taskBlocks(text) {
  const blocks = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^###\s+/.test(line)) {
      blocks.push(line);
      inside = true;
    } else if (/^##\s+/.test(line)) {
      inside = false;
    } else if (inside && blocks.length) {
      blocks[blocks.length - 1] += `\n${line}`;
    }
  }
  return blocks;
}

export function parsePlan(text) {
  const errors = [];
  if (!/^#\s+\S/.test(text)) errors.push('sem título: a primeira linha precisa começar com "# " e o nome do plano');
  const tasks = taskBlocks(text).filter((b) => /^###\s+\S/.test(b));
  if (!tasks.length) errors.push('sem tarefas: cada tarefa começa com "### "');
  tasks.forEach((t, i) => {
    // A file is a backticked path with an extension whose name is not a test file itself (x.test.mjs proves nothing).
    const fileNamed = [...t.matchAll(/`([^`\n]+)\.([a-zA-Z0-9]{1,8})`/g)].some((m) => !/test/i.test(m[1]));
    const hasTest = /\btests?\b|`node --test[^`]*`|Test(?:s)?:\s*`/.test(t);
    if (!fileNamed) errors.push(`tarefa ${i + 1} sem arquivo: nomeie os arquivos que ela toca`);
    if (!hasTest) errors.push(`tarefa ${i + 1} sem prova: nomeie o teste que a comprova`);
  });
  return { ok: errors.length === 0, errors, tasks: tasks.length, title: (text.match(/^#\s+(.+)$/m) ?? [])[1] ?? null };
}

export function planNamedIn(text) {
  const m = NAMED_RE.exec(text ?? '');
  return m ? m[1] : null;
}

// The plan the workflow names, read and validated from the project's folder. ok only when the file exists and parses.
export function planOf(root, name, { read = readFileSync } = {}) {
  if (!name) return { ok: false, error: 'no-plan' };
  const path = join(root, PLANS_DIR, name);
  let text;
  try { text = String(read(path, 'utf8')); } catch { return { ok: false, error: 'plan-missing', path }; }
  const parsed = parsePlan(text);
  if (!parsed.ok) return { ok: false, error: 'plan-invalid', errors: parsed.errors, path };
  return { ok: true, path, title: parsed.title, tasks: parsed.tasks };
}
