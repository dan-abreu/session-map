#!/usr/bin/env node
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { collect } from './collect.mjs';
import { claudeDir } from './sources/claude.mjs';
import { pickLang, translator } from './web/i18n.js';
import { archTree, listsDone } from './web/tree.js';
import { waitingEntries } from './web/views.js';

const WATCH_MS = 5000;
const SERVER_TIMEOUT_MS = 1500;
const TITLE_MAX = 100;
const CLEAR = '\x1b[2J\x1b[H';
const OPTIONS = {
  project: { type: 'string' }, watch: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
  port: { type: 'string', default: '4001' }, dir: { type: 'string' }, help: { type: 'boolean', default: false },
};

// The running server already holds the state (and the AI's work); without it, read the history here, with the AI off so a text command never spends money.
export async function loadState({ port, dir, smDir, fetchFn = fetch, collectFn = collect }) {
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(SERVER_TIMEOUT_MS) });
    if (res.ok) return { state: await res.json(), source: 'server' };
  } catch { /* no server on that port */ }
  return { state: await collectFn({ dir, smDir, ai: { bin: null } }), source: 'files' };
}

const pickProjects = (state, name) => {
  const wanted = name?.toLowerCase();
  return wanted ? state.projects.filter((p) => p.name.toLowerCase().includes(wanted)) : state.projects;
};

const trim = (text) => (text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text);

function partMark(project, node) {
  if (project.chats.some((c) => c.partId === node.partId && c.status === 'busy' && !c.archived)) return '●';
  if (node.counts.withUser) return '!';
  return node.counts.total && node.counts.done === node.counts.total ? '✓' : '○';
}

const countWords = (counts, t, ticks) => [
  ticks ? t('cli.done', { done: counts.done, total: counts.total }) : t('cli.open', { n: counts.total }),
  counts.withUser ? t('cli.withYou', { n: counts.withUser }) : null,
  counts.blocks ? t('cli.blocking', { n: counts.blocks }) : null,
];

function archLines(project, t, money) {
  const shown = project.chats.filter((c) => !c.archived);
  const root = archTree(project);
  if (!root.children.length) return [[t('cli.noArch'), shown.length ? t.count('label.chats', shown.length) : null].filter(Boolean).join(' · ')];
  const ticks = listsDone(root);
  const lines = [];
  for (const layer of root.children) {
    lines.push(`${layer.label}  ${countWords(layer.counts, t, ticks).filter(Boolean).join(' · ')}`);
    for (const part of layer.children) {
      const chats = shown.filter((c) => c.partId === part.partId);
      const cost = chats.reduce((sum, c) => sum + c.costUSD, 0);
      const meta = [...countWords(part.counts, t, ticks), chats.length ? t.count('label.chats', chats.length) : null, cost > 0 ? money(cost) : null].filter(Boolean).join(' · ');
      lines.push(`  ${partMark(project, part)} ${part.label}  ${meta}`);
      for (const w of project.workCells.filter((x) => x.partId === part.partId && x.status !== 'merged')) {
        const branchMark = w.clashWith.length ? '!' : w.status === 'active' ? '●' : '○';
        lines.push(`    ${branchMark} ${w.branch}  ${w.owner.name} · ${t.count('wc.commitsCount', w.ahead)}`);
      }
    }
  }
  const loose = shown.filter((c) => !c.partId).length;
  if (loose) lines.push(t.count('cli.loose', loose));
  return lines;
}

function waitingLines(state, t) {
  const entries = waitingEntries(state);
  if (!entries.length) return [t('waiting.none')];
  const many = state.projects.length > 1;
  return entries.map(({ project, chat, decision }) => {
    const partId = chat?.partId ?? decision?.partId;
    const part = partId && project.arch.parts.find((x) => x.id === partId);
    const where = [many ? project.name : null, part ? part.name : null].filter(Boolean).join(' · ');
    const reason = decision
      ? t(decision.kind === 'item' ? 'waiting.withYou' : `waiting.${decision.kind}`)
      : t(chat.waiting.strong ? 'waiting.question' : chat.waiting.items.length ? 'waiting.item' : 'waiting.ends');
    return `! ${reason}: ${trim(decision ? decision.text : chat.title)}${where ? `  (${where})` : ''}`;
  });
}

export function renderState(state, { lang = 'en', project } = {}) {
  const t = translator(lang);
  const money = (usd) => new Intl.NumberFormat(lang, { style: 'currency', currency: state.currency.code, maximumFractionDigits: 2 }).format(usd * state.currency.rate);
  if (!state.projects.length) return t('state.noProjects');
  const shown = pickProjects(state, project);
  if (!shown.length) return t('cli.noMatch', { name: project, list: state.projects.map((p) => p.name).join(', ') });
  const sum = (key) => money(shown.reduce((total, p) => total + p.cost[key], 0));
  const lines = [`session-map · ${t('cli.totals', { today: sum('today'), d7: sum('d7'), d30: sum('d30') })}`, t('cli.legend')];
  for (const p of shown) {
    lines.push('', `${p.name}${p.mainBranch ? ` (${p.mainBranch})` : ''}`);
    lines.push(...archLines(p, t, money));
  }
  lines.push('', t('waiting.title'), ...waitingLines({ ...state, projects: shown }, t));
  return lines.join('\n');
}

const langOf = (env) => pickLang(env.SESSION_MAP_LANG, String(env.LC_ALL || env.LC_MESSAGES || env.LANG || '').replace('_', '-'));

// deps replace the terminal, the server call, the timer and Ctrl+C in tests. Returns the exit code.
export async function run(argv, {
  out = process.stdout, err = process.stderr, env = process.env, signal,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), getState,
} = {}) {
  const lang = langOf(env);
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS }));
  } catch {
    const known = Object.keys(OPTIONS).map((o) => `--${o}`);
    err.write(`${translator(lang)('cli.badOption', { option: argv.find((a) => a.startsWith('-') && !known.includes(a.split('=')[0])) ?? argv.join(' ') })}\n`);
    return 2;
  }
  if (values.help) {
    out.write(`${translator(lang)('cli.help')}\n`);
    return 0;
  }
  const load = getState ?? (() => loadState({ port: values.port, dir: values.dir ?? claudeDir(), smDir: join(claudeDir(), 'session-map') }));
  do {
    const { state, source } = await load();
    if (values.project && !pickProjects(state, values.project).length) {
      err.write(`${renderState(state, { lang, project: values.project })}\n`);
      return 1;
    }
    if (values.json) {
      out.write(`${JSON.stringify({ ...state, projects: pickProjects(state, values.project) }, null, 2)}\n`);
      return 0;
    }
    const text = renderState(state, { lang, project: values.project });
    out.write(`${values.watch ? CLEAR : ''}${text}\n${source === 'files' ? `\n${translator(lang)('cli.noServer')}\n` : ''}`);
    if (values.watch) await wait(WATCH_MS);
  } while (values.watch && !signal?.aborted);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run(process.argv.slice(2));
