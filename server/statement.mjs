#!/usr/bin/env node
// The spend statement (sb08, from id98): every Claude reply on this PC, one line each, priced at Anthropic's official list
// prices. It reads the Claude Code transcripts (~/.claude/projects/**/*.jsonl) the same way the rest of the plugin
// does, keeps one row per reply (message id + request id, so a reply copied into a resumed chat counts once), and
// writes a CSV for Excel, a JSON and a page in Portuguese.
//
//   node server/statement.mjs [--days 30] [--since YYYY-MM-DD] [--out <folder>]
//
// What it can and cannot say: the tokens are measured (Anthropic wrote them into each reply); the dollars are
// list price × tokens. On a Max plan, replies inside the plan's limits are not charged one by one; only what runs
// past the limit is charged as "extra usage", at these prices. Which replies fell past the limit is not written on
// this PC, so the page shows Anthropic's own counter next to the list-price total and never mixes them.

import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadPrices, priceKeyFor } from './cost.mjs';

const PER_MILLION = 1_000_000;
const WEB_SEARCH_USD = 10 / 1000; // $10 per 1,000 searches
const LONG_PROMPT = 100_000; // Claude Haiku 5.5 pays its higher prices above this prompt length

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const words = (text) => (typeof text === 'string' ? text.split(/\s+/).filter(Boolean).length : 0);
const oneLine = (s, max) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// One reply's usage, read field by field from message.usage.
export function usageOf(usage = {}) {
  const split = usage.cache_creation ?? {};
  const hasSplit = Number.isFinite(split.ephemeral_5m_input_tokens) || Number.isFinite(split.ephemeral_1h_input_tokens);
  return {
    input: num(usage.input_tokens),
    cacheWrite5m: hasSplit ? num(split.ephemeral_5m_input_tokens) : num(usage.cache_creation_input_tokens),
    cacheWrite1h: hasSplit ? num(split.ephemeral_1h_input_tokens) : 0,
    cacheRead: num(usage.cache_read_input_tokens),
    output: num(usage.output_tokens),
    thinking: num(usage.output_tokens_details?.thinking_tokens),
    webSearch: num(usage.server_tool_use?.web_search_requests),
  };
}

// Dollars of one reply, split the way the bill splits them. Fast mode doubles every rate on the models that have it;
// US-only inference adds 10 %; Claude Haiku 5.5 switches to its "over100k" prices for a prompt over 100,000 tokens.
export function priceReply(reply, prices) {
  const key = priceKeyFor(reply.model ?? '', prices);
  if (!key) return null;
  let p = prices[key];
  const prompt = reply.input + reply.cacheWrite5m + reply.cacheWrite1h + reply.cacheRead;
  if (p.over100k && prompt > LONG_PROMPT) p = { ...p, ...p.over100k };
  const mult = (reply.speed === 'fast' ? 2 : 1) * (reply.geo === 'us' ? 1.1 : 1);
  const usd = (tokens, rate) => (tokens * (rate ?? 0) * mult) / PER_MILLION;
  const out = {
    input: usd(reply.input, p.input),
    cacheWrite: usd(reply.cacheWrite5m, p.cacheWrite5m) + usd(reply.cacheWrite1h, p.cacheWrite1h),
    cacheRead: usd(reply.cacheRead, p.cacheRead),
    output: usd(reply.output, p.output),
    webSearch: reply.webSearch * WEB_SEARCH_USD,
  };
  out.total = out.input + out.cacheWrite + out.cacheRead + out.output + out.webSearch;
  return out;
}

// What a tool call was about, in a few words: the file, the command's description, the pattern…
export function toolLabel(block) {
  const i = block?.input ?? {};
  const name = String(block?.name ?? 'tool').replace(/^mcp__/, '');
  const target = i.file_path ?? i.notebook_path ?? i.description ?? i.command ?? i.pattern ?? i.url ?? i.query ?? i.skill ?? i.prompt ?? '';
  const short = typeof target === 'string' ? target.replace(/^.*[\\/](?=[^\\/]+[\\/][^\\/]+$)/, '…/') : '';
  return short ? `${name} ${oneLine(short, 70)}` : name;
}

// A chat opened by session-map starts with its context block; the person's own words come after its last line.
export function ownWords(text) {
  if (!text.startsWith('Context from session-map')) return text;
  const marker = 'run /session-map:board.';
  const at = text.lastIndexOf(marker);
  return at >= 0 ? text.slice(at + marker.length).trim() || text : text;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b?.type === 'text' ? b.text ?? '' : '')).join(' ');
}

