import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { agentCallsOfLine, summarizeAgentCalls } from '../server/ai/agent-usage.mjs';

// The share of agent calls that went to the generic agent, the specialists and the kind-tagged ones (id158, or68), read
// from the conversations' own transcripts. The number to push down is the generic share.
//   node scripts/agent-usage.mjs [--days 7] [--project <folder name under ~/.claude/projects>]

function transcripts(dir, sinceMs) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents') out.push(...transcripts(path, sinceMs)); continue; }
    if (e.name.endsWith('.jsonl') && statSync(path).mtimeMs >= sinceMs) out.push(path);
  }
  return out;
}

async function main() {
  const { values } = parseArgs({ options: { days: { type: 'string' }, project: { type: 'string' } } });
  const { claudeDir } = await import('../server/sources/claude.mjs');
  const days = Number(values.days ?? 7);
  const base = join(claudeDir(), 'projects');
  const folders = values.project ? [values.project] : readdirSync(base);
  const calls = [];
  for (const folder of folders) {
    let files = [];
    try { files = transcripts(join(base, folder), Date.now() - days * 86_400_000); } catch { continue; }
    for (const file of files) for (const line of readFileSync(file, 'utf8').split('\n')) calls.push(...agentCallsOfLine(line));
  }
  const s = summarizeAgentCalls(calls);
  console.log(`Agent calls in the last ${days} days: ${s.total}`);
  console.log(`  generic agent: ${s.generic} (${s.genericPct} %)`);
  console.log(`  specialists (sm-*): ${s.specialist} (${s.specialistPct} %)`);
  console.log(`  with a kind tag: ${s.tagged} (${s.taggedPct} %)`);
  console.log(`  by type: ${JSON.stringify(s.byType)}`);
  console.log(`  by model: ${JSON.stringify(s.byModel)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exitCode = 1; });
