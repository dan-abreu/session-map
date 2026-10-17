import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, POLICY, hasKind, levelFor } from '../ai/policy.mjs';
import { ROLE_LINE_RE, roleById, roleLine, roleOf } from '../ai/agents.mjs';
import { planNamedIn, planOf } from '../plans.mjs';
import { NO_FORCE_PUSH, commandOf, isDestructive, isForcePush, snapshot as takeSnapshot } from './safety.mjs';

// The guard of every page chat (pc16): a PreToolUse hook Claude Code runs before its own permission check, in every
// permission mode. The relay (hub.mjs ask()) only sees what auto mode leaves to it; this sees every shell step. It denies
// a force push, and for the Autonomous way snapshots before a destructive step. It denies and, for agents, sets the level (below); it never allows anything else.
export const GUARD_HOOK = fileURLToPath(new URL('./guard-hook.mjs', import.meta.url));
export const BOOK_HOOK = fileURLToPath(new URL('./book-hook.mjs', import.meta.url));
// Claude Code gives the hook this long (s); the snapshot is given up a while before, so the step is never held past it.
const HOOK_TIMEOUT_S = 60;
const SNAPSHOT_WAIT_MS = 45_000;

const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// The Claude models and efforts an agent may run today: the Agent tool is Claude Code until the other engines learn to
// edit files (id93, step 4). The Cérebro's choices ride on them; another engine's choice leaves the policy holding.
const CLAUDE_MODELS = new Set(['haiku', 'sonnet', 'opus', 'fable']);
const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Which Cérebro function each policy kind belongs to (functions.json), for the agent's ride-along choice.
const FUNCTION_ROWS = (() => {
  try {
    const rows = JSON.parse(readFileSync(new URL('../ai/functions.json', import.meta.url), 'utf8')).functions;
    const byKind = new Map();
    for (const f of rows) for (const k of f.kinds ?? []) if (!byKind.has(k)) byKind.set(k, f.id);
    return byKind;
  } catch {
    return new Map();
  }
})();

const readConfig = (dir = process.env.SESSION_MAP_DIR || join(homedir(), '.claude', 'session-map')) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
};

// The owner's per-function choices from config.json (or42): {} when the file is absent or unreadable — the policy holds.
export function readAgentFunctions(dir) {
  const config = readConfig(dir);
  return isObject(config?.ai?.others?.functions) ? config.ai.others.functions : {};
}

// The program is open (id154): no AI is stopped by a work rule. The guard still routes a tagged agent to the policy's
// model, still snapshots before a destructive step, and still refuses a force push and a money agent without the owner's
// OK (data and money, never work). The kind tag, the ladder, the role tools and skills, the read limits, the brief
// gates, the workflow doors and the map clerk are the strict mode: "guard": {"strict": true} in config.json.
export function readGuardOpen(dir) {
  return readConfig(dir)?.guard?.strict !== true;
}

// The switch "Cérebro obrigatório" of the Cérebro tab (id176), read at each step like the strict mode.
export function readObey(dir) {
  return readConfig(dir)?.ai?.others?.obey === true;
}

