import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AREAS } from '../server/web/nav.js';
import { findChrome } from './shot-browser.mjs';

// The smoke test of the page in a real browser (finish plan, definition of done 5): it opens the running map in a headless
// Chrome or Edge, goes to each area of the top bar and of "More", waits for it to draw, and writes down what the browser
// complained about — script errors, console errors, requests refused — and whether the area really showed. Run before a
// change and after it; `--compare` names what is new. It only looks: it clicks nothing and writes nothing to the program.
//   node scripts/smoke-browser.mjs [--url http://127.0.0.1:4001] [--save <file>] [--compare <file>] [--wait 5000]

const SM_DIR = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'session-map');
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Two complaints are the same complaint when they say the same thing: numbers and long ids do not count.
export const normalize = (text) => String(text ?? '').replace(/https?:\/\/[^\s)]+/g, '<url>').replace(/\b[0-9a-f]{8,}\b/gi, '<id>').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);

export function compare(before, after) {
  const problems = [];
  for (const [area, a] of Object.entries(after.areas)) {
    const b = before.areas[area];
    if (!b) continue;
    if (b.shown && !a.shown) problems.push(`area ${area}: it showed before and does not now`);
    const known = new Set(b.complaints.map(normalize));
    for (const c of a.complaints) if (!known.has(normalize(c))) problems.push(`area ${area}: new complaint: ${normalize(c)}`);
  }
  for (const area of Object.keys(before.areas)) if (!after.areas[area]) problems.push(`area ${area}: not in the run`);
  return problems;
}

async function launch(port, profile) {
  // CHROME_PATH wins (and a wrong one is an error, never a silent other browser); else Chrome where it usually is, else Edge.
  const exe = process.env.CHROME_PATH ? findChrome() : (findChrome() ?? BROWSERS.find((p) => existsSync(p)));
  if (!exe) throw new Error(process.env.CHROME_PATH ? `CHROME_PATH=${process.env.CHROME_PATH} does not exist` : 'no Chrome or Edge found');
  const child = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return child; } catch { /* not up yet */ }
    await sleep(250);
  }
  child.kill();
  throw new Error('the browser did not start');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } else for (const l of listeners) l(msg);
  };
  const ready = new Promise((resolveReady, reject) => { ws.onopen = resolveReady; ws.onerror = () => reject(new Error('no debugger connection')); });
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  return { ready, send, on: (l) => listeners.add(l), close: () => ws.close() };
}

