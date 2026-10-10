// A small headless-Chrome driver over the DevTools protocol, just enough to take the README screenshots. It starts its own
// Chrome with a throwaway profile (never the owner's), talks over a WebSocket, and uses no npm package.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLACES = {
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

// CHROME_PATH wins and is never second-guessed: if it points nowhere that is an error, not a silent other browser.
export function findChrome(env = process.env, platform = process.platform, exists = existsSync) {
  if (env.CHROME_PATH) return exists(env.CHROME_PATH) ? env.CHROME_PATH : null;
  const places = [...(PLACES[platform] ?? PLACES.linux)];
  if (platform === 'win32' && env.LOCALAPPDATA) places.push(`${env.LOCALAPPDATA.replaceAll('\\', '/')}/Google/Chrome/Application/chrome.exe`);
  return places.find((p) => exists(p)) ?? null;
}

// Chrome picks its own debugging port (0) and tells us in <profile>/DevToolsActivePort, so no port can be taken by someone else.
export async function launchBrowser(chrome) {
  if (typeof WebSocket === 'undefined') throw new Error('this Node has no WebSocket (needs Node 22 or newer)');
  const profile = mkdtempSync(join(tmpdir(), 'sm-shots-chrome-'));
  const proc = spawn(chrome, ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let early = null;
  proc.on('error', (err) => { early = err; });
  let port = null;
  for (let i = 0; i < 80 && !port && !early; i++) {
    try { port = Number.parseInt(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 10); } catch { await sleep(250); }
  }
  const cleanup = () => rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (!port) {
    proc.kill();
    cleanup();
    throw new Error(early ? `Chrome did not start: ${early.message}` : 'Chrome did not start');
  }

  async function page({ width, height, scale = 1, mobile = false, init = '' }) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const n = ++id;
      waiting.set(n, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    // Runs before the page's own scripts: the language and the "tour seen" flag must be there when the app starts.
    if (init) await send('Page.addScriptToEvaluateOnNewDocument', { source: init });
    const api = {
      async goto(url) { await send('Page.navigate', { url }); await sleep(800); },
      async eval(expr) {
        const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      // Waits until the expression is truthy; false after the time is up, so the caller decides how loud to be.
      async until(expr, ms = 10_000) {
        for (let waited = 0; waited < ms; waited += 200) {
          if (await api.eval(expr).catch(() => false)) return true;
          await sleep(200);
        }
        return false;
      },
      async click(selector) {
        const at = await api.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (!at) throw new Error(`no element ${selector}`);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      },
      async shot(format = 'webp') {
        const r = await send('Page.captureScreenshot', { format, ...(format === 'webp' ? { quality: 85 } : {}) });
        return Buffer.from(r.data, 'base64');
      },
      sleep,
      async close() { ws.close(); await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {}); },
    };
    return api;
  }

  return {
    page,
    async close() {
      proc.kill();
      await sleep(500);
      cleanup();
    },
  };
}