// The engine's hold on agents (or25, or32, or33): the AI only says what kind of task an agent does, by the tag that starts
// its description ("[code] fix the header"); the model and effort come from server/ai/policy.json, set here with
// updatedInput (proved on 2026-10-13: the subagent ran on the model the hook wrote, not the one the call asked for).
// "[code^1]" is one rung up the ladder and "[code^2]" two, each for a real failure, so the prompt must say "failed".
// An agent opens a skill only when its brief names it, since each agent that opens one reads it all again.
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const TAG_RE = /^\s*\[([a-z-]+)(?:\^([12]))?\]/;
const FAILED_RE = /\b(?:failed|falhou)\b/i;
const BRIEF_BYTES = 64 * 1024;
export const NO_KIND = `session-map: start the agent's description with its kind, e.g. [code], [review], [search]; the model and effort come from the policy. Kinds: ${KINDS.join(', ')}.`;
export const NO_FAILED = 'session-map: [kind^1] and [kind^2] climb the ladder for a real failure: say in the prompt what failed ("failed"), or use the plain kind tag.';
export const NO_SKILL = 'session-map: an agent opens a skill only when its brief names it; every agent that opens one reads it all again. Do the task with the brief you got.';
// Money belongs to the owner (orchestration.md's rule, or43): the agent gate holds the one-click confirmation. A money
// agent runs only when the brief says the owner approved; everything else is a recommendation, never an action.
export const NO_OWNER_OK = 'session-map: money belongs to the owner — recommend it and wait; only after the owner says yes, say "approved by owner" in the brief.';
const OWNER_OK_RE = /\b(approved by (the )?owner|owner approved|aprovado pelo dono|o dono aprovou|dono aprovou)\b/i;
// The specialist roles (id148, or55): every kind has one in the catalog (server/ai/agents.mjs). The guard writes the
// role's fixed line at the start of the brief and, inside the agent, holds its tools and skills. The same role rules
// any engine: the catalog is pure data with no vendor names.
export const NO_ROLE = (kind) => `session-map: kind [${kind}] has no role in the agents catalog — fix server/ai/agents.json.`;
export const NO_TOOL = (role, tool) => `session-map: the role ${role.id} does not carry the ${tool} tool (allowed: ${role.tools.join(', ') || 'none'}).`;
export const NO_SKILL_ROLE = (role, skill) => `session-map: the role ${role.id} does not carry the skill ${skill} (allowed: ${role.skills.join(', ') || 'none'}).`;
// The senior entry gates (id149, or56): a senior worker refuses a vague ticket. In the money gate's pattern, a role's
// brief must carry its senior ingredient — checked at the call, so the agent never starts without it. The reasons teach
// the conductor to write senior briefs.
export const NO_REPRO = 'session-map: a [debug] brief must name the defect — the failing test or the reproduction. The debugger reproduces first and fixes the cause, never the symptom.';
export const NO_TARGET = 'session-map: a [review] brief must name the delivery to check — the files or the diff.';
export const NO_PROOF = 'session-map: a [code] brief must name the proof — the tests or the suite that must pass.';
export const NO_CODE = 'session-map: a [docs] brief must name the code it documents — the files the text must follow.';
const ROLE_GATES = {
  debugger: { re: /\b(?:defect|bug|broken|failing|reproduce?|falha|defeito|quebra|quebrando|erro)\b/i, no: NO_REPRO },
  reviewer: { re: /`[^`\n]+`|\b(?:diff|delivery|entrega|revisar|reviewing)\b/i, no: NO_TARGET },
  coder: { re: /\b(?:tests?|su[ií]te|green|proof|prova)\b/i, no: NO_PROOF },
  writer: { re: /`[^`\n]+`|\b(?:c[oó]digo|code|arquivo|file|m[oó]dulo|module)\b/i, no: NO_CODE },
};

