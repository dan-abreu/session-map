// Signs that explain themselves (watcher-and-alerts wa06-wa08): every sign the program raises is worded the same way,
// what it is · why it is happening · what to do now, with the button that does it. Pure: node:test and the page load it.
import { isPerson } from './tree.js';

const act = (id, primary = false) => ({ id, primary });

// kind → how it looks everywhere (tone and icon) and the reasons it can have, each with its buttons, main one first.
export const SIGNAL_CATALOG = {
  clash: {
    tone: 'clash', icon: 'branch',
    reasons: { mine: [act('resolve-ai', true), act('see-files'), act('ignore')], others: [act('resolve-ai', true), act('see-files'), act('ignore')] },
  },
  waiting: {
    tone: 'waiting', icon: 'chat',
    reasons: { question: [act('answer', true)], asks: [act('answer', true)], permission: [act('answer', true)], decision: [act('answer', true)], item: [act('open-item', true)] },
  },
  blocks: { tone: 'clash', icon: 'check', reasons: { you: [act('work-on', true)], claude: [act('work-on', true)] } },
  error: {
    tone: 'clash', icon: 'stop',
    reasons: { stopped: [act('continue', true)], failed: [act('retry', true), act('continue')], exited: [act('continue', true)], restart: [act('continue', true)] },
  },
  relation: { tone: 'rel', icon: 'links', reasons: { calm: [act('open-chats', true), act('put-on-flow'), act('ignore')], busy: [act('open-chats', true), act('put-on-flow'), act('ignore')] } },
  cost: { tone: 'waiting', icon: 'download', reasons: { estimate: [act('see-costs', true)], budget: [act('see-costs', true)] } },
};
export const SIGNAL_KINDS = Object.keys(SIGNAL_CATALOG);

// Situations the alerts already word (alert.what.*, alert.why.*, alert.do.*): the sign reuses those words.
const ALERT_WORDS = new Set(['waiting.question', 'waiting.asks', 'waiting.permission', 'error.stopped', 'error.failed', 'error.exited', 'error.restart']);

// sig: {kind, reason, vars} → {what, why, todo, actions: [{id, label, primary}], tone, icon}
export function signalWords(t, { kind, reason, vars = {} }) {
  const { tone, icon, reasons } = SIGNAL_CATALOG[kind];
  const key = (field) => (ALERT_WORDS.has(`${kind}.${reason}`) ? `alert.${field === 'todo' ? 'do' : field}.${reason}` : `sig.${kind}.${reason}.${field}`);
  return {
    kind, reason, tone, icon,
    what: t(key('what'), vars), why: t(key('why'), vars), todo: t(key('todo'), vars),
    actions: reasons[reason].map(({ id, primary }) => ({ id, primary, label: t(`sig.act.${id}`) })),
  };
}

// The same pair of branches, whichever way round.
export const clashKey = (d) => [...(d.workCellIds ?? [])].sort().join('|');

// A clash of the state: null from a server that does not send the branches (the page cannot word what it does not know).
export function clashSignal(d) {
  if (!Array.isArray(d.branches) || d.branches.length < 2) return null;
  const [a, b] = d.branches;
  const [ownerA, ownerB] = d.owners ?? ['', ''];
  return { kind: 'clash', reason: d.sameOwner ? 'mine' : 'others', vars: { a, b, ownerA, ownerB, files: (d.files ?? []).join(', ') }, key: clashKey(d) };
}

// {chat?, decision?, permission?}: what makes the person's turn. null when nothing waits.
export function waitingSignal({ chat, decision, permission }) {
  if (permission) return { kind: 'waiting', reason: 'permission', vars: { tool: permission.tool ?? '' } };
  if (decision) {
    if (decision.kind === 'clash') return null;
    if (decision.kind === 'item') return { kind: 'waiting', reason: 'item', vars: { title: decision.text ?? '', who: decision.who ?? '', code: decision.code ?? '' } };
    return { kind: 'waiting', reason: 'decision', vars: { title: decision.text ?? '' } };
  }
  const w = chat?.waiting;
  if (w?.strong) return { kind: 'waiting', reason: 'question', vars: {} };
  if (w?.weak || w?.items?.length) return { kind: 'waiting', reason: 'asks', vars: {} };
  return null;
}

export function blocksSignal(item, partName) {
  if (item.weight !== 'blocks' || item.status === 'done') return null;
  return { kind: 'blocks', reason: isPerson(item.who) ? 'you' : 'claude', vars: { title: item.title ?? '', who: item.who ?? '', part: partName ?? '', code: item.code ?? '' } };
}

export const errorSignal = (reason) => (reason in SIGNAL_CATALOG.error.reasons ? { kind: 'error', reason, vars: {} } : null);

// nameOf(partId), kindWord(reason.kind): the page's words for the parts and for each kind of tie.
export function relationSignal(link, { nameOf, bothBusy, kindWord }) {
  const kinds = [...new Set(link.reasons.map((r) => kindWord(r.kind)))].join(' · ');
  return { kind: 'relation', reason: bothBusy ? 'busy' : 'calm', vars: { nameA: nameOf(link.a), nameB: nameOf(link.b), kinds, n: link.reasons.length } };
}

// kind 'estimate': a branch or conversation past what it was expected to cost; 'budget': the AI helpers' monthly budget almost used.
export function costSignal(row, { money, kind }) {
  if (kind === 'estimate') {
    if (!row.estimateUSD || row.costUSD <= row.estimateUSD) return null;
    return { kind: 'cost', reason: 'estimate', vars: { cost: money(row.costUSD), estimate: money(row.estimateUSD), pct: Math.round((row.costUSD / row.estimateUSD - 1) * 100) } };
  }
  if (!row.monthlyUSD || row.usedUSD / row.monthlyUSD < 0.8) return null;
  return { kind: 'cost', reason: 'budget', vars: { used: money(row.usedUSD), monthly: money(row.monthlyUSD), pct: Math.round((row.usedUSD / row.monthlyUSD) * 100) } };
}
