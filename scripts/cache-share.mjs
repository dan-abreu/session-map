import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { firstTurnOf, summarizeFirstTurns } from '../server/ai/cache-share.mjs';

// How much of what agents take in on their first turn is a cheap cache read (sv17), read from the agents' own transcripts
// (~/.claude/projects/<folder>/<session>/subagents/*.jsonl). It only reads.
//   node scripts/cache-share.mjs [--days 7] [--project <folder name under ~/.claude/projects>]

function agentFiles(dir, sinceMs, inside = false) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...agentFiles(path, sinceMs, inside || e.name === 'subagents'));
    else if (inside && e.name.endsWith('.jsonl') && statSync(path).mtimeMs >= sinceMs) out.push(path);
  }
  return out;
}

async function main() {
  const { values } = parseArgs({ options: { days: { type: 'string' }, project: { type: 'string' } } });
  const { claudeDir } = await import('../server/sources/claude.mjs');
  const days = Number(values.days ?? 7);
  const base = join(claudeDir(), 'projects');
  const turns = [];
  for (const folder of values.project ? [values.project] : readdirSync(base)) {
    let files = [];
    try { files = agentFiles(join(base, folder), Date.now() - days * 86_400_000); } catch { continue; }
    for (const file of files) {
      const turn = firstTurnOf(readFileSync(file, 'utf8'));
      if (turn) turns.push(turn);
    }
  }
  const s = summarizeFirstTurns(turns);
  console.log(`agents in the last ${days} days: ${s.agents}; first turn read from the cache: ${s.readSharePct}%`);
  for (const [model, m] of Object.entries(s.byModel)) console.log(`  ${model.padEnd(24)} ${String(m.agents).padStart(4)} agents  ${m.readSharePct}% read`);
  console.log(`another agent of the same model started in the 5 minutes before: ${s.warm.agents} agents, ${s.warm.hitPct}% found the shared start`);
  console.log(`none did (the cache had expired): ${s.cold.agents} agents, ${s.cold.hitPct}% found it`);
}

main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
