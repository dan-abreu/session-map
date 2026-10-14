// The robot writes the "in progress" mark (sb13): when an item is being worked on and its plan line still says to do, that
// one line gets the mark the way the plan already writes it. It never ticks an item done.
import { renameSync, statSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseBold } from './parse.mjs';

export const RECENT_MS = 5000; // a chat may be writing the file right now
const PER_ITEM_MS = 3_600_000; // one mark per item per hour
const WORDS = { en: 'in progress', pt: 'em andamento' };
const OPEN_ITEM_RE = /^([-*+]\s+\[ \]\s+)(.*)$/;

export const progressWord = (lang) => WORDS[lang] ?? WORDS.en;

// The line with the mark in it, or null when it is not an open checklist line or already has a status mark.
// A bold prefix keeps its other tokens ("**important:**" becomes "**in progress · important:**"); a line with none
// gets "**in progress:** " in front of its text. A trailing \r (a Windows file) stays where it was.
export function markedLine(line, word) {
  const cr = line.endsWith('\r') ? '\r' : '';
  const m = OPEN_ITEM_RE.exec(cr ? line.slice(0, -1) : line);
  if (!m) return null;
  const rest = m[2];
  const lead = parseBold(rest);
  if (lead) {
    if (lead.tokens.some((t) => t.kind === 'status')) return null;
    return `${m[1]}${rest.replace(/^\*\*/, `**${word} · `)}${cr}`;
  }
  return `${m[1]}**${word}:** ${rest}${cr}`;
}

let swaps = 0; // a temp name of its own for every swap, so two passes never share one
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isBusy = (err) => err?.code === 'EBUSY' || err?.code === 'EPERM';

// Writes the text next to the file and swaps it in, so a reader never sees half a file. One retry when the swap is busy.
export async function replaceFile(file, text, { rename, retryMs }) {
  const tmp = `${file}.${process.pid}.${++swaps}.tmp`;
  try {
    writeFileSync(tmp, text);
    try {
      rename(tmp, file);
    } catch (err) {
      if (!isBusy(err)) throw err;
      await sleep(retryMs);
      rename(tmp, file);
    }
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
}

// arch: the state's architecture (lang, source, parts with their items' line numbers); live: Map code -> {live};
// memo: Map "file|code" -> when it was last written (kept by the caller between passes).
// -> the marks written: [{ code, file, line }]. A plan read from the main branch is never written; a file changed in the
// last 5 seconds is left for the next pass.
export async function writeMarks({ root, arch, live, now = Date.now(), memo = new Map(), rename = renameSync, retryMs = 50 }) {
  const written = [];
  if (!live?.size || (arch.source !== 'worktree' && !arch.parts.some((p) => p.local))) return written;
  const word = progressWord(arch.lang);
  for (const part of arch.parts) {
    if (arch.source !== 'worktree' && !part.local) continue;
    const file = isAbsolute(part.file) ? part.file : join(root, part.file);
    // The hour's limit is checked first, so a pass with nothing to write does not even open the file.
    const wanted = part.groups.flatMap((g) => g.items).filter((i) => {
      if (!i.code || i.status !== 'todo' || !i.line || live.get(i.code)?.live !== 'working') return false;
      const stamp = memo.get(`${file}|${i.code}`);
      return stamp === undefined || now - stamp >= PER_ITEM_MS;
    });
    if (!wanted.length) continue;
    try {
      const before = statSync(file);
      if (now - before.mtimeMs < RECENT_MS) continue;
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      const done = [];
      for (const item of wanted) {
        const at = item.line - 1;
        // The plan moved since it was read: only the line that still carries the item's code is touched.
        // The item's code closes its line (that is how the plan reads it); a line that only mentions it is not the item.
        if (typeof lines[at] !== 'string' || !lines[at].trimEnd().endsWith(`\`${item.code}\``)) continue;
        const next = markedLine(lines[at], word);
        if (next === null) continue;
        lines[at] = next;
        done.push({ code: item.code, file, line: item.line });
      }
      if (!done.length) continue;
      // Written once, and only if nobody wrote the file while it was being prepared (read again to know).
      if (readFileSync(file, 'utf8') !== text) continue;
      // Stamped before the swap: a file that stays locked is tried again in an hour, not on every pass.
      for (const d of done) memo.set(`${file}|${d.code}`, now);
      await replaceFile(file, lines.join('\n'), { rename, retryMs });
      written.push(...done);
    } catch {
      // A missing or busy plan file is not an error worth stopping the map for; the item waits for its hour.
    }
  }
  return written;
}
