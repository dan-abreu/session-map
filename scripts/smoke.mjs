import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// The smoke test of the running program (finish plan, definition of done 5). It reads the server the way the page does —
// the page and every module it loads, then every GET the page makes, for the project and for its Foundation — and writes
// down what came back: status, and the top-level keys of the answer. Run before a change and after it, `--compare` says
// what went missing. It only reads: no POST, no PATCH, no DELETE, and it never prints a key.
//   node scripts/smoke.mjs [--url http://127.0.0.1:4001] [--project <id or name>] [--save <file>] [--compare <file>]

const SM_DIR = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'session-map');

// Answers that are allowed to be empty or refused, by design: a Foundation file not written yet, a route that needs a key.
const EMPTY_OK = new Set([404, 204]);

export const FIXED = [
  '/api/state', '/api/cards', '/api/projects/new', '/api/settings/reinforced-limit', '/api/settings/permission-mode',
  '/api/alerts?since=0', '/api/settings/notify', '/api/settings/ai-helpers', '/api/ai/activity?limit=5', '/api/ai/usage',
  '/api/logs', '/api/ai/brain', '/api/chat/list', '/api/history?q=map',
];
export const PER_PROJECT = ['/api/arch/{id}/mermaid', '/api/arch/{id}/model', '/api/arch/{id}/draft', '/api/changes/{id}', '/api/logs/projects/{id}'];
export const FOUNDATION = ['census', 'facts', 'sections', 'health', 'versions', 'uptodate', 'profile', 'practices', 'compass', 'care', 'findings', 'ideas', 'docsize', 'pointers', 'ledger', 'tree', 'proposals'];

const keysOf = (data) => (Array.isArray(data) ? [`[array:${data.length > 0 ? 'full' : 'empty'}]`] : data && typeof data === 'object' ? Object.keys(data).sort() : [typeof data]);

async function get(base, path, headers, { manual = false } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, { headers, redirect: manual ? 'manual' : 'follow', signal: AbortSignal.timeout(90_000) });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, ms: Date.now() - started, bytes: text.length, keys: data === null ? null : keysOf(data), text, cookie: res.headers.get('set-cookie') };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, bytes: 0, keys: null, error: String(err?.message ?? err).slice(0, 80), text: '' };
  }
}

export async function smoke({ base, token, project = null }) {
  const out = { at: new Date().toISOString(), assets: {}, routes: {} };

  // 1. the page and the modules it loads
  // The server answers the key with a redirect that carries the cookie, so the redirect is not followed here.
  const opened = await get(base, `/?k=${encodeURIComponent(token)}`, {}, { manual: true });
  const cookie = String(opened.cookie ?? '').split(';')[0];
  const index = opened.status >= 300 && opened.status < 400 ? await get(base, '/', { cookie }) : opened;
  const headers = { cookie, accept: 'application/json' };
  out.assets['/'] = { status: index.status, bytes: index.bytes };
  const pending = [...index.text.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css))"/g)].map((m) => m[1]);
  const seen = new Set();
  while (pending.length) {
    const rel = pending.pop();
    const url = rel.startsWith('/') ? rel : `/${rel}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await get(base, url, headers);
    out.assets[url] = { status: r.status, bytes: r.bytes };
    if (r.status === 200 && url.endsWith('.js') && !url.includes('/vendor/')) {
      for (const m of r.text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+\.js)['"]/g)) {
        const next = new URL(m[1], `http://x${url}`).pathname;
        if (!seen.has(next)) pending.push(next);
      }
    }
  }

  // 2. the GETs of the page
  for (const p of FIXED) out.routes[p] = pick(await get(base, p, headers));
  const state = JSON.parse((await get(base, '/api/state', headers)).text || '{}');
  const proj = (state.projects ?? []).find((x) => x.id === project || x.name === project) ?? (state.projects ?? [])[0];
  if (proj) {
    out.project = { id: proj.id, name: proj.name };
    for (const t of PER_PROJECT) out.routes[t.replace('{id}', '<project>')] = pick(await get(base, t.replace('{id}', encodeURIComponent(proj.id)), headers));
    for (const f of FOUNDATION) out.routes[`/api/foundation/<project>/${f}`] = pick(await get(base, `/api/foundation/${encodeURIComponent(proj.id)}/${f}${f === 'pointers' ? '?doc=README.md' : ''}`, headers));
    out.routes['/api/library'] = pick(await get(base, '/api/library', headers));
  }
  return out;
}

const pick = ({ status, ms, keys, bytes, error }) => ({ status, keys, bytes, ms, ...(error ? { error } : {}) });

// What a change must not do: lose a page, lose a route, turn an answer into an error, or take a key out of an answer.
export function compare(before, after) {
  const problems = [];
  for (const [url, a] of Object.entries(before.assets)) {
    const b = after.assets[url];
    if (a.status === 200 && b?.status !== 200) problems.push(`asset ${url}: ${a.status} -> ${b?.status ?? 'gone'}`);
  }
  for (const [url, a] of Object.entries(before.routes)) {
    const b = after.routes[url];
    if (!b) { problems.push(`route ${url}: gone from the run`); continue; }
    if (a.status === 200 && b.status !== 200) { problems.push(`route ${url}: 200 -> ${b.status}${b.error ? ` (${b.error})` : ''}`); continue; }
    if (Array.isArray(a.keys) && Array.isArray(b.keys) && !a.keys[0]?.startsWith('[')) {
      const lost = a.keys.filter((k) => !b.keys.includes(k));
      if (lost.length) problems.push(`route ${url}: lost ${lost.join(', ')}`);
    }
  }
  return problems;
}

function report(run) {
  const bad = [];
  for (const [url, a] of Object.entries(run.assets)) if (a.status !== 200) bad.push(`asset ${url}: ${a.status}`);
  for (const [url, r] of Object.entries(run.routes)) if (r.status !== 200 && !EMPTY_OK.has(r.status)) bad.push(`route ${url}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
  return bad;
}

async function main() {
  const { values } = parseArgs({ options: { url: { type: 'string' }, project: { type: 'string' }, save: { type: 'string' }, compare: { type: 'string' } } });
  const base = (values.url ?? 'http://127.0.0.1:4001').replace(/\/$/, '');
  const token = readFileSync(join(SM_DIR, 'token'), 'utf8').trim();
  const run = await smoke({ base, token, project: values.project ?? null });
  const bad = report(run);
  const assets = Object.keys(run.assets).length;
  const routes = Object.keys(run.routes).length;
  console.log(`smoke ${base}: ${assets} files of the page, ${routes} reads; ${bad.length ? `${bad.length} refused or broken` : 'all answer'}`);
  for (const b of bad) console.log(`  - ${b}`);
  if (values.save) {
    mkdirSync(dirname(resolve(values.save)), { recursive: true });
    writeFileSync(values.save, `${JSON.stringify(run, null, 1)}\n`);
    console.log(`saved to ${values.save}`);
  }
  let problems = [];
  if (values.compare) {
    problems = compare(JSON.parse(readFileSync(values.compare, 'utf8')), run);
    console.log(problems.length ? `compared with ${values.compare}: ${problems.length} regression(s)` : `compared with ${values.compare}: nothing lost`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  process.exit(bad.length || problems.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(`smoke stopped: ${err.message}`); process.exit(2); });