// Who answered, from where the file sits: the chat itself, a helper agent, or an agent of a workflow.
export function placeOf(projectsDir, file) {
  const parts = relative(projectsDir, file).split(sep);
  const folder = parts[0];
  if (parts.length === 2) return { folder, sessionId: basename(file, '.jsonl'), agent: null };
  const sessionId = parts[1];
  let meta = {};
  try { meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* no meta */ }
  const wf = parts.find((p) => p.startsWith('wf_'));
  const kind = wf ? `agente de workflow${meta.workflowPhase ? ` (${meta.workflowPhase})` : ''}` : 'agente';
  const what = meta.description ? oneLine(meta.description, 70) : basename(file, '.jsonl');
  return { folder, sessionId, agent: `${kind}: ${what}`, agentModel: meta.model ?? null, agentEffort: meta.effort ?? null };
}

// Every reply of one transcript file, in order, with what it read just before (the tool results that went into its
// input) and what it did (the tools it called).
export async function readTranscript(file, { since = 0 } = {}) {
  const replies = [];
  const byKey = new Map();
  const toolById = new Map();
  let pendingRead = { words: 0, items: [] };
  let pendingAsk = null;
  const titles = {};
  let cwd = null;

  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const raw of lines) {
    if (!raw) continue;
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
    if (o.type === 'custom-title' && o.customTitle) titles.custom = o.customTitle;
    if (o.type === 'ai-title' && o.aiTitle) titles.ai = o.aiTitle;
    if (o.type === 'summary' && o.summary && !titles.summary) titles.summary = o.summary;

    if (o.type === 'user' && o.message) {
      const c = o.message.content;
      if (Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) {
        for (const b of c) {
          if (b?.type !== 'tool_result') continue;
          const n = words(resultText(b.content));
          pendingRead.words += n;
          pendingRead.items.push(`${toolById.get(b.tool_use_id) ?? 'resultado'} (${n.toLocaleString('pt-BR')} palavras)`);
        }
      } else if (!o.isMeta) {
        const text = ownWords(typeof c === 'string' ? c : resultText(c));
        if (text && !text.trimStart().startsWith('<')) {
          if (!titles.first) titles.first = oneLine(text, 90);
          pendingAsk = { words: words(text), text: oneLine(text, 120) };
        }
      }
      continue;
    }

    if (o.type !== 'assistant' || !o.message?.usage) continue;
    const msg = o.message;
    // The message id alone names a reply (a line may lack the request id); a line without one falls back to its own ids.
    const key = msg.id ?? `${o.uuid}|${o.requestId ?? ''}`;
    const tools = (Array.isArray(msg.content) ? msg.content : []).filter((b) => b?.type === 'tool_use');
    for (const t of tools) toolById.set(t.id, toolLabel(t));
    const texts = (Array.isArray(msg.content) ? msg.content : []).filter((b) => b?.type === 'text').map((b) => b.text ?? '').join(' ');

    let r = byKey.get(key);
    if (!r) {
      const ts = Date.parse(o.timestamp);
      r = {
        key, ts, model: msg.model ?? 'unknown', speed: msg.usage.speed ?? null, geo: msg.usage.inference_geo ?? null,
        effort: o.effort ?? null, sessionId: o.sessionId ?? null, ...usageOf(msg.usage),
        did: [], wroteWords: 0, readWords: pendingRead.words, readWhat: pendingRead.items, ask: pendingAsk, keep: ts >= since,
      };
      byKey.set(key, r);
      replies.push(r);
      pendingRead = { words: 0, items: [] };
      pendingAsk = null;
    } else {
      // The same reply split over several lines: the first one is written mid-reply (few output tokens, no speed yet),
      // the last one carries the final counts, so keep the largest count of each field and fill what was missing.
      mergeUsage(r, usageOf(msg.usage));
      r.speed = r.speed ?? msg.usage.speed ?? null;
      r.geo = r.geo ?? msg.usage.inference_geo ?? null;
      if (r.model === 'unknown' && msg.model) r.model = msg.model;
    }
    r.did.push(...tools.map(toolLabel));
    r.wroteWords += words(texts);
  }
  return { replies: replies.filter((r) => r.keep && r.model !== '<synthetic>'), titles, cwd };
}