// One role's entry gates, in the order the guard holds them (id149/or56, id150/or57): the money OK (the kind gate:
// security and data work does not need it), the brief cap and the senior ingredient. The executor of the other
// engines (server/ai/agents-run.mjs, or61) applies the same gates before its run: the role is one, whatever the engine.
// open (id154): only the money OK holds; the brief gates are the strict mode.
export function entryGate(role, task, kind = '', { open = false } = {}) {
  const text = String(task ?? '');
  if (kind === 'money' && !OWNER_OK_RE.test(text)) return { ok: false, reason: NO_OWNER_OK };
  if (open) return { ok: true };
  const cap = role.briefBytes ?? BRIEF_CAP_BYTES;
  if (Buffer.byteLength(text) > cap) return { ok: false, reason: NO_BRIEF_LONG(cap) };
  const gate = ROLE_GATES[role.id];
  if (gate && !gate.re.test(text)) return { ok: false, reason: gate.no };
  return { ok: true };
}
// The economy as law (id150, or57): an agent that reads half the world before working is the expensive agent. The
// brief is capped at the call, the map and the rules are the conductor's reading (or23: agents do not re-read them),
// and a whole big file is denied inside an agent: read a slice (offset/limit) or the index, never the file whole.
export const BRIEF_CAP_BYTES = 8192;
export const WHOLE_FILE_BYTES = 64 * 1024;
export const NO_BRIEF_LONG = (cap) => `session-map: this brief is over ${cap} bytes — a brief names the exact files and lines, what to return and when to stop (or23). Split the work: several small agents beat one that reads everything.`;
export const NO_REREAD = 'session-map: an agent does not re-read the map or the rules — the conductor read them once and the brief carries the chapter (or23, or32). Work from the brief.';
export const NO_WHOLE_FILE = (path) => `session-map: ${path} is over ${Math.round(WHOLE_FILE_BYTES / 1024)} KB — an agent reads a slice (offset/limit) or the index, never the whole file (id101).`;
const DOCS_RE = /\/docs\/(?:arquitetura|architecture|standard)\//i;
const CLAUDE_RE = /(?:^|\/)CLAUDE\.md$/i;
// The tools the hook sees inside an agent; Read, Glob and Grep are read-only and never reach the hook, so they are
// always free. Agent, Task and Workflow are on no role: an agent executes its role, it does not run an orchestra.
const GATED_TOOLS = new Set(['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'Agent', 'Task', 'Workflow']);

// The role the brief names in its fixed first line (roleLine), or null: no line, no gate — the guard never stops work
// on its own failure (the same rule the skill gate keeps).
export function roleFromBrief(text) {
  const m = ROLE_LINE_RE.exec(String(text ?? ''));
  return m ? roleById(m[1]) : null;
}
// The superpowers doors (id133, or44): the refined method as engine. A 3+ agent workflow passes only when it names a
// plan that exists and parses (server/plans.mjs); a workflow with code work passes only with its review agent.
export const NO_PLAN = 'session-map: this workflow needs a plan first — write it in docs/superpowers/plans/ (the superpowers writing-plans format) and name the file in the script.';
export const NO_REVIEW = 'session-map: code work needs its review — add a [review] agent of another family to this workflow before it runs.';
const PLAN_MIN_AGENTS = 3;

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// The brief an agent was started with: the first person line of its own transcript, next to the chat's. null when it
// cannot be read, and then the skill goes through (the guard never stops work on its own failure).
export function readBrief(input, { read = readFileSync } = {}) {
  try {
    const path = join(dirname(String(input.transcript_path)), String(input.session_id), 'subagents', `agent-${input.agent_id}.jsonl`);
    for (const line of String(read(path, 'utf8')).slice(0, BRIEF_BYTES).split('\n')) {
      const entry = JSON.parse(line);
      if (entry?.type !== 'user') continue;
      const c = entry.message?.content;
      return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
    }
  } catch { /* unreadable: no brief to hold the agent to */ }
  return null;
}

// An Agent/Task call's input -> the answer: deny without a known kind tag, else allow with the policy's model and effort
// (the other fields as they were). The Cérebro's choice for that kind (or42) replaces the policy's when it is a Claude
// model; a choice for another engine cannot run an agent yet and leaves the policy holding.
// open (id154): an agent with no known tag runs as it was asked, and a climb without a failure runs on the plain rung.
function agentLevel(ti, { functions = {}, open = false } = {}) {
  const tag = TAG_RE.exec(String(ti.description ?? ''));
  if (!tag || !hasKind(tag[1])) return open ? null : deny(NO_KIND);
  let up = Number(tag[2] ?? 0);
  if (up && !FAILED_RE.test(String(ti.prompt ?? ''))) {
    if (!open) return deny(NO_FAILED);
    up = 0;
  }
  // The specialist role (id148, or55): every kind has one — the catalog's completeness is the motor's own test. The
  // role's fixed line rides the brief, byte-identical per role, so the agents of a role pay the cache price after the
  // first (id102); the inner hook reads it back and holds the role's tools and skills.
  const role = roleOf(tag[1]);
  if (!role && !open) return deny(NO_ROLE(tag[1]));
  // The entry gates (or56/or57), one function shared with the other engines' executor (or61). Money work acts only
  // after the owner's one-click confirmation (or43), open or not: the brief must say so.
  if (tag[1] === 'money' && !OWNER_OK_RE.test(String(ti.prompt ?? ''))) return deny(NO_OWNER_OK);
  const entry = role ? entryGate(role, ti.prompt, tag[1], { open }) : { ok: true };
  if (!entry.ok) return deny(entry.reason);
  const { model, effort } = levelFor(tag[1], up);
  let useModel = model;
  let useEffort = effort;
  const rowId = FUNCTION_ROWS.get(tag[1]);
  const c = rowId && isObject(functions[rowId]) ? functions[rowId] : null;
  if (c && (c.provider === undefined || c.provider === 'claude')) {
    if (typeof c.model === 'string' && CLAUDE_MODELS.has(c.model)) useModel = c.model;
    if (typeof c.effort === 'string' && CLAUDE_EFFORTS.has(c.effort)) useEffort = c.effort;
  }
  // The Cérebro's "agents" row (or40, id146): the owner's one knob for every work agent, riding on top of the kind row
  // ("the row of the kind they execute, plus the choices here").
  const all = isObject(functions.agents) ? functions.agents : null;
  if (all && (all.provider === undefined || all.provider === 'claude')) {
    if (typeof all.model === 'string' && CLAUDE_MODELS.has(all.model)) useModel = all.model;
    if (typeof all.effort === 'string' && CLAUDE_EFFORTS.has(all.effort)) useEffort = all.effort;
  }
  const prompt = role ? `${roleLine(role)}\n${String(ti.prompt ?? '')}` : String(ti.prompt ?? '');
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `session-map policy: ${tag[1]}${up ? `^${up}` : ''}${role ? ` (role ${role.id})` : ''} runs on ${useModel} at ${useEffort}`, updatedInput: { ...ti, model: useModel, effort: useEffort, prompt } } };
}

