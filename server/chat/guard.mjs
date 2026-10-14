import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickSkills } from '../foundation/skills-focus.mjs';
import { KINDS, POLICY, hasKind, levelFor } from '../ai/policy.mjs';
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
// (the other fields as they were).
function agentLevel(ti) {
  const tag = TAG_RE.exec(String(ti.description ?? ''));
  if (!tag || !hasKind(tag[1])) return deny(NO_KIND);
  const up = Number(tag[2] ?? 0);
  if (up && !FAILED_RE.test(String(ti.prompt ?? ''))) return deny(NO_FAILED);
  const { model, effort } = levelFor(tag[1], up);
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `session-map policy: ${tag[1]}${up ? `^${up}` : ''} runs on ${model} at ${effort}`, updatedInput: { ...ti, model, effort } } };
}

export function guardAgent(input, { brief = readBrief } = {}) {
  const tool = String(input?.tool_name ?? '');
  const ti = input?.tool_input ?? {};
  if (AGENT_TOOLS.has(tool)) {
    return agentLevel(ti);
  }
  if (tool === 'Skill' && input?.agent_id) {
    const text = brief(input);
    const skill = fold(ti.skill ?? ti.name ?? '');
    if (text == null || !skill) return null;
    const said = fold(text);
    // Whole names only: a brief about "commitment" does not name the skill "commit".
    const names = (name) => new RegExp(`(?<![a-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_-])`).test(said);
    return names(skill) || names(skill.split(':').pop()) ? null : deny(NO_SKILL);
  }
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
  return null;
}

// input: the hook's JSON from Claude Code. → the answer to print, or null to say nothing (the step goes on to the
// permission check as before). A failed or slow snapshot never stops the step.
// mapEdit: hold map edits to the clerk only where its tools exist (a page chat); the --user copy runs everywhere else.
export async function guardStep(input, { snapshotOn = false, snapshot = takeSnapshot, waitMs = SNAPSHOT_WAIT_MS, brief, env, mapEdit = true } = {}) {
  if (AGENT_TOOLS.has(input?.tool_name) || input?.tool_name === 'Skill') return guardAgent(input, brief ? { brief } : {});
  if (input?.tool_name === 'Workflow') return guardWorkflow(input);
  if (MAP_EDIT_TOOLS.has(input?.tool_name)) return mapEdit ? guardMapEdit(input, env ? { env } : {}) : null;
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
// What one chat lists of skills and plugins (pc29). Probed 2026-10-13: --settings enabledPlugins turns a plugin off for
// that one session, and skillOverrides "name-only" shows a user skill by name without its description.
// skills/plugins: the project's lists (listSkills, listPlugins + month); part/text: where the chat opens and what it asked.
// → { skillOverrides, enabledPlugins }. Picked user/project skills "on", the other ones name-only (the index); a plugin
// goes off only when it is on, not session-map, unused by the project for 30 days (month.count === 0, known), not
// named in the request and holding none of the picked skills.
export function chatSkillSettings({ skills = [], plugins = [], part = null, text = '' } = {}) {
  const picked = pickSkills({ skills, part, text });
  const pickedNames = new Set(picked.map((k) => k.command));
  const skillOverrides = {};
  for (const k of skills) {
    if (!k?.name || (k.origin !== 'user' && k.origin !== 'project') || k.enabled === false) continue;
    skillOverrides[k.name] = pickedNames.has(k.command) ? 'on' : 'name-only';
  }
  const said = fold(`${text} ${part?.name ?? ''}`);
  const holding = new Set(picked.map((k) => k.plugin).filter(Boolean));
  const enabledPlugins = {};
  for (const p of plugins) {
    if (!p?.id || !p.name || p.enabled !== true || p.name === 'session-map' || holding.has(p.name)) continue;
    if (!Number.isInteger(p.month?.count) || p.month.count > 0) continue;
    if (new RegExp(`(?<![a-z0-9_-])${fold(p.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_-])`).test(said)) continue;
    enabledPlugins[p.id] = false;
  }
  return { skillOverrides, enabledPlugins };
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
        { matcher: 'Agent|Task|Skill|Edit|Write|MultiEdit|Workflow', hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] },
      ],
      Stop: [{ hooks: book('--stop') }],
      SessionStart: [{ matcher: 'compact', hooks: book('--compact') }],
    },
  });
}
