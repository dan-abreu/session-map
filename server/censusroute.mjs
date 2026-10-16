import { isLocal } from './auth.mjs';
import { uiTree } from './census.mjs';
import { debtLedgerCached } from './debt.mjs';

// The program's own census, served to the page (id130, mm57): GET /api/census/ui -> the interface tree (the 13 areas
// with their screens, sections and buttons, read from the code); GET /api/census/debt -> the debt ledger (id134,
// or45: the deferred shortcut/ponytail comments, harvested). Reads on this PC need no key, like the Flow's own (fl04):
// the answer is the program's own texts and comments, and the key stays for the writes, which this route has none of.
const UI_PATH = '/api/census/ui';
const DEBT_PATH = '/api/census/debt';

export function createCensusRoutes({ demo = false } = {}) {
  async function handle(req, url, address) {
    if (url.pathname !== UI_PATH && url.pathname !== DEBT_PATH) return { status: 404, body: { ok: false, error: 'not-found' } };
    if (demo) return { status: 403, body: { ok: false, error: 'demo' } };
    if (!isLocal(address, req.headers.host)) return { status: 403, body: { ok: false, error: 'loopback-only' } };
    if (req.method !== 'GET') return { status: 404, body: { ok: false, error: 'not-found' } };
    if (url.pathname === DEBT_PATH) return { status: 200, body: { ok: true, ...debtLedgerCached() } };
    return { status: 200, body: { ok: true, ...uiTree() } };
  }
  return { handles: (path) => path === UI_PATH || path === DEBT_PATH, handle };
}
