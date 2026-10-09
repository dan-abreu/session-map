import { join } from 'node:path';
import { readJsonFile, writeAtomic } from '../store.mjs';

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

// chatsOfCell: the chats of the same part as `{sessionId, startedAt, editedFiles}`.
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
