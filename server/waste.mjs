// Waste signals for the Costs tab (or24): the counts that showed the week of 2026-10-13 was wasteful, kept every day
// from the statement's priced lines, no AI. Pure: lines in, figures and one-line warnings out.
//
// A line is one reply: { ts, model, effort, sessionId, project, agentId (null for the chat itself), runId (a workflow
// run, else null), skills [names opened], input, cacheWrite5m, cacheWrite1h, cacheRead, cost: { total } }.

const DAY = 86_400_000;
const HEAVY = /opus|fable/i; // the two expensive families
export const MAX_RUN_AGENTS = 10;
export const MAX_CONTEXT = 200_000;
export const SNOWBALL_AGENTS = 3;
const TOP = 5;

export function medianOf(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const usdOf = (r) => r.cost?.total ?? 0;
const contextOf = (r) => (r.input ?? 0) + (r.cacheWrite5m ?? 0) + (r.cacheWrite1h ?? 0) + (r.cacheRead ?? 0);
const modelLabel = (m) => String(m ?? 'unknown').replace(/^claude-/, '');

// The figures of one set of lines.
function figures(lines, titleOf) {
  const usd = lines.reduce((n, r) => n + usdOf(r), 0);
  const mainLines = lines.filter((r) => !r.agentId);
  const agentLines = lines.filter((r) => r.agentId);

  // Agents: each one counted once, by the model and effort it started with.
  const agents = new Map();
  for (const r of [...agentLines].sort((a, b) => a.ts - b.ts)) {
    const a = agents.get(r.agentId) ?? { id: r.agentId, session: r.sessionId, run: r.runId, model: modelLabel(r.model), effort: r.effort ?? r.agentEffort ?? '?', usd: 0, first: r, skills: [] };
    a.usd += usdOf(r);
    a.skills.push(...(r.skills ?? []));
    agents.set(r.agentId, a);
  }
  const list = [...agents.values()];
  const agentsUsd = list.reduce((n, a) => n + a.usd, 0);
  const byKey = new Map();
  for (const a of list) {
    const k = `${a.model}|${a.effort}`;
    const g = byKey.get(k) ?? { model: a.model, effort: a.effort, count: 0, usd: 0 };
    g.count++; g.usd += a.usd;
    byKey.set(k, g);
  }
  const heavy = list.filter((a) => HEAVY.test(a.model));
  const heavyUsd = heavy.reduce((n, a) => n + a.usd, 0);

  // Workflow runs.
  const runs = new Map();
  for (const a of list) {
    if (!a.run) continue;
    const g = runs.get(a.run) ?? { runId: a.run, chat: a.session, agents: 0, usd: 0 };
    g.agents++; g.usd += a.usd;
    runs.set(a.run, g);
  }
  const runList = [...runs.values()].sort((a, b) => b.agents - a.agents || b.usd - a.usd);

  // The main chats.
  const chats = new Map();
  for (const r of mainLines) {
    const c = chats.get(r.sessionId) ?? { sessionId: r.sessionId, title: titleOf?.(r.sessionId) ?? null, replies: 0, maxContext: 0, usd: 0 };
    c.replies++; c.usd += usdOf(r); c.maxContext = Math.max(c.maxContext, contextOf(r));
    chats.set(r.sessionId, c);
  }
  const chatList = [...chats.values()].sort((a, b) => b.maxContext - a.maxContext || b.usd - a.usd);
  const chatUsd = mainLines.reduce((n, r) => n + usdOf(r), 0);

  // Skills opened by agents, and the ones several agents of one chat opened again and again.
  const opened = list.reduce((n, a) => n + a.skills.length, 0);
  const perChatSkill = new Map();
  for (const a of list) {
    for (const name of new Set(a.skills)) {
      const k = `${a.session}\u0000${name}`;
      const g = perChatSkill.get(k) ?? { chat: a.session, name, agents: 0 };
      g.agents++;
      perChatSkill.set(k, g);
    }
  }
  const snowball = [...perChatSkill.values()].filter((s) => s.agents >= SNOWBALL_AGENTS).sort((a, b) => b.agents - a.agents)
    .map((s) => ({ ...s, title: titleOf?.(s.chat) ?? null }));

  // The first turn of each agent: what it had to take in, and whether that was a cache read or a cache write.
  const firsts = list.map((a) => a.first);
  const read = firsts.reduce((n, r) => n + (r.cacheRead ?? 0), 0);
  const written = firsts.reduce((n, r) => n + (r.cacheWrite5m ?? 0) + (r.cacheWrite1h ?? 0), 0);
  const sizes = firsts.map(contextOf);

  return {
    usd: r6(usd),
    replies: lines.length,
    agents: {
      count: list.length, usd: r6(agentsUsd), share: usd > 0 ? r6(agentsUsd / usd) : 0,
      byModel: [...byKey.values()].sort((a, b) => b.count - a.count).map((g) => ({ ...g, usd: r6(g.usd), share: list.length ? r6(g.count / list.length) : 0 })),
      heavyCount: heavy.length, heavyShare: list.length ? r6(heavy.length / list.length) : 0,
      heavyUsd: r6(heavyUsd), heavyUsdShare: usd > 0 ? r6(heavyUsd / usd) : 0,
    },
    runs: { count: runList.length, over10: runList.filter((g) => g.agents > MAX_RUN_AGENTS).length, top: runList.slice(0, Math.max(TOP, runList.filter((g) => g.agents > MAX_RUN_AGENTS).length)).map((g) => ({ ...g, usd: r6(g.usd) })) },
    chats: { count: chatList.length, usd: r6(chatUsd), share: usd > 0 ? r6(chatUsd / usd) : 0, longest: chatList.slice(0, Math.max(TOP, chatList.filter((c) => c.maxContext > MAX_CONTEXT).length)).map((c) => ({ ...c, usd: r6(c.usd) })) },
    skills: { opened, perAgent: list.length ? r6(opened / list.length) : 0, snowball },
    firstTurn: { agents: sizes.length, median: medianOf(sizes), max: Math.max(0, ...sizes), readTokens: read, writeTokens: written, readShare: read + written > 0 ? r6(read / (read + written)) : 0 },
  };
}

// Lines of a period (default: the 7 days before now) -> the figures in total and per project, and the warnings.
export function wasteSignals(lines, { from, to, now = Date.now(), titleOf = null } = {}) {
  const end = to ?? now;
  const start = from ?? end - 7 * DAY;
  const inside = lines.filter((r) => r.ts >= start && r.ts < end);
  const projects = new Map();
  for (const r of inside) {
    const k = r.project ?? '';
    if (!projects.has(k)) projects.set(k, []);
    projects.get(k).push(r);
  }
  const total = figures(inside, titleOf);
  const byProject = Object.fromEntries([...projects].map(([k, v]) => [k, figures(v, titleOf)]));

  // Warnings: each is one fact the page writes in a plain line; each names the chat or the run.
  const warnings = [];
  if (total.agents.count && total.agents.heavyCount * 3 > total.agents.count) {
    warnings.push({ kind: 'heavy', agents: total.agents.count, heavy: total.agents.heavyCount, share: total.agents.heavyShare });
  }
  for (const [project, f] of Object.entries(byProject)) {
    for (const g of f.runs.top) if (g.agents > MAX_RUN_AGENTS) warnings.push({ kind: 'run', run: g.runId, chat: g.chat, title: titleOf?.(g.chat) ?? null, project, agents: g.agents, usd: g.usd });
    for (const c of f.chats.longest) if (c.maxContext > MAX_CONTEXT) warnings.push({ kind: 'context', chat: c.sessionId, title: c.title, project, tokens: c.maxContext, usd: c.usd });
    for (const s of f.skills.snowball) warnings.push({ kind: 'skill', chat: s.chat, title: s.title, project, name: s.name, agents: s.agents });
  }
  return { from: start, to: end, total, byProject, warnings };
}
