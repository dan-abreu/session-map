import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertSafeName, brainDir, plain, writeAtomic } from './cells.mjs';

export const NUCLEUS_MAX_BYTES = 4096;
const RECENT_MAX = 8;
const ITEM_MAX = 200;
const TITLE_MAX = 100;
const LINE_MAX = 160;
const SEED_TODO_MAX = 8;
const SEED_TERM_MIN = 3;

const SECTIONS = { State: 'state', Decided: 'decided', 'To do': 'todo', Recent: 'recent' };
const HEADING_RE = /^## (State|Decided|To do|Recent)\s*$/;
const RECENT_RE = /^(.*?) · (.*?) — (.*?)(?: <!--(.*?)-->)?$/;

export const emptyNucleus = () => ({ state: '', decided: [], todo: [], recent: [] });

// One line, no markers the markdown format uses: what is stored is exactly what is parsed back.
const oneLine = (s, max = ITEM_MAX) => String(s ?? '').replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const field = (s, max) => oneLine(s, max).replaceAll(' — ', ' - ');

export function renderNucleus(n) {
  const bullets = (items) => (items.length ? `${items.map((i) => `- ${i}`).join('\n')}\n` : '');
  const recent = n.recent.map((r) => `${r.date} · ${r.title} — ${r.line} <!--${r.sessionId}-->`);
  return `## State\n${n.state}\n\n## Decided\n${bullets(n.decided)}\n## To do\n${bullets(n.todo)}\n## Recent\n${bullets(recent)}`;
}

export function parseNucleus(markdown) {
  const out = emptyNucleus();
  const state = [];
  let section = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(raw);
    if (heading) {
      section = SECTIONS[heading[1]];
      continue;
    }
    const line = raw.trim();
    if (!section || !line) continue;
    if (section === 'state') state.push(line);
    else if (line.startsWith('- ')) {
      if (section !== 'recent') out[section].push(line.slice(2).trim());
      else {
        const m = RECENT_RE.exec(line.slice(2));
        if (m) out.recent.push({ sessionId: m[4] ?? '', date: m[1], title: m[2], line: m[3] });
      }
    }
  }
  out.state = state.join(' ');
  return out;
}

const bytesOf = (n) => Buffer.byteLength(renderNucleus(n));

export function mergeNucleus(nucleus, card, chat) {
  const doing = card?.doing ? oneLine(card.doing).replace(/^#+\s*/, '') : '';
  const fresh = (card?.decided ?? []).map((d) => oneLine(d)).filter(Boolean);
  const entry = {
    sessionId: oneLine(chat.sessionId),
    date: typeof chat.updatedAt === 'string' ? oneLine(chat.updatedAt).slice(0, 10) : '',
    title: field(chat.title, TITLE_MAX),
    line: field(card?.doing || chat.lastAssistantText || chat.lastPrompt, LINE_MAX),
  };
  const merged = {
    state: doing || nucleus.state,
    decided: [...new Set([...fresh, ...nucleus.decided])],
    todo: card?.todo ? card.todo.map((t) => oneLine(t)).filter(Boolean) : [...nucleus.todo],
    recent: [entry, ...nucleus.recent.filter((r) => r.sessionId !== entry.sessionId)].slice(0, RECENT_MAX),
  };
  while (bytesOf(merged) > NUCLEUS_MAX_BYTES && (merged.decided.length || merged.recent.length)) {
    (merged.decided.length >= merged.recent.length ? merged.decided : merged.recent).pop();
  }
  return merged;
}

const pathOf = (smDir, projectId, unitId) => join(brainDir(smDir, projectId), `${assertSafeName(unitId, 'unit id')}.md`);

export function readNucleus(smDir, projectId, unitId) {
  const file = pathOf(smDir, projectId, unitId);
  try {
    return parseNucleus(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export function writeNucleus(smDir, projectId, unitId, nucleus) {
  writeAtomic(pathOf(smDir, projectId, unitId), renderNucleus(nucleus));
}

// Starting point when a unit has no file yet: the open work OpenSpec and the roadmap already name after it.
export function seedNucleus(unit, { openspec = [], milestones = [] } = {}) {
  const terms = [unit.id, unit.name].map(plain).filter((t) => t.length >= SEED_TERM_MIN);
  const mine = (text) => terms.some((t) => plain(text).includes(t));
  const changes = openspec.filter((c) => mine(c.change));
  const open = changes.find((c) => c.done < c.total);
  return {
    ...emptyNucleus(),
    state: open ? oneLine(`${open.change}: ${open.done}/${open.total} tasks done`) : '',
    todo: [...changes.flatMap((c) => c.todo), ...milestones.filter((m) => m.status === 'open' && mine(m.title)).map((m) => m.title)]
      .map((t) => oneLine(t)).filter(Boolean).slice(0, SEED_TODO_MAX),
  };
}