// Inside an agent, the role's tools hold (id148, or55): a tool the role does not carry is denied before it runs. No
// readable brief (no role line) means no gate: the guard fails open on its own failure.
export function guardAgentTool(input, { brief = readBrief } = {}) {
  const tool = String(input?.tool_name ?? '');
  if (!input?.agent_id || !GATED_TOOLS.has(tool)) return null;
  const role = roleFromBrief(brief(input));
  if (!role) return null;
  return role.tools.includes(tool) ? null : deny(NO_TOOL(role, tool));
}

// Inside an agent, the reads hold (id150, or57): the map and the rules are the conductor's reading — except for the
// architect and the planner, whose own work IS the map and the standards — and CLAUDE.md is every agent's inherited
// context, so re-reading it is pure waste. A whole big file is denied: a slice (offset/limit) or the index. A path
// that cannot be resolved or statted, or a brief with no readable role line, fails open: the guard never stops work
// on its own failure.
export function guardAgentRead(input, { stat = statSync, exists = existsSync, brief = readBrief } = {}) {
  if (String(input?.tool_name ?? '') !== 'Read' || !input?.agent_id) return null;
  const target = input?.tool_input?.file_path;
  if (typeof target !== 'string' || !target.trim()) return null;
  const path = resolve(typeof input.cwd === 'string' ? input.cwd : '.', target).replace(/\\/g, '/');
  if (DOCS_RE.test(path) || CLAUDE_RE.test(path)) {
    const role = roleFromBrief(brief(input));
    if (!role) return null;
    if (DOCS_RE.test(path) && (role.id === 'architect' || role.id === 'planner')) return null;
    return deny(NO_REREAD);
  }
  const ti = input.tool_input ?? {};
  if (ti.offset !== undefined || ti.limit !== undefined) return null;
  try {
    if (!exists(path) || stat(path).size <= WHOLE_FILE_BYTES) return null;
  } catch { /* unreadable: nothing to hold the read to */ return null; }
  return deny(NO_WHOLE_FILE(path));
}

export function guardAgent(input, { brief = readBrief, functions = {}, open = false } = {}) {
  const tool = String(input?.tool_name ?? '');
  const ti = input?.tool_input ?? {};
  if (AGENT_TOOLS.has(tool)) {
    return agentLevel(ti, { functions, open });
  }
  if (tool === 'Skill' && input?.agent_id && !open) {
    const text = brief(input);
    const skill = fold(ti.skill ?? ti.name ?? '');
    if (text == null || !skill) return null;
    const said = fold(text);
    // Whole names only: a brief about "commitment" does not name the skill "commit".
    const names = (name) => new RegExp(`(?<![a-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_-])`).test(said);
    if (!(names(skill) || names(skill.split(':').pop()))) return deny(NO_SKILL);
    // The role's list (id148, or55): the brief named it, and the role must carry it. The last name segment matches, so
    // "superpowers:test-driven-development" rides a role that carries "test-driven-development".
    const role = roleFromBrief(text);
    if (role) {
      const same = (allowed) => skill.split(':').pop() === fold(allowed).split(':').pop();
      if (!role.skills.some(same)) return deny(NO_SKILL_ROLE(role, String(ti.skill ?? ti.name ?? '')));
    }
    return null;
  }
  return null;
}

