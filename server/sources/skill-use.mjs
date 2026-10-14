// Which skills a chat and its agents opened (mm52), counted exactly from the Skill tool calls; no AI.
// A skill opened in full costs its SKILL.md every time, so weight = size x times.
const SNOWBALL_AGENTS = 3;
const WEEK_MS = 7 * 24 * 3600 * 1000;

// own: the chat's calls [{name, ts}]; runs: [{agent, calls}] one per subagent; sizes: Map skill name -> SKILL.md bytes.
export function skillUseOf({ own = [], runs = [], sizes = new Map() }) {
  const sources = [{ agent: 'chat', calls: own }, ...runs].filter((r) => r.calls.length);
  const bySkill = new Map();
  const perAgent = sources.map((src) => {
    const counts = new Map();
    for (const c of src.calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    const skills = [...counts].map(([name, count]) => ({ name, count, bytes: count * (sizes.get(name) ?? 0) }));
    for (const s of skills) {
      const all = bySkill.get(s.name) ?? { name: s.name, count: 0, agents: 0, bytes: 0 };
      all.count += s.count;
      all.agents += 1;
      all.bytes += s.bytes;
      bySkill.set(s.name, all);
    }
    return { agent: src.agent, skills };
  });
  const skills = [...bySkill.values()].map((s) => ({ ...s, snowball: s.agents >= SNOWBALL_AGENTS })).sort((a, b) => b.bytes - a.bytes || b.count - a.count);
  return { skills, bytes: skills.reduce((n, s) => n + s.bytes, 0), perAgent };
}

// What each plugin's skills were opened for in the last week: Map plugin -> {count, bytes}.
export function weekByPlugin(calls, sizes, nowMs) {
  const out = new Map();
  for (const c of calls) {
    const at = Date.parse(c.ts);
    if (!c.name.includes(':') || !(at >= nowMs - WEEK_MS)) continue;
    const plugin = c.name.split(':')[0];
    const hit = out.get(plugin) ?? { count: 0, bytes: 0 };
    hit.count += 1;
    hit.bytes += sizes.get(c.name) ?? 0;
    out.set(plugin, hit);
  }
  return out;
}
