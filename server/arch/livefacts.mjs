// Gathers the facts the status robot (sb13) reads out of the state builder's pieces, and runs the robot: liveStatus on
// them, then the in-progress marks written into the plan. The pieces stay in live.mjs (pure) and livemark.mjs (the writer).
import { dirname, join } from 'node:path';
import { log } from '../log.mjs';
import { readAgentBriefs } from '../sources/claude.mjs';
import { liveStatus } from './live.mjs';
import { writeMarks } from './livemark.mjs';

const markMemo = new Map();
let writing = false;

// placed: the project's conversations as collect places them ({item, updatedAt, workCellId}); liveById: the running ones.
// Agents are read only for a running conversation: they stop with it.
export function liveOfProject({ arch, placed, liveById, titleOf, workCells, mainCommits, nowMs }) {
  const items = arch.parts.flatMap((p) => p.groups.flatMap((g) => g.items));
  const chats = placed.filter((x) => x.shown).map((x) => {
    const s = x.item.summary;
    return {
      sessionId: s.sessionId, label: titleOf(s), activeAt: x.updatedAt, startedAt: s.startedAt,
      card: x.item.card, branch: s.gitBranch, workCellId: x.workCellId, cwd: s.cwd,
    };
  });
  const agents = placed
    .filter((x) => liveById.has(x.item.summary.sessionId))
    .flatMap((x) => readAgentBriefs(join(dirname(x.item.ref.path), x.item.summary.sessionId)));
  return liveStatus({ items, chats, agents, workcells: workCells, mainCommits, now: nowMs });
}

// Writes the marks without making the page wait; an error is logged, never thrown. config.liveMarks: false turns it off.
export function markWorking({ root, arch, live, config, nowMs }) {
  if (config?.liveMarks === false || !live.size || writing) return;
  writing = true; // one pass at a time: the next collect, a few seconds later, finds the plan as this one left it
  writeMarks({ root, arch, live, now: nowMs, memo: markMemo })
    .then((done) => { if (done.length) log('info', 'status-marked', { items: done.map((d) => d.code) }); })
    .catch((err) => log('warn', 'status-mark-failed', { error: err.message }))
    .finally(() => { writing = false; });
}
