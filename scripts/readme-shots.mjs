// Takes the README screenshots: starts the demo server on a free port, opens Chrome (own profile, DevTools), shoots six
// screens in English and Portuguese and writes the twelve .webp plus shots.json (see shots-manifest.mjs).
//   node scripts/readme-shots.mjs [--out <folder>] [--port <n>]       (default folder: docs/images)
// The screens are reached by direct links (?view=…&project=…), never by clicking a tab. Needs Chrome (or CHROME_PATH) and Node 22+.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildManifest, sha256Of, webpSize } from './shots-manifest.mjs';
import { findChrome, launchBrowser } from './shot-browser.mjs';

export { findChrome };

const root = fileURLToPath(new URL('..', import.meta.url));
const DEMO = 'acme-shop-8324f1';
export const LANGS = ['en', 'pt-BR'];

// The script of the shots, as data. width/height/scale are the viewport; clicks are the only interactions allowed (a menu,
// never a tab); tour leaves the "seen" flag unset so the welcome tour plays; settle is extra waiting in ms.
export const SCREENS = [
  { id: 'map', query: `?view=map&project=${DEMO}&open=all`, width: 1440, height: 900, scale: 1 },
  { id: 'tour', query: `?view=map&project=${DEMO}`, width: 1440, height: 900, scale: 1, tour: true, settle: 1800 },
  { id: 'part', query: `?view=map&project=${DEMO}&open=all&select=node:pt:search&tab=details`, width: 1440, height: 900, scale: 1 },
  { id: 'waiting', query: `?view=map&project=${DEMO}`, width: 1440, height: 900, scale: 1, clicks: ['#waitingBtn'] },
  { id: 'help', query: `?view=map&project=${DEMO}`, width: 1440, height: 900, scale: 1, clicks: ['#tab-more', '[data-more="help"]'] },
  { id: 'phone', query: `?view=map&project=${DEMO}`, width: 390, height: 844, scale: 2, mobile: true },
];

export const shotName = (screen, lang) => `${lang === 'pt-BR' ? 'pt' : 'en'}-${screen.id}.webp`;
export const shotUrl = (base, screen) => `${base}/${screen.query}`;

export function todayLocal(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function parseShotsArgs(argv) {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' }, port: { type: 'string' } } });
  return { out: values.out ? resolve(values.out) : join(root, 'docs', 'images'), port: values.port ? Number.parseInt(values.port, 10) : null };
}

const freePort = () => new Promise((ok, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => ok(port)); });
});

// The demo server prints its listening line (with the one-time link) on stderr as one JSON line.
function startDemo(port) {
  const proc = spawn(process.execPath, [join(root, 'server', 'main.mjs'), '--demo', '--port', String(port)], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  const link = new Promise((ok, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('the demo server did not start in 20 s')), 20_000);
    proc.once('exit', (code) => { clearTimeout(timer); fail(new Error(`the demo server stopped (code ${code}): ${buf.trim().slice(-300)}`)); });
    proc.stderr.on('data', (chunk) => {
      buf += chunk;
      for (const line of buf.split('\n')) {
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'listening') { clearTimeout(timer); ok(msg.local); }
        } catch { /* a partial line: wait for the rest */ }
      }
    });
  });
  return { proc, link };
}

export async function runShots({ out, port = null, now = new Date() }) {
  const chrome = findChrome();
  if (!chrome) {
    process.stderr.write(`Chrome was not found. Install Google Chrome or set CHROME_PATH to chrome${process.env.CHROME_PATH ? ` (CHROME_PATH=${process.env.CHROME_PATH} does not exist)` : ''}.\n`);
    return 2;
  }
  if (typeof WebSocket === 'undefined') {
    process.stderr.write('This Node has no WebSocket: the screenshots need Node 22 or newer (and Chrome).\n');
    return 2;
  }
  mkdirSync(out, { recursive: true });
  const use = port ?? await freePort();
  const server = startDemo(use);
  let browser = null;
  try {
    const entry = new URL(await server.link);
    const base = `http://127.0.0.1:${use}`;
    browser = await launchBrowser(chrome);
    const first = await browser.page({ width: 800, height: 600 });
    await first.goto(`${base}/${entry.search}`); // the one-time ?k= link puts the cookie in this Chrome's profile
    await first.close();
    const images = {};
    for (const lang of LANGS) {
      for (const screen of SCREENS) {
        // Everything the app remembers is wiped first, so no shot depends on the one before it; the Now strip starts folded.
        const init = `try { localStorage.clear(); localStorage.setItem('sm.lang', ${JSON.stringify(lang)}); localStorage.setItem('sm.now.folded', '1'); ${screen.tour ? '' : "localStorage.setItem('sm.tour', 'done');"} } catch {}`;
        const page = await browser.page({ width: screen.width, height: screen.height, scale: screen.scale, mobile: Boolean(screen.mobile), init });
        try {
          await page.goto(shotUrl(base, screen));
          const ready = await page.until("(() => { const n = document.querySelector('#notice'); return !n || n.hidden; })()");
          if (!ready) throw new Error(`${shotName(screen, lang)}: the page never finished loading`);
          await page.sleep(1500 + (screen.settle ?? 0));
          for (const sel of screen.clicks ?? []) await page.click(sel);
          await page.sleep(700);
          const bytes = await page.shot('webp');
          const name = shotName(screen, lang);
          writeFileSync(join(out, name), bytes);
          const size = webpSize(bytes) ?? { width: screen.width * screen.scale, height: screen.height * screen.scale };
          images[name] = { sha: sha256Of(bytes), ...size, lang };
        } finally {
          await page.close();
        }
      }
    }
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    writeFileSync(join(out, 'shots.json'), `${JSON.stringify(buildManifest({ version, date: todayLocal(now), images }), null, 2)}\n`);
    process.stdout.write(`${Object.keys(images).length} screenshots in ${out}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`Screenshots failed: ${err.message}\n`);
    return 1;
  } finally {
    await browser?.close();
    server.proc.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runShots(parseShotsArgs(process.argv.slice(2)));
}
