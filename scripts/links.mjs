import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadToken } from '../server/auth.mjs';
import { claudeDir } from '../server/sources/claude.mjs';

// 100.64/10 is where Tailscale puts its addresses, so a phone on the tailnet gets a link too.
const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function privateAddresses(interfaces = networkInterfaces()) {
  return Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal && PRIVATE.some((re) => re.test(a.address)))
    .map((a) => a.address);
}

export function buildLinks({ token, port, addresses = privateAddresses(), local = false }) {
  return {
    local: `http://127.0.0.1:${port}/?k=${token}`,
    lan: local ? [] : addresses.map((ip) => `http://${ip}:${port}/?k=${token}`),
  };
}

// What the person reads: where each link opens, and that the key in it is theirs alone.
export function linkLines(links) {
  return [
    `On this computer: ${links.local}`,
    ...links.lan.map((l) => `On your phone or another computer on the same Wi-Fi: ${l}`),
    links.lan.length ? 'Keep these links to yourself: they carry your key. Do not share them.' : 'Keep this link to yourself: it carries your key. Do not share it.',
  ];
}

export const notRunningText = () => 'session-map is not on yet. Ask /session-map:map in Claude Code to turn it on.';

async function answers(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function main() {
  const { values } = parseArgs({
    options: { port: { type: 'string', default: '4001' }, local: { type: 'boolean', default: false }, wait: { type: 'boolean', default: false } },
  });
  const port = Number.parseInt(values.port, 10);
  const deadline = Date.now() + (values.wait ? 20_000 : 0);
  let up = await answers(port);
  while (!up && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    up = await answers(port);
  }
  if (!up) {
    console.error(notRunningText(port));
    process.exit(1);
  }
  const links = buildLinks({ token: loadToken(join(claudeDir(), 'session-map')), port, local: values.local });
  console.log(linkLines(links).join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
