import { readFileSync } from 'node:fs';
import { KINDS } from './policy.mjs';

// The specialist agents' motor (id148, or55): the catalog (agents.json) loaded and checked once, the kind → role map,
// and the fixed role line the guard injects into the agent's brief — byte-identical per role, so the agents of a role
// pay the cache price after the first (id102). Pure data, no vendor names: the same role rules any engine, and the
// answer contract (contract.mjs) normalizes whatever that engine sends back.

const CATALOG = JSON.parse(readFileSync(new URL('./agents.json', import.meta.url), 'utf8'));

// The fixed tag the guard writes at the start of an agent's brief and the inner hook parses back.
export const ROLE_LINE_TAG = 'session-map-role';
export const ROLE_LINE_RE = new RegExp(`${ROLE_LINE_TAG}:\\s*([a-z-]+)`);

// -> a frozen catalog {agents, byKind}, or throws with the reason. Loaded once at import; a broken file stops the
// server at start, not in the middle of a task (the policy's own rule).
export function validateAgents(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('agents: not an object');
  const list = raw.agents;
  if (!Array.isArray(list) || !list.length) throw new Error('agents: no roles');
  const roles = [];
  const byKind = new Map();
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r.id !== 'string' || !/^[a-z-]+$/.test(r.id)) throw new Error('agents: a role has no id');
    if (seen.has(r.id)) throw new Error(`agents: role ${r.id} twice`);
    seen.add(r.id);
    if (!Array.isArray(r.kinds) || !r.kinds.length) throw new Error(`agents: role ${r.id} has no kinds`);
    for (const k of r.kinds) {
      if (!KINDS.includes(k)) throw new Error(`agents: role ${r.id} names an unknown kind ${k}`);
      if (byKind.has(k)) throw new Error(`agents: kind ${k} belongs to two roles`);
      byKind.set(k, r.id);
    }
    if (!Array.isArray(r.tools)) throw new Error(`agents: role ${r.id} has no tools list`);
    if (!Array.isArray(r.skills)) throw new Error(`agents: role ${r.id} has no skills list`);
    // The economy cap per role (id150, or57): the brief is input tokens on every agent; the roles whose job carries
    // context (the planner, the architect, the reviewer) get a bigger brief, the workers keep the lean one.
    if (!Number.isInteger(r.briefBytes) || r.briefBytes < 2048) throw new Error(`agents: role ${r.id} has no briefBytes (a whole number of bytes)`);
    // The senior training (id149, or56): the method is the role's fixed working steps, required in both languages.
    for (const w of ['label', 'deliver']) {
      if (typeof r.en?.[w] !== 'string' || !r.en[w].trim()) throw new Error(`agents: role ${r.id} has no en ${w}`);
      if (typeof r.pt?.[w] !== 'string' || !r.pt[w].trim()) throw new Error(`agents: role ${r.id} has no pt ${w}`);
    }
    for (const lang of ['en', 'pt']) {
      const method = r.method?.[lang];
      if (!Array.isArray(method) || !method.length) throw new Error(`agents: role ${r.id} has no ${lang} method`);
      if (method.some((s) => typeof s !== 'string' || !s.trim())) throw new Error(`agents: role ${r.id} has an empty ${lang} method step`);
    }
    roles.push(Object.freeze({
      id: r.id,
      kinds: Object.freeze([...r.kinds]),
      tools: Object.freeze([...r.tools]),
      skills: Object.freeze([...r.skills]),
      briefBytes: r.briefBytes,
      label: r.en.label,
      labelPt: r.pt.label,
      deliver: r.en.deliver,
      deliverPt: r.pt.deliver,
      method: Object.freeze([...r.method.en]),
      methodPt: Object.freeze([...r.method.pt]),
    }));
  }
  for (const k of KINDS) if (!byKind.has(k)) throw new Error(`agents: kind ${k} has no role`);
  return Object.freeze({ agents: Object.freeze(roles), byKind: Object.freeze(Object.fromEntries(byKind)) });
}

export const AGENTS = validateAgents(CATALOG);
export const ROLE_OF = Object.freeze(AGENTS.byKind);

// The role that takes a policy kind, or null (the catalog must cover every kind: validateAgents holds it).
export const roleOf = (kind) => {
  const id = ROLE_OF[kind];
  return id ? roleById(id) : null;
};

export const roleById = (id) => AGENTS.agents.find((r) => r.id === id) ?? null;

// The fixed line that rides the brief: the role, its tools, its senior method and its exit. Byte-identical per role,
// so the agents of a role pay the cache price after the first (id102). The skills are deliberately not listed here:
// the brief-naming rule (or32) must keep its word, and the skills gate reads the catalog itself.
export function roleLine(role) {
  const tools = role.tools.length ? ` tools: ${role.tools.join(', ')};` : ' tools: none;';
  const method = ` method: ${role.method.map((s, i) => `${i + 1}) ${s}`).join(' ')};`;
  return `${ROLE_LINE_TAG}: ${role.id} —${tools}${method} exit: ${role.deliver}.`;
}