export async function browserSmoke({ base, token, wait = 5000, port = 9333, shots = null, areas = null, probe: extra = null }) {
  const profile = mkdtempSync(join(tmpdir(), 'sm-smoke-browser-'));
  const child = await launch(port, profile);
  try {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const cdp = connect(target.webSocketDebuggerUrl);
    await cdp.ready;
    let complaints = [];
    cdp.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') complaints.push(`script error: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`.split('\n')[0]);
      else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(m.params.type)) complaints.push(`console ${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') complaints.push(`browser: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
      else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && m.params.response.url.startsWith(base)) complaints.push(`request ${m.params.response.status}: ${new URL(m.params.response.url).pathname}`);
      else if (m.method === 'Network.loadingFailed' && !m.params.canceled) complaints.push(`request failed: ${m.params.errorText}`);
    });
    for (const d of ['Runtime', 'Log', 'Network', 'Page']) await cdp.send(`${d}.enable`);
    // A desktop window: the default one is small enough to draw the page as it does on a phone.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // Open the map with the key once: the server answers with a redirect that sets the cookie, then every area reads with it.
    await cdp.send('Page.navigate', { url: `${base}/?k=${encodeURIComponent(token)}` });
    await sleep(wait);

    const out = { at: new Date().toISOString(), areas: {} };
    for (const area of AREAS.map((a) => a.id).filter((id) => !areas || areas.includes(id))) {
      complaints = [];
      await cdp.send('Page.navigate', { url: `${base}/?view=${area}` });
      await sleep(wait);
      const probe = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        // A text key that reached the screen unreplaced ("requests.act.later") is a missing translation: the page shows the
        // key itself. File names in a conversation (health.test.mjs) look the same and are left out.
        expression: `(() => { const AREA = ${JSON.stringify(area)}; const v = document.body.dataset.view; const own = document.getElementById('view-' + AREA); const s = own && !own.hidden ? own : [...document.querySelectorAll('.view')].find((x) => !x.hidden); const drawn = s ? s.querySelectorAll('svg *, canvas').length : 0; const subs = [...document.querySelectorAll('#view-' + AREA + ' .fd-subtabs [data-sub]')].map((b) => b.dataset.sub); const nb = document.querySelector('#navbar'); const navOver = nb ? nb.scrollWidth - nb.clientWidth : 0; const raw = [...new Set((document.body.innerText.match(/\\b[a-z]+\\.[a-z]+\\.[a-zA-Z.]+\\b/g) || []).filter((k) => /^(item|point|nav|home|health|flow|tab|map|convs|requests|logs|brain|costs|library|discover|changes)\\./.test(k) && !/\\.(mjs|js|json|md|css|html|png|svg)$/.test(k)))]; return { view: v, section: s ? s.id : null, size: s ? s.innerText.trim().length : 0, excerpt: s ? s.innerText.trim().replace(/\s+/g, ' ').slice(0, 110) : '', drawn, navOver, subs, rawKeys: raw.slice(0, 5), sections: [...document.querySelectorAll('.view')].map((x) => x.id + ':' + (x.hidden ? 'hidden' : 'shown') + ':' + x.innerText.length), win: innerWidth + 'x' + innerHeight }; })()`,
      });
      const v = probe.result?.result?.value ?? {};
      const extraValue = extra ? (await cdp.send('Runtime.evaluate', { returnByValue: true, expression: extra })).result?.result?.value : undefined;
      if (shots) {
        mkdirSync(shots, { recursive: true });
        const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
        if (png.result?.data) writeFileSync(join(shots, `${area}.png`), Buffer.from(png.result.data, 'base64'));
      }
      out.areas[area] = { ...(extra ? { extra: extraValue } : {}), view: v.view ?? null, section: v.section ?? null, shown: v.view === area && ((v.size ?? 0) > 20 || (v.drawn ?? 0) > 20), size: v.size ?? 0, excerpt: v.excerpt ?? '', drawn: v.drawn ?? 0, sections: v.sections ?? [], subs: v.subs ?? [], win: v.win ?? null, rawKeys: v.rawKeys ?? [], complaints: [...new Set([...complaints, ...(v.rawKeys ?? []).map((k) => `text key shown raw: ${k}`), ...((v.navOver ?? 0) > 2 ? [`the top bar is wider than its room by ${v.navOver} px`] : [])])] };
    }
    // The sub-pages of an area (Health, Route): each one is opened by a click on its tab, like a person would.
    for (const [area, a] of Object.entries({ ...out.areas })) {
      for (const sub of (a.subs ?? []).slice(1)) {
        complaints = [];
        await cdp.send('Page.navigate', { url: `${base}/?view=${area}` });
        await sleep(wait);
        await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#view-${area} .fd-subtabs [data-sub="${sub}"]').click()` });
        await sleep(Math.round(wait / 2));
        const probe = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const b = document.querySelector('#fd-body-${area}'); const raw = [...new Set((document.body.innerText.match(/\b[a-z]+\.[a-z]+\.[a-zA-Z.]+\b/g) || []).filter((k) => /^(care|health|uptodate|versions|findings|rota|profile|practices|fd)\./.test(k) && !/\.(mjs|js|json|md|css|html)$/.test(k)))]; return { size: b ? b.innerText.trim().length : 0, excerpt: b ? b.innerText.trim().split(String.fromCharCode(10)).join(' | ').slice(0, 200) : '', current: document.querySelector('#view-${area} [aria-selected="true"]')?.dataset.sub ?? null, raw: raw.slice(0, 5) }; })()` });
        const v = probe.result?.result?.value ?? {};
        if (shots) { const png = await cdp.send('Page.captureScreenshot', { format: 'png' }); if (png.result?.data) writeFileSync(join(shots, `${area}-${sub}.png`), Buffer.from(png.result.data, 'base64')); }
        out.areas[`${area}/${sub}`] = { view: area, shown: v.current === sub && (v.size ?? 0) > 20, size: v.size ?? 0, excerpt: v.excerpt ?? '', drawn: 0, rawKeys: v.raw ?? [], complaints: [...new Set([...complaints, ...(v.raw ?? []).map((k) => `text key shown raw: ${k}`)])] };
      }
    }
    // The Requests tab's review (mm27): opened by a click like a person would, looked at, and left again. No decision is made.
    if ((!areas || areas.includes('requests')) && out.areas.requests?.shown) {
      complaints = [];
      await cdp.send('Page.navigate', { url: `${base}/?view=requests` });
      await sleep(wait);
      await cdp.send('Runtime.evaluate', { expression: "document.querySelector('#view-requests .req-review-open')?.click()" });
      await sleep(Math.round(wait / 2));
      const probe = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const b = document.querySelector('#view-requests .req-review'); const raw = [...new Set((document.body.innerText.match(/\\b[a-z]+(?:\\.[a-zA-Z0-9-]+){1,3}\\b/g) ?? []).filter((x) => /^(requests|err|tab|nav)\\./.test(x)))]; return { size: b ? b.innerText.length : 0, card: Boolean(b?.querySelector('.req-card')), buttons: b ? [...b.querySelectorAll('button')].map((x) => x.innerText.trim()) : [], raw }; })()` });
      const v = probe.result?.result?.value ?? {};
      if (shots) { const png = await cdp.send('Page.captureScreenshot', { format: 'png' }); if (png.result?.data) writeFileSync(join(shots, 'requests-review.png'), Buffer.from(png.result.data, 'base64')); }
      out.areas['requests/review'] = { view: 'requests', shown: Boolean(v.card) && (v.size ?? 0) > 20, size: v.size ?? 0, excerpt: (v.buttons ?? []).join(' | '), drawn: 0, rawKeys: v.raw ?? [], complaints: [...new Set([...complaints])] };
    }
    cdp.close();
    return out;
  } finally {
    child.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser still holds a file; the temp folder goes later */ }
  }
}