// The Cérebro obeyed (id176): with the owner's switch on, the talk writes no code itself. The code row's work goes to the AI
// the table names (run_other_ai), or to a [code] agent when the row is on Claude, and the program reviews it before it merges
// (runroute.mjs). Watched live on 2026-10-17: told the table, a talk on DeepSeek wrote 25 files itself, handed nothing over
// and had nothing reviewed. Inside an agent the work is the hand-over itself, so only the talk's own steps are held; a
// plan, a spec or any text file stays the talk's.
export const CODE_FILE_RE = /\.(?:[cm]?[jt]sx?|py|css|scss|sass|less|html?|vue|svelte|astro|go|rs|java|kts?|scala|cs|php|rb|sql|sh|ps1|psm1|prisma|graphql|gql|c|cc|cpp|h|hpp|swift|dart|lua|ipynb)$/i;
export const OBEY_ROWS = new Set(['code', 'screen', 'debug']);
// A row's choice with the general rule over it (brainpanel's effectiveFunctionsOf, without its imports: this runs per step).
function obeyRow(functions, id) {
  const all = isObject(functions?.agents) ? functions.agents : null;
  if (all && typeof all.provider === 'string' && all.provider !== 'auto') return all;
  return isObject(functions?.[id]) ? functions[id] : null;
}
const onOther = (row) => typeof row?.provider === 'string' && row.provider !== 'auto' && row.provider !== 'claude';
const whoOf = (row) => [row.provider, row.model, row.effort].filter((x) => typeof x === 'string' && x && x !== 'auto').join(' ');
export const NO_OWN_CODE = (row) => (onOther(row)
  ? `session-map: the owner's Cérebro is set to obey: code is written by ${whoOf(row)}, not by the talk. Hand it over with run_other_ai (kind code, provider ${row.provider}, a task that names its proof); the program reviews it before it merges.`
  : "session-map: the owner's Cérebro is set to obey: the talk writes no code itself. Hand it to an agent whose description starts with [code] (or [screen], [debug]); the delivery is reviewed before it is kept.");
