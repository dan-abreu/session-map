import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_FORCE_PUSH, commandOf, isDestructive, isForcePush, snapshot as takeSnapshot } from './safety.mjs';

// The guard of every page chat (pc16): a PreToolUse hook Claude Code runs before its own permission check, in every
// permission mode. The relay (hub.mjs ask()) only sees what auto mode leaves to it; this sees every shell step. It denies
// a force push, and for the Autonomous way snapshots before a destructive step. It never allows anything.
export const GUARD_HOOK = fileURLToPath(new URL('./guard-hook.mjs', import.meta.url));
export const BOOK_HOOK = fileURLToPath(new URL('./book-hook.mjs', import.meta.url));
// Claude Code gives the hook this long (s); the snapshot is given up a while before, so the step is never held past it.
const HOOK_TIMEOUT_S = 60;
const SNAPSHOT_WAIT_MS = 45_000;

const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// The engine's hold on agents (or25, or32): the conductor's prompt advises a cheap model and a narrow brief; this makes
// it hold. An agent with no model inherits the chat's (often Opus at high); Opus, Fable, xhigh and max need a reason in
// the call (security, money, personal data, a hard design call, or what a cheaper one failed); an agent opens a skill
// only when its brief names it, since each agent that opens one reads it all again.
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const DEAR_MODEL = /opus|fable/i;
const DEAR_EFFORT = new Set(['xhigh', 'max']);
const DEAR_REASON = /segur|security|auth|senha|password|secret|credencia|dinheiro|money|pagamento|payment|cobranc|billing|financ|lgpd|dado pessoal|dados pessoais|personal data|privacy|privacidade|arquitet|architect|producao|production|falhou|failed|critic/;
const REASON_CHARS = 600;
const BRIEF_BYTES = 64 * 1024;
export const NO_MODEL = 'session-map: give this agent a model (haiku for search and reading, sonnet for code, tests, text and review, opus only with a reason). Without one it inherits the chat\'s own, often Opus at high.';
export const NO_REASON = 'session-map: Opus, Fable, xhigh and max are for security, money, personal data, a hard architecture call or work a cheaper model already failed. Pick a cheaper model, or say that reason in the description.';
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

export function guardAgent(input, { brief = readBrief } = {}) {
  const tool = String(input?.tool_name ?? '');
  const ti = input?.tool_input ?? {};
  if (AGENT_TOOLS.has(tool)) {
    const model = String(ti.model ?? '').trim();
    if (!model) return deny(NO_MODEL);
    const dear = DEAR_MODEL.test(model) || DEAR_EFFORT.has(String(ti.effort ?? '').toLowerCase());
    if (dear && !DEAR_REASON.test(fold(`${ti.description ?? ''} ${String(ti.prompt ?? '').slice(0, REASON_CHARS)}`))) return deny(NO_REASON);
    return null;
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

// input: the hook's JSON from Claude Code. → the answer to print, or null to say nothing (the step goes on to the
// permission check as before). A failed or slow snapshot never stops the step.
export async function guardStep(input, { snapshotOn = false, snapshot = takeSnapshot, waitMs = SNAPSHOT_WAIT_MS, brief } = {}) {
  if (AGENT_TOOLS.has(input?.tool_name) || input?.tool_name === 'Skill') return guardAgent(input, brief ? { brief } : {});
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

// The value of claude's --settings: the guard on the shell steps and on agents and skills, and the book (pc28): Claude
// Code's own summary runs at BOOK_WINDOW instead of near the model's whole window, each turn's end writes the chapters,
// and right after a summary the chapter index goes back in. Forward slashes: the hook line runs in a shell.
export const BOOK_WINDOW = 100_000; // the least Claude Code accepts (measured 2026-10-13: 135k of context became 31k)
export function guardSettings({ snapshot }) {
  const slash = (p) => p.replace(/\\/g, '/');
  const node = `"${slash(process.execPath)}"`;
  const command = `${node} "${slash(GUARD_HOOK)}"${snapshot ? ' --snapshot' : ''}`;
  const book = (flag) => [{ type: 'command', command: `${node} "${slash(BOOK_HOOK)}" ${flag}`, timeout: HOOK_TIMEOUT_S }];
  return JSON.stringify({
    autoCompactWindow: BOOK_WINDOW,
    hooks: {
      PreToolUse: [
        { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] },
        { matcher: 'Agent|Task|Skill', hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] },
      ],
      Stop: [{ hooks: book('--stop') }],
      SessionStart: [{ matcher: 'compact', hooks: book('--compact') }],
    },
  });
}