async function main() {
  const { values } = parseArgs({ options: { url: { type: 'string' }, save: { type: 'string' }, compare: { type: 'string' }, wait: { type: 'string' }, shots: { type: 'string' }, areas: { type: 'string' }, probe: { type: 'string' } } });
  const base = (values.url ?? 'http://127.0.0.1:4001').replace(/\/$/, '');
  const token = readFileSync(join(SM_DIR, 'token'), 'utf8').trim();
  const run = await browserSmoke({ base, token, wait: Number(values.wait ?? 5000), shots: values.shots ?? null, areas: values.areas ? values.areas.split(',') : null, probe: values.probe ?? null });
  let loud = 0;
  for (const [area, a] of Object.entries(run.areas)) {
    const note = [!a.shown ? 'NOT SHOWN' : null, a.rawKeys.length ? `raw text keys: ${a.rawKeys.join(', ')}` : null].filter(Boolean).join('; ');
    console.log(`${area.padEnd(10)} ${a.shown ? 'ok ' : 'BAD'} ${String(a.size).padStart(6)} chars ${String(a.drawn ?? 0).padStart(5)} drawn  ${a.complaints.length} complaint(s)${note ? `  [${note}]` : ''}${a.shown ? '' : `  (view=${a.view}, section=${a.section})`}`);
    for (const c of a.complaints) console.log(`    - ${normalize(c)}`);
    loud += a.complaints.length + (a.shown ? 0 : 1);
  }
  if (values.save) { mkdirSync(dirname(resolve(values.save)), { recursive: true }); writeFileSync(values.save, `${JSON.stringify(run, null, 1)}\n`); console.log(`saved to ${values.save}`); }
  let problems = [];
  if (values.compare) {
    problems = compare(JSON.parse(readFileSync(values.compare, 'utf8')), run);
    console.log(problems.length ? `compared with ${values.compare}: ${problems.length} new problem(s)` : `compared with ${values.compare}: nothing new`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  process.exit(values.compare ? (problems.length ? 1 : 0) : (loud ? 1 : 0));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(`browser smoke stopped: ${err.message}`); process.exit(2); });