export const NO_CLAUDE_AGENT = (kind, row) => `session-map: the owner's Cérebro is set to obey: [${kind}] work is done by ${whoOf(row)}, not by a Claude agent. Hand it over with run_other_ai (kind ${kind}, provider ${row.provider}).`;
// The shell ways of writing a code file, by their TARGET (reviewed 2026-10-17: a word like "tee" or "copy" next to any code
// path held a test run with a log or a grep for a word): a redirection, sed/perl -i, tee, the last path of cp/mv, curl -o,
// dd of=, touch, a formatter's --write/--fix, git checkout/restore of a path, git apply/patch, PowerShell's writers, a
// one-line script that writes a named file. Quoted text is words, not targets, except a script's own write call. A
// program that writes files when it runs cannot be seen from its command line: that stays a documented limit.
const SEGMENT_SPLIT_RE = /\|\||&&|;|\||\n/;
const QUOTED_RE = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const REDIRECT_RE = />>?\|?\s*([^\s\x22\x27;|&<>]+)/g;
const SCRIPT_WRITE_RE = /(?:writeFileSync|appendFileSync|writeFile|WriteAllText|WriteAllLines|AppendAllText|write_text|write_bytes)\(\s*['"\x60]([^'"\x60]+)['"\x60]|open\(\s*['"]([^'"]+)['"]\s*,\s*['"][wax]/g;
const HEREDOC_RE = /<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g;
const isCode = (p) => CODE_FILE_RE.test(String(p ?? '').replace(/^['"]|['"]$/g, ''));
const argsOf = (words) => words.filter((w) => !w.startsWith('-'));
function segmentTarget(words) {
  const [verb, ...rest] = words;
  const v = String(verb ?? '').toLowerCase();
  const plain = argsOf(rest);
  if ((v === 'sed' || v === 'perl') && rest.some((w) => /^-[a-zA-Z]*i/.test(w) || w === '--in-place')) return plain.find(isCode) ?? null;
  if (v === 'tee' || v === 'touch') return plain.find(isCode) ?? null;
  if (['cp', 'mv', 'copy', 'move', 'copy-item', 'move-item', 'install', 'rsync'].includes(v)) return isCode(plain.at(-1)) ? plain.at(-1) : null;
  if (['set-content', 'add-content', 'out-file', 'new-item', 'sc', 'ac'].includes(v)) {
    const at = rest.findIndex((w) => /^-(?:path|filepath|literalpath)$/i.test(w));
    const target = at >= 0 ? rest[at + 1] : plain[0];
    return isCode(target) ? target : null;
  }
  if (v === 'curl' || v === 'wget') {
    const at = rest.findIndex((w) => w === '-o' || w === '--output' || w === '-O' || w === '--output-document');
    return at >= 0 && isCode(rest[at + 1]) ? rest[at + 1] : null;
  }
  if (v === 'dd') return rest.map((w) => /^of=(.+)$/.exec(w)?.[1]).find(isCode) ?? null;
  if (rest.some((w) => w === '--write' || w === '--fix' || w === '-w' && /prettier|gofmt/.test(v))) return plain.find(isCode) ?? null;
  if (v === 'patch') return 'a patch';
  if (v === 'git') {
    const sub = plain[0];
    if (sub === 'apply' || sub === 'am') return 'a patch';
    if ((sub === 'checkout' || sub === 'restore') && rest.includes('--')) return rest.slice(rest.indexOf('--') + 1).find(isCode) ?? null;
  }
  return null;
}
export function shellWritesCode(command) {
  const raw = String(command ?? '').replace(HEREDOC_RE, (m) => m.split('\n')[0]);
  for (const m of raw.matchAll(SCRIPT_WRITE_RE)) if (isCode(m[1] ?? m[2])) return m[1] ?? m[2];
  // Quoted text becomes a placeholder: its words and arrows are not commands or targets.
  const text = raw.replace(QUOTED_RE, (q) => (isCode(q.slice(1, -1)) && !/[\s<>=]/.test(q.slice(1, -1)) ? q.slice(1, -1) : 'Q'));
  for (const m of text.matchAll(REDIRECT_RE)) if (isCode(m[1])) return m[1];
  for (const seg of text.split(SEGMENT_SPLIT_RE)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    while (words.length && /^(?:sudo|env|xargs|npx|command|&)$/.test(words[0])) words.shift();
    const hit = segmentTarget(words);
    if (hit) return hit;
  }
  return null;
}
export const NO_TAG_OBEY = 'session-map: the owner\'s Cérebro is set to obey: start the agent\'s description with its kind, e.g. [code], [review], [search], so the table can send the work to its AI.';
export function guardObey(input, { functions = {} } = {}) {
  if (input?.agent_id) return null;
  const tool = String(input?.tool_name ?? '');
  const ti = input?.tool_input ?? {};
  if (MAP_EDIT_TOOLS.has(tool) || tool === 'NotebookEdit') return isCode(ti.file_path ?? ti.notebook_path ?? ti.path) ? deny(NO_OWN_CODE(obeyRow(functions, 'code'))) : null;
  if (AGENT_TOOLS.has(tool)) {
    const tag = TAG_RE.exec(String(ti.description ?? ''));
    // An untagged agent could do the code row's work unseen: with a row on another AI, the kind must be said.
    if (!tag) return [...OBEY_ROWS].some((id) => onOther(obeyRow(functions, id))) ? deny(NO_TAG_OBEY) : null;
    const id = FUNCTION_ROWS.get(tag[1]);
    const row = id && OBEY_ROWS.has(id) ? obeyRow(functions, id) : null;
    return onOther(row) ? deny(NO_CLAUDE_AGENT(tag[1], row)) : null;
  }
  if (tool === 'Bash' || tool === 'PowerShell') return shellWritesCode(commandOf(tool, ti)) ? deny(NO_OWN_CODE(obeyRow(functions, 'code'))) : null;
  return null;
}

// The map is written by its clerk (am04): a page chat does not Edit, Write or MultiEdit a markdown file of the project's
// map folder (docs/arquitetura, docs/architecture or docs/arch, the folders arch/detect.mjs looks in); the map_* tools
// do it in a fixed order. Only page chats carry this hook, so the person's own edits and terminal chats are untouched.
// SESSION_MAP_CLERK=off is the way out. The folder must exist: the first map of a project is written by hand, after the OK.
export const NO_MAP_EDIT = 'session-map: the map is written by its clerk; use the map_* tools (map_add_item, map_start_item, map_finish_item...)';
const MAP_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const MAP_FILE_RE = /\/docs\/(?:arquitetura|architecture|arch)\/[^/]+\.md$/i;

export function guardMapEdit(input, { env = process.env, exists = existsSync } = {}) {
  if (!MAP_EDIT_TOOLS.has(input?.tool_name) || String(env.SESSION_MAP_CLERK ?? '').toLowerCase() === 'off') return null;
  const target = input?.tool_input?.file_path;
  if (typeof target !== 'string' || !target.trim()) return null;
  const path = resolve(typeof input.cwd === 'string' ? input.cwd : '.', target).replace(/\\/g, '/');
  return MAP_FILE_RE.test(path) && exists(dirname(path)) ? deny(NO_MAP_EDIT) : null;
}

// A Workflow script is checked before it runs (or34): too many literal agent( calls, or a call asking for fable, opus,
// effort max or xhigh without a sensitive kind tag ([architecture], [security], [money], [personal-data]) or "failed" in
// its label or prompt. Agents built in loops or by variables cannot be counted before the run: they are not guessed at.
const SENSITIVE_TAG_RE = /\[(?:architecture|security|money|personal-data)\]/i;
const HIGH_LEVEL_RE = /\bmodel\s*:\s*['"`](?:fable|opus)['"`]|\beffort\s*:\s*['"`](?:max|xhigh)['"`]/i;
export const tooManyAgents = (n, max) => `session-map: this workflow starts ${n} agents written out in the script; the policy allows ${max}. Split it or cut agents.`;
export const NO_HIGH_LEVEL = 'session-map: an agent() asks for opus, fable, or effort xhigh/max without a sensitive tag ([architecture], [security], [money], [personal-data]) in its label or prompt, or a real failure ("failed"). Use the kind tag and let the policy pick the level.';

// The text of the call that opens at text[open] === '(' up to its matching ')', skipping quoted text.
function callText(text, open) {
  let depth = 0;
  let quote = '';
  const braces = []; // a ${ } inside a template is code again; the quote to go back to is kept here
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      else if (quote === '`' && c === '$' && text[i + 1] === '{') { braces.push(0); quote = ''; i++; }
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' && braces.length) braces[braces.length - 1]++;
    else if (c === '}' && braces.length) { if (braces[braces.length - 1]-- === 0) { braces.pop(); quote = '`'; } }
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

export function guardWorkflow(input, { read = readFileSync, limit = POLICY.limits.agentsPerWorkflow } = {}) {
  const ti = input?.tool_input ?? {};
  let script = typeof ti.script === 'string' ? ti.script : '';
  if (!script && typeof ti.scriptPath === 'string') {
    try { script = String(read(resolve(typeof input.cwd === 'string' ? input.cwd : '.', ti.scriptPath), 'utf8')); } catch { /* unreadable: nothing to check */ }
  }
  const calls = [];
  for (const m of script.matchAll(/(?<![\w$.])agent\s*\(/g)) {
    if (/function\s+$/.test(script.slice(Math.max(0, m.index - 12), m.index))) continue;
    calls.push(callText(script, m.index + m[0].length - 1));
  }
  if (calls.length > limit) return deny(tooManyAgents(calls.length, limit));
  for (const call of calls) {
    if (HIGH_LEVEL_RE.test(call) && !SENSITIVE_TAG_RE.test(call) && !FAILED_RE.test(call)) return deny(NO_HIGH_LEVEL);
  }
  // The plan door: 3+ agents = a build, and a build starts from its plan (the superpowers writing-plans artifact).
  if (calls.length >= PLAN_MIN_AGENTS) {
    const root = typeof input.cwd === 'string' ? input.cwd : '.';
    const named = planNamedIn(script);
    const plan = planOf(root, named, { read });
    if (!plan.ok) return deny(`${NO_PLAN} (${plan.error})`);
  }
  // The review door: code work ships only with its reviewer of another family.
  const hasCode = calls.some((c) => /\[code(?:\^\d)?\]/.test(c));
  const hasReview = calls.some((c) => /\[review(?:\^\d)?\]/.test(c));
  if (hasCode && !hasReview) return deny(NO_REVIEW);
  return null;
}

// input: the hook's JSON from Claude Code. → the answer to print, or null to say nothing (the step goes on to the
// permission check as before). A failed or slow snapshot never stops the step.
// mapEdit: hold map edits to the clerk only where its tools exist (a page chat); the --user copy runs everywhere else.
// open (id154, the hook reads it from config.json with readGuardOpen): no work rule stops a step; the routing, the
// snapshot, the force push and the money OK stay.
export async function guardStep(input, { snapshotOn = false, snapshot = takeSnapshot, waitMs = SNAPSHOT_WAIT_MS, brief, env, mapEdit = true, functions = {}, open = false, obey = false } = {}) {
  // The Cérebro obeyed (id176): the owner's switch holds whether the rest of the guard is open or strict.
  if (obey) {
    const own = guardObey(input, { functions });
    if (own) return own;
  }
  if (!open) {
    // Inside an agent, the role's tools hold first (id148, or55): an inner Agent, Task or Workflow is on no role's list.
    if (input?.agent_id && GATED_TOOLS.has(input?.tool_name)) {
      const toolDeny = guardAgentTool(input, { ...(brief ? { brief } : {}) });
      if (toolDeny) return toolDeny;
    }
    const readDeny = guardAgentRead(input, { ...(brief ? { brief } : {}) });
    if (readDeny) return readDeny;
  }
  if (AGENT_TOOLS.has(input?.tool_name) || input?.tool_name === 'Skill') return guardAgent(input, { ...(brief ? { brief } : {}), functions, open });
  if (input?.tool_name === 'Workflow') return open ? null : guardWorkflow(input);
  if (MAP_EDIT_TOOLS.has(input?.tool_name)) return mapEdit && !open ? guardMapEdit(input, env ? { env } : {}) : null;
  const command = commandOf(String(input?.tool_name ?? ''), input?.tool_input);
  if (isForcePush(command)) return deny(NO_FORCE_PUSH);
  if (snapshotOn && isDestructive(command) && typeof input?.cwd === 'string') {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(resolve, waitMs); });
    await Promise.race([Promise.resolve().then(() => snapshot(input.cwd)).catch(() => null), late]);
    clearTimeout(timer);
  }
  return null;
}

// The value of claude's --settings: the guard on the shell steps and on agents and skills, and the book (pc28): each
// turn's end writes the chapters, and right after a summary the chapter index goes back in. Forward slashes: the hook
// line runs in a shell. No autoCompactWindow here (pc32): a page chat starts at about 39k tokens and restarts at 42k to
// 79k after each summary (system prompt, skill list, rules, map context, summary, re-attached files), so at the 100k
// window (the least Claude Code accepts) it summarized every two or three turns and Claude Code killed it as thrashing;
// measured 2026-10-14 in four chats, 33 summaries in one night. The summary runs near the model's whole window again.
// What one chat lists of skills and plugins (pc29, id140). Probed 2026-10-13: --settings enabledPlugins turns a plugin
// off for that one session, and skillOverrides "name-only" shows a user skill by name without its description.
// The owner's rule (id140): an on skill runs automatically in every chat — no call needed; an off skill never loads;
// a plugin goes off only on the owner's switch (rd09), never on the engine's guess.
// skillsOn: false is the airplane mode (id136): every skill name-only and every plugin off — the program's own plugin
// never falls, because it is the plane. skillsOff: the owner's per-skill switches (id139): a skill in the list stays
// name-only whatever the focus picks.
export function chatSkillSettings({ skills = [], plugins = [], part = null, text = '', skillsOn = true, skillsOff = [] } = {}) {
  const offNames = new Set((skillsOff ?? []).map(fold));
  if (!skillsOn) {
    const skillOverrides = {};
    for (const k of skills) {
      if (!k?.name || (k.origin !== 'user' && k.origin !== 'project') || k.enabled === false) continue;
      skillOverrides[k.name] = 'name-only';
    }
    const enabledPlugins = {};
    for (const p of plugins) {
      if (p?.id && p.name !== 'session-map') enabledPlugins[p.id] = false;
    }
    return { skillOverrides, enabledPlugins };
  }
  // The owner's rule (id140): an on skill runs automatically in every chat — no call needed; an off skill never
  // loads. The focus no longer filters: the switches are the whole control.
  const skillOverrides = {};
  for (const k of skills) {
    if (!k?.name || (k.origin !== 'user' && k.origin !== 'project') || k.enabled === false) continue;
    const off = offNames.has(fold(k.name)) || offNames.has(fold(k.command));
    skillOverrides[k.name] = off ? 'name-only' : 'on';
  }
  // Plugins: the owner's switch (rd09) is the only thing that turns one off; the engine no longer guesses.
  return { skillOverrides, enabledPlugins: {} };
}

export function guardSettings({ snapshot, focus = null }) {
  const slash = (p) => p.replace(/\\/g, '/');
  const node = `"${slash(process.execPath)}"`;
  const command = `${node} "${slash(GUARD_HOOK)}"${snapshot ? ' --snapshot' : ''}`;
  const book = (flag) => [{ type: 'command', command: `${node} "${slash(BOOK_HOOK)}" ${flag}`, timeout: HOOK_TIMEOUT_S }];
  return JSON.stringify({
    ...(focus && Object.keys(focus.skillOverrides ?? {}).length ? { skillOverrides: focus.skillOverrides } : {}),
    ...(focus && Object.keys(focus.enabledPlugins ?? {}).length ? { enabledPlugins: focus.enabledPlugins } : {}),
    hooks: {
      PreToolUse: [
        { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] },
        { matcher: 'Agent|Task|Skill|Edit|Write|MultiEdit|NotebookEdit|Workflow|Read', hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] },
      ],
      Stop: [{ hooks: book('--stop') }],
      SessionStart: [{ matcher: 'compact', hooks: book('--compact') }],
    },
  });
}
