// Prototype-only static server; replaced by server/main.mjs in task 10.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const webDir = join(here, 'web');
const demoState = join(here, '..', 'demo', 'state.json');
const port = Number(process.env.PORT) || 4001;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const log = (msg, extra = {}) => process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), msg, ...extra })}\n`);

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (path === '/api/state') {
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      res.end(await readFile(demoState));
      return;
    }
    const file = normalize(join(webDir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(webDir + sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end();
    if (err.code !== 'ENOENT') log('request failed', { path, error: err.message });
  }
});

server.listen(port, '127.0.0.1', () => log('preview listening', { url: `http://127.0.0.1:${port}/` }));