const USAGE_FIELDS = ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output', 'thinking', 'webSearch'];
function mergeUsage(r, u) {
  for (const k of USAGE_FIELDS) r[k] = Math.max(r[k] ?? 0, u[k] ?? 0);
}

function* walk(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

function projectName(folder, cwd) {
  if (/session-map-ai-runner/.test(folder)) return 'session-map (ajudantes automáticos)';
  if (cwd) return basename(cwd.replace(/[\\/]+$/, '')) || cwd;
  return folder;
}

const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hourOf = (ms) => `${dayOf(ms)} ${String(new Date(ms).getHours()).padStart(2, '0')}h`;
const timeOf = (ms) => new Date(ms).toTimeString().slice(0, 8);

function bucket() {
  return { replies: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0, webSearch: 0,
    usdInput: 0, usdCacheWrite: 0, usdCacheRead: 0, usdOutput: 0, usdWebSearch: 0, usd: 0, first: Infinity, last: 0 };
}
function addTo(b, r) {
  b.replies++;
  b.input += r.input; b.cacheWrite += r.cacheWrite5m + r.cacheWrite1h; b.cacheRead += r.cacheRead;
  b.output += r.output; b.thinking += r.thinking; b.webSearch += r.webSearch;
  if (r.cost) {
    b.usdInput += r.cost.input; b.usdCacheWrite += r.cost.cacheWrite; b.usdCacheRead += r.cost.cacheRead;
    b.usdOutput += r.cost.output; b.usdWebSearch += r.cost.webSearch; b.usd += r.cost.total;
  }
  b.first = Math.min(b.first, r.ts); b.last = Math.max(b.last, r.ts);
}

// Reads every transcript touched since `since` and returns the priced rows and the sums.
export async function buildStatement({ projectsDir = join(homedir(), '.claude', 'projects'), since, prices = loadPrices() } = {}) {
  const seen = new Map();
  const rows = [];
  const sessions = new Map();
  const files = [...walk(projectsDir)].filter((f) => {
    try { return statSync(f).mtimeMs >= since; } catch { return false; }
  });
  // Chats before their agents, so a chat's own title and project are known when its agents are read.
  files.sort((a, b) => a.split(sep).length - b.split(sep).length || a.localeCompare(b));

  for (const file of files) {
    const place = placeOf(projectsDir, file);
    const { replies, titles, cwd } = await readTranscript(file, { since });
    const s = sessions.get(place.sessionId) ?? { sessionId: place.sessionId, folder: place.folder, cwd: null, title: null };
    if (!place.agent) {
      s.cwd = s.cwd ?? cwd;
      s.title = titles.custom ?? titles.ai ?? titles.summary ?? titles.first ?? s.title;
    }
    s.cwd = s.cwd ?? cwd;
    sessions.set(place.sessionId, s);
    for (const r of replies) {
      const before = seen.get(r.key);
      if (before) {
        // A reply copied into another file (a resumed chat) counts once, with the most complete counts of the two.
        mergeUsage(before, r);
        before.speed = before.speed ?? r.speed;
        before.geo = before.geo ?? r.geo;
        before.cost = priceReply(before, prices);
        continue;
      }
      seen.set(r.key, r);
      r.sessionId = place.sessionId;
      r.who = place.agent ?? 'conversa principal';
      r.cost = priceReply(r, prices);
      rows.push(r);
    }
  }
  for (const s of sessions.values()) {
    s.project = projectName(s.folder, s.cwd);
    s.title = s.title ?? '(sem título)';
  }
  rows.sort((a, b) => a.ts - b.ts);

  const total = bucket();
  const byDay = new Map(); const byHour = new Map(); const byChat = new Map(); const byModel = new Map(); const byProject = new Map();
  const unpriced = new Map();
  const get = (map, k, extra = {}) => { if (!map.has(k)) map.set(k, { ...bucket(), ...extra }); return map.get(k); };
  for (const r of rows) {
    const s = sessions.get(r.sessionId);
    if (!r.cost) unpriced.set(r.model, (unpriced.get(r.model) ?? 0) + 1);
    addTo(total, r);
    addTo(get(byDay, dayOf(r.ts)), r);
    addTo(get(byHour, hourOf(r.ts)), r);
    addTo(get(byModel, r.model), r);
    addTo(get(byProject, s.project), r);
    const chat = get(byChat, r.sessionId, { sessionId: r.sessionId, title: s.title, project: s.project, agents: new Map() });
    addTo(chat, r);
    addTo(get(chat.agents, r.who), r);
  }
  return { rows, sessions, total, byDay, byHour, byChat, byModel, byProject, unpriced };
}

// ---- writing -------------------------------------------------------------------------------------------------

const brNum = (n, digits = 0) => n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const usd = (n) => `US$ ${brNum(n, 2)}`;
const usd4 = (n) => `US$ ${brNum(n, 4)}`;
const csvCell = (v) => {
  const s = typeof v === 'number' ? brNum(v, Number.isInteger(v) ? 0 : 6).replace(/\./g, '') : String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, lines) => `﻿${[header, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function detailCsv(st) {
  const dayTotals = new Map();
  const lines = st.rows.map((r) => {
    const s = st.sessions.get(r.sessionId);
    const c = r.cost ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, webSearch: 0, total: 0 };
    const day = dayOf(r.ts);
    dayTotals.set(day, (dayTotals.get(day) ?? 0) + c.total);
    return [day, timeOf(r.ts), s.project, s.title, r.sessionId, r.who, r.model, r.effort ?? '', r.speed ?? 'standard',
      r.input, r.cacheWrite5m + r.cacheWrite1h, r.cacheRead, r.output, r.thinking, r.webSearch,
      c.input, c.cacheWrite, c.cacheRead, c.output, c.webSearch, c.total, dayTotals.get(day),
      r.ask ? `pedido de ${r.ask.words} palavras: ${r.ask.text}` : '',
      r.readWords ? `${r.readWords} palavras: ${r.readWhat.join(' | ')}` : '',
      r.did.join(' | '), r.wroteWords, r.cost ? '' : 'modelo sem preço conhecido'];
  });
  return csv(['data', 'hora', 'projeto', 'conversa', 'id da conversa', 'quem respondeu', 'modelo', 'esforço', 'velocidade',
    'tokens de entrada novos', 'tokens gravados no cache', 'tokens lidos do cache', 'tokens de saída', 'dos quais pensamento', 'buscas na web',
    'US$ entrada', 'US$ gravação de cache', 'US$ leitura de cache', 'US$ saída', 'US$ buscas', 'US$ total da resposta', 'US$ acumulado no dia',
    'o que você pediu (se foi agora)', 'o que leu antes de responder', 'o que fez nesta resposta', 'palavras que escreveu', 'observação'], lines);
}

export function chatsCsv(st) {
  const lines = [];
  for (const c of [...st.byChat.values()].sort((a, b) => b.usd - a.usd)) {
    for (const [who, a] of [...c.agents].sort((x, y) => y[1].usd - x[1].usd)) {
      lines.push([c.project, c.title, c.sessionId, who, dayOf(a.first), timeOf(a.first), dayOf(a.last), timeOf(a.last), a.replies,
        a.input + a.cacheWrite + a.cacheRead, a.output, a.usdInput + a.usdCacheWrite + a.usdCacheRead, a.usdOutput, a.usdWebSearch, a.usd, c.usd]);
    }
  }
  return csv(['projeto', 'conversa', 'id da conversa', 'quem', 'início (dia)', 'início (hora)', 'fim (dia)', 'fim (hora)', 'respostas',
    'tokens de entrada (todos)', 'tokens de saída', 'US$ entrada (todos)', 'US$ saída', 'US$ buscas', 'US$ deste agente', 'US$ da conversa inteira'], lines);
}

function bars(entries, label) {
  const max = Math.max(...entries.map(([, b]) => b.usd), 0.0001);
  return entries.map(([k, b]) => `<tr><td>${esc(label(k))}</td><td class="n">${usd(b.usd)}</td><td class="bar"><span style="width:${(100 * b.usd / max).toFixed(1)}%"></span></td>`
    + `<td class="n">${usd(b.usdInput + b.usdCacheWrite + b.usdCacheRead)}</td><td class="n">${usd(b.usdOutput)}</td><td class="n">${brNum(b.replies)}</td></tr>`).join('');
}

export function statementHtml(st, { account, events = [], since, generatedAt = Date.now(), pricesAsOf }) {
  const t = st.total;
  const days = [...st.byDay].sort(([a], [b]) => b.localeCompare(a));
  const lastHours = [...st.byHour].filter(([, b]) => b.last >= generatedAt - 4 * 86_400_000).sort(([a], [b]) => b.localeCompare(a));
  const chats = [...st.byChat.values()].sort((a, b) => b.usd - a.usd);
  const models = [...st.byModel].sort(([, a], [, b]) => b.usd - a.usd);
  const projects = [...st.byProject].sort(([, a], [, b]) => b.usd - a.usd);
  const top = [...st.rows].filter((r) => r.cost).sort((a, b) => b.cost.total - a.cost.total).slice(0, 60);
  const head = '<tr><th></th><th>total</th><th></th><th>entrada</th><th>saída</th><th>respostas</th></tr>';

  const acct = account ? `<section class="card warn"><h2>O que a Anthropic diz da sua conta (lido do seu PC em ${esc(new Date(account.fetchedAt).toLocaleString('pt-BR'))})</h2><ul>
    <li>Plano: <b>${esc(account.plan)}</b>. Uso extra (créditos): <b>${account.extraEnabled ? 'ligado' : 'desligado'}</b>${account.disabledReason ? ` — motivo: <b>${esc(account.disabledReason === 'out_of_credits' ? 'os créditos acabaram' : account.disabledReason)}</b>` : ''}.</li>
    <li>Total já cobrado em uso extra (contador da Anthropic): <b>${esc(account.extraUsed)}</b>.</li>
    <li>Limite semanal do plano: <b>${account.weeklyPercent}% usado</b>; a semana começou em ${esc(account.weekStart)} e volta em <b>${esc(account.weekReset)}</b>.</li>
    <li>Onde o uso da semana foi: ${esc(account.breakdown)}.</li></ul></section>` : '';
  const ev = events.length ? `<section class="card"><h2>Avisos de limite que apareceram nas conversas</h2><ul>${events.map((e) => `<li><b>${esc(new Date(e.at).toLocaleString('pt-BR'))}</b> — ${esc(e.text)}</li>`).join('')}</ul></section>` : '';

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Extrato de gastos com Claude</title><style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1200px;padding:0 16px;color:#1d1d1f;background:#fafaf8}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:0 0 10px}.card{background:#fff;border:1px solid #e3e1da;border-radius:10px;padding:16px 18px;margin:14px 0}
.warn{border-color:#d9a441;background:#fffaf0}.big{font-size:30px;font-weight:700}.muted{color:#666}table{border-collapse:collapse;width:100%}
td,th{padding:4px 8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}th{font-weight:600;color:#555}.n{text-align:right;white-space:nowrap}
.bar{width:28%}.bar span{display:block;height:12px;background:#c4622d;border-radius:3px}details summary{cursor:pointer;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.grid div{background:#f4f2ec;border-radius:8px;padding:10px}
small{color:#666}</style></head><body>
<h1>Extrato de gastos com Claude</h1>
<p class="muted">De ${esc(new Date(since).toLocaleDateString('pt-BR'))} até ${esc(new Date(generatedAt).toLocaleString('pt-BR'))} · ${brNum(t.replies)} respostas de ${brNum(st.byChat.size)} conversas · preços oficiais da Anthropic (tabela de ${esc(pricesAsOf)}, platform.claude.com/docs/en/about-claude/pricing)</p>
${acct}${ev}
<section class="card"><h2>Total a preço de tabela, no período</h2><div class="big">${usd(t.usd)}</div>
<p><small>É o que todas estas respostas custariam pagando token por token. No plano Max, o que fica dentro do limite do plano não é cobrado à parte; só o que passa do limite sai dos créditos de uso extra, a estes preços. O seu PC não guarda quais respostas caíram fora do limite, por isso este total e o contador da Anthropic acima são números diferentes.</small></p>
<div class="grid">
<div><b>Entrada nova</b><br>${brNum(t.input)} tokens<br>${usd(t.usdInput)}</div>
<div><b>Gravação no cache</b> (o contexto guardado para reler)<br>${brNum(t.cacheWrite)} tokens<br>${usd(t.usdCacheWrite)}</div>
<div><b>Leitura do cache</b> (reler a conversa a cada resposta)<br>${brNum(t.cacheRead)} tokens<br>${usd(t.usdCacheRead)}</div>
<div><b>Saída</b> (o que o Claude escreveu e pensou)<br>${brNum(t.output)} tokens, ${brNum(t.thinking)} de pensamento<br>${usd(t.usdOutput)}</div>
<div><b>Buscas na web</b><br>${brNum(t.webSearch)} buscas<br>${usd(t.usdWebSearch)}</div></div>
<p><small>1 token ≈ ¾ de uma palavra. "Entrada" é tudo o que o Claude lê antes de responder (a conversa até ali, os arquivos, os resultados de comandos); "saída" é o que ele escreve.</small></p></section>
<section class="card"><h2>Por dia</h2><table>${head}${bars(days, (k) => new Date(`${k}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }))}</table></section>
<section class="card"><h2>Hora a hora, últimos 4 dias</h2><table>${head}${bars(lastHours, (k) => k.split('-').reverse().join('/').replace(/^(\S+) (\S+)\/(\S+)\/(\S+)$/, '$4/$3 $1'))}</table></section>
<section class="card"><h2>Por projeto</h2><table>${head}${bars(projects, (k) => k)}</table></section>
<section class="card"><h2>Por modelo</h2><table>${head}${bars(models, (k) => k)}</table></section>
<section class="card"><h2>Por conversa (e por agente dentro dela), da mais cara para a mais barata</h2>
${chats.map((c) => `<details><summary>${usd(c.usd)} — ${esc(c.title)} <small>(${esc(c.project)} · ${brNum(c.replies)} respostas · ${esc(new Date(c.first).toLocaleString('pt-BR'))} a ${esc(new Date(c.last).toLocaleString('pt-BR'))})</small></summary>
<table><tr><th>quem</th><th class="n">respostas</th><th class="n">tokens de entrada</th><th class="n">US$ entrada</th><th class="n">tokens de saída</th><th class="n">US$ saída</th><th class="n">total</th></tr>
${[...c.agents].sort((a, b) => b[1].usd - a[1].usd).map(([who, a]) => `<tr><td>${esc(who)}</td><td class="n">${brNum(a.replies)}</td><td class="n">${brNum(a.input + a.cacheWrite + a.cacheRead)}</td><td class="n">${usd(a.usdInput + a.usdCacheWrite + a.usdCacheRead)}</td><td class="n">${brNum(a.output)}</td><td class="n">${usd(a.usdOutput)}</td><td class="n"><b>${usd(a.usd)}</b></td></tr>`).join('')}
</table><small>id: ${esc(c.sessionId)}</small></details>`).join('')}</section>
<section class="card"><h2>As 60 respostas mais caras</h2><table><tr><th>quando</th><th>conversa / quem</th><th>modelo</th><th class="n">entrada</th><th class="n">saída</th><th class="n">custo</th><th>o que leu antes · o que fez</th></tr>
${top.map((r) => { const s = st.sessions.get(r.sessionId); return `<tr><td>${esc(new Date(r.ts).toLocaleString('pt-BR'))}</td><td>${esc(oneLine(s.title, 50))}<br><small>${esc(r.who)}</small></td><td>${esc(r.model)}</td><td class="n">${brNum(r.input + r.cacheWrite5m + r.cacheWrite1h + r.cacheRead)}<br><small>${usd4(r.cost.input + r.cost.cacheWrite + r.cost.cacheRead)}</small></td><td class="n">${brNum(r.output)}<br><small>${usd4(r.cost.output)}</small></td><td class="n"><b>${usd4(r.cost.total)}</b></td><td><small>${r.readWords ? `leu ${brNum(r.readWords)} palavras: ${esc(oneLine(r.readWhat.join(' | '), 160))}<br>` : ''}${esc(oneLine(r.did.join(' | '), 160)) || 'escreveu a resposta'}</small></td></tr>`; }).join('')}</table></section>
${st.unpriced.size ? `<section class="card"><h2>Modelos sem preço conhecido (não somados)</h2><ul>${[...st.unpriced].map(([m, n]) => `<li>${esc(m)}: ${n} respostas</li>`).join('')}</ul></section>` : ''}
<section class="card"><h2>Como foi calculado</h2><p><small>Cada resposta do Claude grava no seu PC quantos tokens leu e escreveu (campo usage, preenchido pela Anthropic). Este extrato soma cada uma uma vez só, multiplicando pelos preços oficiais: entrada, gravação de cache (5 minutos ou 1 hora), leitura de cache e saída, mais US$ 10 por 1.000 buscas na web; o modo rápido conta em dobro e o Haiku 5.5 usa a faixa mais cara acima de 100 mil tokens. A linha completa de cada resposta está em <b>extrato-detalhado.csv</b> (abre no Excel); o resumo por conversa e agente em <b>extrato-por-conversa.csv</b>.</small></p></section>
</body></html>`;
}

// What Claude Code cached about the account on this PC (no ids, no e-mail, no tokens).
export function accountSnapshot(claudeJsonPath = join(homedir(), '.claude.json')) {
  let o;
  try { o = JSON.parse(readFileSync(claudeJsonPath, 'utf8')); } catch { return null; }
  const u = o.cachedUsageUtilization;
  if (!u) return null;
  const x = u.utilization?.extra_usage ?? {};
  const week = u.utilization?.seven_day ?? {};
  const bd = u.utilization?.seven_day_breakdown;
  const money = (minor, cur, dp = 2) => (Number.isFinite(minor) ? `${cur === 'BRL' ? 'R$' : cur} ${brNum(minor / 10 ** dp, dp)}` : 'indisponível');
  return {
    fetchedAt: u.fetchedAtMs,
    plan: `${o.oauthAccount?.organizationType ?? '?'} (${o.oauthAccount?.organizationRateLimitTier ?? '?'})`,
    extraEnabled: x.is_enabled === true,
    disabledReason: x.disabled_reason ?? null,
    extraUsed: money(x.used_credits, x.currency, x.decimal_places ?? 2),
    weeklyPercent: week.utilization ?? '?',
    weekStart: bd?.window_started_at ? new Date(bd.window_started_at).toLocaleString('pt-BR') : '?',
    weekReset: week.resets_at ? new Date(week.resets_at).toLocaleString('pt-BR') : '?',
    breakdown: (bd?.rows ?? []).map((r) => `${r.display_name} ${r.percent}%`).join(', '),
  };
}

// The limit notices Claude Code wrote into the chats ("You've hit your weekly limit", "monthly spend limit"…).
export async function limitEvents(projectsDir, since) {
  const out = new Map();
  const pattern = /hit your (weekly|monthly|session|daily)[^"]{0,40}limit|out of (extra usage|credits)|spend limit/i;
  for (const file of walk(projectsDir)) {
    try { if (statSync(file).mtimeMs < since) continue; } catch { continue; }
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const raw of lines) {
      if (!raw.includes('"isApiErrorMessage":true') || !pattern.test(raw)) continue;
      let o;
      try { o = JSON.parse(raw); } catch { continue; }
      const text = oneLine(resultText(o.message?.content), 140);
      const at = Date.parse(o.timestamp);
      const k = `${text}|${Math.floor(at / 600_000)}`;
      if (!out.has(k) && at >= since) out.set(k, { at, text });
    }
  }
  return [...out.values()].sort((a, b) => a.at - b.at);
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const days = Number(arg('--days') ?? 30);
  const since = arg('--since') ? new Date(`${arg('--since')}T00:00:00`).getTime() : Date.now() - days * 86_400_000;
  const out = arg('--out') ?? join(homedir(), 'Documents', 'Extrato-Claude');
  const projectsDir = arg('--projects') ?? join(homedir(), '.claude', 'projects');
  const pricesJson = JSON.parse(readFileSync(new URL('./prices.json', import.meta.url), 'utf8'));

  const st = await buildStatement({ projectsDir, since });
  const events = await limitEvents(projectsDir, since);
  const account = accountSnapshot();
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'extrato-detalhado.csv'), detailCsv(st));
  writeFileSync(join(out, 'extrato-por-conversa.csv'), chatsCsv(st));
  writeFileSync(join(out, 'extrato.html'), statementHtml(st, { account, events, since, pricesAsOf: pricesJson._asOf }));
  const plain = (m) => Object.fromEntries([...m].map(([k, v]) => [k, { ...v, agents: undefined }]));
  writeFileSync(join(out, 'extrato.json'), JSON.stringify({ since: new Date(since).toISOString(), generatedAt: new Date().toISOString(),
    account, events, total: st.total, byDay: plain(st.byDay), byHour: plain(st.byHour), byModel: plain(st.byModel), byProject: plain(st.byProject),
    unpriced: Object.fromEntries(st.unpriced) }, null, 1));
  console.log(JSON.stringify({ out, replies: st.rows.length, chats: st.byChat.size, usd: Math.round(st.total.usd * 100) / 100, events: events.length }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
