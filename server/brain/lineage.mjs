import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UNSORTED, plain, readJsonFile, relativeFiles, unitsTouchedBy, writeAtomic } from './cells.mjs';

const MAX_WEIGHT = 4;
const SPEC_TERM_MIN = 4;

const lineagePath = (smDir) => join(smDir, 'lineage.json');

export function readLineage(smDir) {
  const stored = readJsonFile(lineagePath(smDir), {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

// Written by the "continue here" action: the new chat (child) descends from the chat it was built from.
export function recordLineage(smDir, childId, parentId) {
  if (childId === parentId) throw new Error('a chat cannot descend from itself');
  writeAtomic(lineagePath(smDir), `${JSON.stringify({ ...readLineage(smDir), [childId]: parentId }, null, 2)}\n`);
}

// chatsOfCell: the chats of the same unit as `{sessionId, startedAt, editedFiles}`.
export function parentOf(sessionId, lineage, chatsOfCell) {
  const recorded = lineage?.[sessionId];
  if (typeof recorded === 'string' && recorded && recorded !== sessionId) return recorded;
  const chat = chatsOfCell.find((c) => c.sessionId === sessionId);
  if (!chat) return null;
  const mine = new Set(chat.editedFiles ?? []);
  const born = Date.parse(chat.startedAt);
  let best = null;
  for (const other of chatsOfCell) {
    const at = Date.parse(other.startedAt);
    if (other.sessionId === sessionId || !(at < born)) continue;
    if (!(other.editedFiles ?? []).some((f) => mine.has(f))) continue;
    if (!best || at > best.at) best = { id: other.sessionId, at };
  }
  return best?.id ?? null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A unit's spec.md that names another unit (by id or name, as a whole word) is a link between them.
export function specRefsOf(root, units) {
  const targets = units
    .filter((u) => u.id !== UNSORTED)
    .map((u) => ({ id: u.id, terms: [u.id, u.name].map(plain).filter((t) => t.length >= SPEC_TERM_MIN) }));
  const refs = [];
  for (const from of units) {
    const file = join(root, 'openspec', 'specs', from.id, 'spec.md');
    let text;
    let since;
    try {
      text = plain(readFileSync(file, 'utf8'));
      since = statSync(file).mtime.toISOString();
    } catch { continue; }
    for (const to of targets) {
      if (to.id === from.id) continue;
      if (to.terms.some((t) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, 'u').test(text))) refs.push({ from: from.id, to: to.id, since });
    }
  }
  return refs;
}

// Chats need `editedFiles` besides the Chat fields; specRefs come from specRefsOf.
export function linkUnits(chats, units, workCells, specRefs, { root } = {}) {
  const known = new Set(units.map((u) => u.id).filter((id) => id !== UNSORTED));
  const nameOf = new Map(units.map((u) => [u.id, u.name]));
  const links = new Map();
  const add = (x, y, since, reason) => {
    if (x === y || !known.has(x) || !known.has(y)) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const link = links.get(`${a}\n${b}`) ?? { a, b, since, reasons: [] };
    if (Date.parse(since) < Date.parse(link.since)) link.since = since;
    link.reasons.push(reason);
    links.set(`${a}\n${b}`, link);
  };
  const pairs = (ids, since, reason) => {
    for (const x of ids) for (const y of ids) if (x < y) add(x, y, since, reason);
  };

  const chatById = new Map(chats.map((c) => [c.sessionId, c]));
  for (const chat of chats) {
    const files = relativeFiles(chat.editedFiles ?? [], [root, chat.cwd]);
    pairs(unitsTouchedBy(files, units), chat.startedAt, { kind: 'shared-chat', text: chat.title, sessionId: chat.sessionId });
    const parent = chatById.get(chat.parentId);
    if (parent) add(chat.unitId, parent.unitId, chat.startedAt, { kind: 'lineage', text: chat.title, sessionId: chat.sessionId });
  }
  for (const cell of workCells) {
    const ids = new Set((cell.chatIds ?? []).map((id) => chatById.get(id)?.unitId));
    pairs([...ids].filter((id) => known.has(id)), cell.bornAt, { kind: 'shared-branch', text: cell.branch });
  }
  for (const ref of specRefs) {
    add(ref.from, ref.to, ref.since, { kind: 'spec-ref', text: `${nameOf.get(ref.from)} → ${nameOf.get(ref.to)}` });
  }

  return [...links.values()]
    .map((l) => ({ ...l, weight: Math.min(l.reasons.length, MAX_WEIGHT) }))
    .sort((p, q) => q.weight - p.weight || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
}
