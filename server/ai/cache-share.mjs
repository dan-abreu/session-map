// The first turn of an agent is where the shared start (its system prompt, tools and the project's rules) is either read from
// the prompt cache or written to it (sv17). Pure: it reads the text of one agent transcript and a list of first turns, and
// answers how much of what agents took in on their first turn was a cheap cache read.

const WARM_MS = 5 * 60_000; // the cache an agent can find lives five minutes from the last call that wrote or read it
const HIT_MIN = 5000; // a first turn that read at least this many tokens found the shared start

// → { model, at, read, write } of the first assistant turn in the transcript text of one agent, or null.
export function firstTurnOf(text) {
  for (const line of String(text ?? '').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const usage = entry?.message?.usage;
    if (!usage || entry.message?.role !== 'assistant') continue;
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at)) return null;
    return { model: String(entry.message.model ?? ''), at, read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0 };
  }
  return null;
}

const share = (read, write) => (read + write > 0 ? Math.round((100 * read) / (read + write)) : 0);

// turns: [{ model, at, read, write }] in any order. → the share read from the cache overall and by model, and how often an
// agent found the shared start when another agent of the same model had started in the five minutes before it (warm) and
// when none had (cold): a low cold share with a high warm share means the start is identical and the cache simply expired.
export function summarizeFirstTurns(turns) {
  const rows = (turns ?? []).filter((t) => t && t.model && !t.model.startsWith('<')).sort((a, b) => a.at - b.at);
  const byModel = {};
  const last = {};
  const warm = { agents: 0, hits: 0 };
  const cold = { agents: 0, hits: 0 };
  let read = 0;
  let write = 0;
  for (const r of rows) {
    read += r.read;
    write += r.write;
    const m = (byModel[r.model] ??= { agents: 0, read: 0, write: 0 });
    m.agents += 1;
    m.read += r.read;
    m.write += r.write;
    const bucket = last[r.model] != null && r.at - last[r.model] < WARM_MS ? warm : cold;
    bucket.agents += 1;
    if (r.read >= HIT_MIN) bucket.hits += 1;
    last[r.model] = r.at;
  }
  return {
    agents: rows.length,
    readSharePct: share(read, write),
    byModel: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { agents: v.agents, readSharePct: share(v.read, v.write) }])),
    warm: { ...warm, hitPct: warm.agents ? Math.round((100 * warm.hits) / warm.agents) : 0 },
    cold: { ...cold, hitPct: cold.agents ? Math.round((100 * cold.hits) / cold.agents) : 0 },
  };
}
