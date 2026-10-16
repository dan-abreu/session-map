// How the agents are really being called (id158, or68): the number the specialist work has to push down is the share of
// calls that went to the generic agent. Pure: transcript lines in, counts out; scripts/agent-usage.mjs reads the files.

const KIND_TAG_RE = /^\s*\[([a-z-]+)\]/;
const GENERIC = new Set(['general-purpose', 'claude', '']);
const SPECIALIST_PREFIX = 'sm-';

// The Agent/Task calls of one transcript line: [{type, description, model}], or [].
export function agentCallsOfLine(line) {
  if (!line.includes('"Agent"') && !line.includes('"Task"')) return [];
  let entry;
  try { entry = JSON.parse(line); } catch { return []; }
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b?.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task') && b.input && typeof b.input === 'object')
    .map((b) => ({ type: String(b.input.subagent_type ?? ''), description: String(b.input.description ?? ''), model: b.input.model ? String(b.input.model) : null }));
}

export function summarizeAgentCalls(calls) {
  const total = calls.length;
  const count = (pred) => calls.filter(pred).length;
  const share = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const generic = count((c) => GENERIC.has(c.type));
  const specialist = count((c) => c.type.startsWith(SPECIALIST_PREFIX));
  const tagged = count((c) => KIND_TAG_RE.test(c.description));
  const byType = {};
  const byModel = {};
  for (const c of calls) {
    byType[c.type || 'general-purpose'] = (byType[c.type || 'general-purpose'] ?? 0) + 1;
    byModel[c.model ?? 'inherit'] = (byModel[c.model ?? 'inherit'] ?? 0) + 1;
  }
  return { total, generic, genericPct: share(generic), specialist, specialistPct: share(specialist), tagged, taggedPct: share(tagged), byType, byModel };
}
