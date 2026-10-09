import { readFileSync } from 'node:fs';

const HEADING_RE = /^#{2,3}\s+(.*\S)\s*$/;
const DONE_RE = /✅|\[[xX]\]/;
const OPEN_RE = /⬜|\[ \]/;
const CODE_RE = /^[A-Za-z]{1,3}\d+[a-z]?$/;

function cleanCell(s) {
  return s.replace(/\[[ xX]\]|✅|⬜/g, '').replace(/^\s*[-*]\s+/, '').replace(/\*\*|`/g, '').trim();
}

function parseLine(line) {
  if (line.trimStart().startsWith('|')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const idCell = cells.find((c) => /^\d+/.test(c));
    // A bare code such as "D3" names the row; the question sits in the next cell.
    const codeCell = idCell ? undefined : cells.find((c) => CODE_RE.test(c));
    const titleCell = cells.find((c) => c && c !== idCell && c !== codeCell && !/^[\s:-]+$/.test(c) && !/^(✅|⬜)/.test(c) && !/^\d+$/.test(c));
    const title = titleCell ? cleanCell(titleCell) : '';
    return { id: idCell?.match(/^\d+/)?.[0] ?? null, title: codeCell && title ? `${codeCell}: ${title}` : title };
  }
  const text = cleanCell(line);
  const m = /^(\d+)[.):]?\s+(.*)$/.exec(text);
  return m ? { id: m[1], title: m[2] } : { id: null, title: text };
}

export function readRoadmap(file, { decisions } = {}) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { milestones: [], decisions: [] };
  }
  const milestones = [];
  const pending = [];
  let branch = '';
  let inDecisions = false;
  for (const line of text.split(/\r?\n/)) {
    const h = HEADING_RE.exec(line);
    if (h) {
      branch = h[1];
      inDecisions = !!decisions && branch.toLowerCase().includes(decisions.heading.toLowerCase());
      continue;
    }
    if (inDecisions) {
      if (line.trim() && !/^\|[\s:|-]+\|?$/.test(line.trim()) && line.toLowerCase().includes(decisions.pendingWhen.toLowerCase())) {
        pending.push({ kind: 'decision', text: parseLine(line).title || cleanCell(line), projectId: '', sessionId: null });
      }
      continue;
    }
    const done = DONE_RE.test(line);
    if (!done && !OPEN_RE.test(line)) continue;
    const { id, title } = parseLine(line);
    if (!title) continue;
    milestones.push({ id: id ?? `m${milestones.length + 1}`, title, branch, status: done ? 'done' : 'open', workCellId: null });
  }
  return { milestones, decisions: pending };
}
