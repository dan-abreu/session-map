import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize } from '../server/auth.mjs';
import { createFoundationRoute } from '../server/foundation/http/index.mjs';
import * as read from '../server/foundation/http/read.mjs';
import { fdDir, writeFd } from '../server/foundation/store.mjs';
import { censusOf, diffCensus } from '../server/foundation/census.mjs';
import { extractAll } from '../server/foundation/extract/index.mjs';
import { readDocs } from '../server/foundation/docwatch.mjs';
import { readArch } from '../server/arch/detect.mjs';
import { sectionsOf, GENERATED_START } from '../server/foundation/sections.mjs';
import { emptyLedger, recordRead, ledgerSummary, lineCharsOf } from '../server/foundation/ledger.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from './fixtures/repo-copy.mjs';

const ID = 'acme-shop-8324f1';
const TOKEN = 'b'.repeat(64);
const NOW = new Date('2026-10-10T12:00:00.000Z');
const DEMO_DIR = fileURLToPath(new URL('../demo/foundation/', import.meta.url));
const KINDS = ['route', 'screen', 'table', 'relation', 'queue', 'job', 'integration', 'env', 'function', 'call', 'import', 'export'];
const ORIGINS = ['EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'DECLARED'];
const SECRET = 'do-not-read-42';

function call(port, method, path, { cookie = TOKEN, body, header = true } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}` };
    if (cookie) headers.cookie = `sm_token=${cookie}`;
    if (method !== 'GET') Object.assign(headers, { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', ...(header ? { 'x-session-map': '1' } : {}) });
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* plain text answer */ }
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

// The gate main.mjs puts in front of every route, then the foundation dispatcher with the B1 routes only.
async function withServer({ demo = false, root = '/work/acme-shop', smDir: given, arch } = {}, fn) {
  const smDir = given ?? mkdtempSync(join(tmpdir(), 'sm-fdread-'));
  const projects = [{ id: ID, name: 'acme-shop', root, arch: arch ?? { lang: 'en' } }];
  const handle = createFoundationRoute({ smDir, demo, token: TOKEN, projects: async () => projects, modules: [read] });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const auth = authorize(req, url, { token: TOKEN, address: '127.0.0.1' });
    if (auth.status !== 200) { res.writeHead(auth.status); return res.end(); }
    await handle(req, res, url);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn({ port: server.address().port, smDir });
  } finally {
    await new Promise((r) => server.close(r));
    if (!given) rmSync(smDir, { recursive: true, force: true });
  }
}

const owners = () => new Map(Object.entries(JSON.parse(readFileSync(join(FIXTURE_REPOS, 'acme-shop.answer.json'), 'utf8')).owners));
const EXTRA = 'apps/api/src/extra.ts';
const PARTLY = 'apps/api/src/routes/orders.ts';

// What the refresh will write (B1-T20), made here by hand from a copy of acme-shop: two census rounds (the second one
// adds a file), the statement of both, the facts, the sections and a ledger with one whole file and one half read.
async function generated() {
  const root = copyFixtureRepo('acme-shop');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdread-'));
  const first = await censusOf(root, null, { owners: owners(), now: NOW });
  writeFileSync(join(root, EXTRA), 'export const extra = 1;\n');
  const census = await censusOf(root, first, { owners: owners(), now: NOW });
  const facts = extractAll(root, census, null, { now: NOW });
  const arch = await readArch(root, {});
  const sections = sectionsOf(facts, census, arch, { docs: readDocs(root, census).docs, now: NOW });
  const row = (p) => census.files.find((f) => f.path === p);
  let ledger = recordRead(emptyLedger(), 'apps/api/src/server.ts', row('apps/api/src/server.ts').sha, [[1, row('apps/api/src/server.ts').lines.total]], { run: 'r1', model: 'sonnet', at: NOW.toISOString() });
  ledger = recordRead(ledger, PARTLY, row(PARTLY).sha, [[1, 3]], { run: 'r1', model: 'sonnet', at: NOW.toISOString() });
  writeFd(smDir, ID, 'census.json', census);
  writeFd(smDir, ID, 'facts.json', facts);
  writeFd(smDir, ID, 'sections.json', sections);
  // A stored summary that no longer holds: the route must count again against the census.
  writeFd(smDir, ID, 'read-ledger.json', { ...ledger, summary: { readChars: 1, totalChars: 1, percent: 100, missing: [] } });
  writeFileSync(join(fdDir(smDir, ID), 'census-log.jsonl'), `${JSON.stringify(diffCensus(null, first))}\n${JSON.stringify(diffCensus(first, census))}\n`);
  return { root, smDir, census, facts, sections, ledger, arch, done: () => { removeFixtureRepo(root); rmSync(smDir, { recursive: true, force: true }); } };
}

const base = `/api/foundation/${ID}`;
const READS = ['census', 'census/log', 'tree', 'ledger', 'facts', 'sections'];

test('every read needs the token cookie: file names and code are never open', async () => {
  await withServer({}, async ({ port }) => {
    for (const what of READS) assert.equal((await call(port, 'GET', `${base}/${what}`, { cookie: null })).status, 401, what);
  });
});

test('an unknown project is 404 unknown-project', async () => {
  await withServer({}, async ({ port }) => {
    for (const what of READS) {
      const res = await call(port, 'GET', `/api/foundation/acme-other-000000/${what}`);
      assert.equal(res.status, 404, what);
      assert.equal(res.body.error, 'unknown-project');
    }
  });
});

test('before the first refresh every read answers 200 null, never 500', async () => {
  await withServer({}, async ({ port }) => {
    for (const what of READS) {
      const res = await call(port, 'GET', `${base}/${what}`);
      assert.equal(res.status, 200, what);
      assert.equal(res.body, null, what);
    }
  });
});

test('a folder or file that climbs out, starts at the root or uses \\ is 400; so are an unknown kind and a bad since', async () => {
  await withServer({}, async ({ port }) => {
    const bad = [
      'census?folder=../x', 'census?folder=/etc', 'census?folder=apps%5Capi', 'census?folder=apps/../..', 'census?folder=C:/x',
      'facts?file=../x', 'facts?file=/etc/passwd', 'facts?file=apps%5Capi%5Cx.ts',
      'facts?kind=secret', 'facts?kind=', 'census/log?since=abc', 'census/log?since=-1', 'tree?since=1.5',
    ];
    for (const what of bad) assert.equal((await call(port, 'GET', `${base}/${what}`)).status, 400, what);
  });
});

test('POST refresh needs the x-session-map header and answers whether a round started', async () => {
  await withServer({}, async ({ port }) => {
    assert.equal((await call(port, 'POST', `${base}/refresh`, { header: false })).status, 403);
    const first = await call(port, 'POST', `${base}/refresh`, { body: {} });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { started: true });
    const again = await call(port, 'POST', `${base}/refresh`, { body: {} });
    assert.equal(again.body.started, false, 'one round at a time, 30 s apart');
    assert.equal((await call(port, 'GET', `${base}/refresh`)).status, 404, 'refresh is a write only');
  });
});

test('census: the files of the cut only, the sums always whole', async () => {
  const g = await generated();
  try {
    await withServer({ root: g.root, smDir: g.smDir }, async ({ port }) => {
      const all = (await call(port, 'GET', `${base}/census`)).body;
      assert.deepEqual(all, g.census);
      const api = (await call(port, 'GET', `${base}/census?folder=apps/api/`)).body;
      assert.ok(api.files.length > 0);
      assert.ok(api.files.every((f) => f.path.startsWith('apps/api/')));
      assert.deepEqual(api.sums, g.census.sums, 'sums are never cut');
      assert.equal(api.rev, g.census.rev);
      const noSlash = (await call(port, 'GET', `${base}/census?folder=apps/api`)).body;
      assert.deepEqual(noSlash.files, api.files);
      assert.ok(!(await call(port, 'GET', `${base}/census?folder=apps/ap`)).body.files.length, 'a folder is a whole name, not a prefix');
      const orders = (await call(port, 'GET', `${base}/census?part=orders`)).body;
      assert.ok(orders.files.length > 0 && orders.files.every((f) => f.owner === 'orders'));
      const none = (await call(port, 'GET', `${base}/census?part=_none`)).body;
      assert.deepEqual(none.files.map((f) => f.path).sort(), g.census.files.filter((f) => f.included && !f.owner).map((f) => f.path).sort());
      const both = (await call(port, 'GET', `${base}/census?folder=apps/admin&part=_none`)).body;
      assert.ok(both.files.length > 0 && both.files.every((f) => f.path.startsWith('apps/admin/') && !f.owner));
    });
  } finally { g.done(); }
});

test('census/log: the statement lines after a rev, in order', async () => {
  const g = await generated();
  try {
    await withServer({ root: g.root, smDir: g.smDir }, async ({ port }) => {
      const all = (await call(port, 'GET', `${base}/census/log`)).body;
      assert.deepEqual(all.map((l) => l.rev), [1, 2]);
      const after = (await call(port, 'GET', `${base}/census/log?since=1`)).body;
      assert.equal(after.length, 1);
      assert.deepEqual(after[0].added.map((a) => a.path), [EXTRA]);
      assert.deepEqual((await call(port, 'GET', `${base}/census/log?since=2`)).body, []);
    });
  } finally { g.done(); }
});

test('facts: filtered by kind and file, without the reader\'s raw cache', async () => {
  const g = await generated();
  try {
    await withServer({ root: g.root, smDir: g.smDir }, async ({ port }) => {
      const all = (await call(port, 'GET', `${base}/facts`)).body;
      assert.equal(all.facts.length, g.facts.facts.length);
      assert.equal(all.censusRev, g.facts.censusRev);
      for (const entry of Object.values(all.files)) assert.deepEqual(Object.keys(entry).sort(), ['extractor', 'factIds', 'sha']);
      const routes = (await call(port, 'GET', `${base}/facts?kind=route`)).body.facts;
      assert.equal(routes.length, g.facts.facts.filter((f) => f.kind === 'route').length);
      assert.ok(routes.every((f) => f.kind === 'route'));
      const inFile = (await call(port, 'GET', `${base}/facts?file=${encodeURIComponent(PARTLY)}&kind=route`)).body;
      assert.ok(inFile.facts.length > 0 && inFile.facts.every((f) => f.kind === 'route' && (f.file === PARTLY || f.refs.some((r) => r.file === PARTLY))));
      assert.deepEqual(Object.keys(inFile.files), [PARTLY]);
    });
  } finally { g.done(); }
});

test('ledger: the summary is counted again against the current census, partly read files from the disk', async () => {
  const g = await generated();
  try {
    await withServer({ root: g.root, smDir: g.smDir }, async ({ port }) => {
      const res = (await call(port, 'GET', `${base}/ledger`)).body;
      const want = ledgerSummary(g.ledger, g.census, { lineChars: (p) => lineCharsOf(readFileSync(join(g.root, p), 'utf8')) });
      assert.deepEqual(res.summary, want);
      assert.ok(want.percent < 100 && want.readChars > 0);
      assert.ok(res.summary.missing.some((m) => m.path === PARTLY && m.spans[0][0] === 4));
      assert.deepEqual(res.files, g.ledger.files);
    });
  } finally { g.done(); }
});

test('sections: whole, or one part with its generated block in the map language', async () => {
  const g = await generated();
  try {
    await withServer({ root: g.root, smDir: g.smDir, arch: { lang: 'pt' } }, async ({ port }) => {
      assert.deepEqual((await call(port, 'GET', `${base}/sections`)).body, g.sections);
      const orders = (await call(port, 'GET', `${base}/sections?part=orders`)).body;
      assert.deepEqual(Object.keys(orders.parts), ['orders']);
      assert.deepEqual(orders.parts.orders, g.sections.parts.orders);
      assert.deepEqual(orders.coverage, g.sections.coverage);
      assert.ok(orders.block.startsWith(GENERATED_START));
      assert.match(orders.block, new RegExp(`censo rev ${g.census.rev}`));
      const ids = new Set(Object.values(g.sections.parts.orders).flat().map((i) => i.id));
      assert.ok(orders.gaps.every((x) => ids.has(x.id)));
      const ghost = (await call(port, 'GET', `${base}/sections?part=ghost`)).body;
      assert.deepEqual(ghost.parts, {});
      assert.equal(ghost.block, null);
    });
  } finally { g.done(); }
});

test('tree: the repository with what came in after a rev marked new, in under 300 ms', async () => {
  const g = await generated();
  try {
    await withServer({ root: g.root, smDir: g.smDir }, async ({ port }) => {
      const res = (await call(port, 'GET', `${base}/tree?since=1`)).body;
      assert.equal(res.rev, g.census.rev);
      assert.equal(res.listing, 'git');
      const find = (node, path) => (node.path === path ? node : (node.children ?? []).map((c) => find(c, path)).find(Boolean));
      assert.equal(find(res.tree, EXTRA).new, true);
      assert.equal(find(res.tree, 'apps/api/src/server.ts').new, false);
      assert.equal(find(res.tree, 'apps/admin').noOwner, true);
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        assert.equal((await call(port, 'GET', `${base}/tree`)).status, 200);
        best = Math.min(best, performance.now() - t);
      }
      assert.ok(best < 300, `tree took ${best} ms`);
    });
  } finally { g.done(); }
});

test('the .env of the project never shows in any answer', async () => {
  const g = await generated();
  try {
    await withServer({ root: g.root, smDir: g.smDir }, async ({ port }) => {
      const asks = [...READS, 'census?folder=.', 'census?part=_none', 'facts?file=.env', 'facts?kind=env', 'tree?since=0', 'sections?part=_none'];
      for (const what of asks) {
        const res = await call(port, 'GET', `${base}/${what}`);
        assert.ok(!res.text.includes(SECRET), what);
      }
    });
  } finally { g.done(); }
});

test('--demo: reads come from demo/foundation, writes are 403', async () => {
  await withServer({ demo: true, root: '/home/dev/code/acme-shop' }, async ({ port }) => {
    const census = await call(port, 'GET', `${base}/census`);
    assert.equal(census.status, 200);
    assert.deepEqual(census.body, JSON.parse(readFileSync(join(DEMO_DIR, ID, 'census.json'), 'utf8')));
    assert.ok((await call(port, 'GET', `${base}/census/log`)).body.length > 0);
    const tree = (await call(port, 'GET', `${base}/tree`)).body;
    assert.equal(tree.listing, 'census', 'no git run on a made-up root');
    assert.ok(tree.tree.children.length > 0);
    assert.ok((await call(port, 'GET', `${base}/facts?kind=route`)).body.facts.length > 0);
    assert.equal((await call(port, 'GET', `${base}/ledger`)).status, 200);
    assert.ok((await call(port, 'GET', `${base}/sections?part=orders`)).body.block);
    const post = await call(port, 'POST', `${base}/refresh`, { body: {} });
    assert.equal(post.status, 403);
    assert.equal(post.body.error, 'demo');
  });
});

// ---------- the demo files keep the contract (00-contratos.md § 1, 2, 3 and the sections.json of block 1) ----------

const demoFile = (name) => readFileSync(join(DEMO_DIR, ID, name), 'utf8');
const demoJson = (name) => JSON.parse(demoFile(name));
const keys = (o) => Object.keys(o).sort();
const LINES = ['blank', 'code', 'comment', 'total'];
const SUM = ['bytes', 'chars', 'files', 'lines', 'words'];

// Block 5 (B5-T12) owns four more demo files in the same folder; nothing else may land there.
test('demo: the five files of the B1 contract, plus only the guide files of block 5', () => {
  const B1 = ['census-log.jsonl', 'census.json', 'facts.json', 'read-ledger.json', 'sections.json'];
  const B5 = ['compass.json', 'ideas.json', 'practices.json', 'profile.json'];
  const names = readdirSync(join(DEMO_DIR, ID));
  for (const name of B1) assert.ok(names.includes(name), `missing ${name}`);
  assert.deepEqual(names.filter((n) => !B1.includes(n) && !B5.includes(n)), [], 'only B1 and B5 files');
});

test('demo census.json keeps the census contract and its sums add up', () => {
  const c = demoJson('census.json');
  assert.deepEqual(keys(c), ['excluded', 'files', 'generatedAt', 'head', 'rev', 'sums', 'tool', 'version']);
  assert.equal(c.version, 1);
  assert.ok(Number.isInteger(c.rev) && c.rev > 0);
  const FILE = ['bytes', 'chars', 'included', 'kind', 'lines', 'mtime', 'owner', 'path', 'reason', 'sha', 'type', 'words'];
  for (const f of c.files) {
    assert.deepEqual(keys(f), FILE, f.path);
    if (f.included) {
      assert.deepEqual(keys(f.lines), LINES, f.path);
      assert.equal(f.lines.code + f.lines.comment + f.lines.blank, f.lines.total, f.path);
      assert.match(f.sha, /^[0-9a-f]{16}$/);
    } else {
      assert.equal(f.lines, null, f.path);
      assert.ok(['dep', 'generated', 'binary', 'secret'].includes(f.reason), f.path);
    }
  }
  assert.deepEqual(keys(c.sums), ['folders', 'parts', 'total']);
  assert.deepEqual(keys(c.sums.total), SUM);
  const inc = c.files.filter((f) => f.included);
  assert.equal(c.sums.total.files, inc.length);
  assert.equal(c.sums.total.lines.total, inc.reduce((n, f) => n + f.lines.total, 0));
  assert.equal(Object.values(c.sums.parts).reduce((n, p) => n + p.files, 0), c.sums.total.files, 'parts add up to the total');
  assert.ok(c.sums.parts._none, 'files with no owner have their own line');
  for (const [dir, s] of Object.entries(c.sums.folders)) assert.equal(s.files, inc.filter((f) => f.path.startsWith(`${dir}/`)).length, dir);
});

test('demo census-log.jsonl lines keep the statement contract', () => {
  const lines = demoFile('census-log.jsonl').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length >= 2);
  for (const l of lines) {
    assert.deepEqual(keys(l), ['added', 'at', 'changed', 'from', 'removed', 'rev', 'totals']);
    for (const a of [...l.added, ...l.removed]) assert.deepEqual(keys(a), ['chars', 'lines', 'path']);
    for (const ch of l.changed) assert.deepEqual(keys(ch), ['after', 'before', 'path']);
    assert.deepEqual(keys(l.totals), ['after', 'before']);
  }
  assert.equal(lines.at(-1).rev, demoJson('census.json').rev);
  assert.ok(lines.some((l) => l.changed.length) && lines.some((l) => l.added.length), 'the statement shows something in and something changed');
});

test('demo read-ledger.json keeps the ledger contract against the demo census', () => {
  const l = demoJson('read-ledger.json');
  const census = demoJson('census.json');
  assert.deepEqual(keys(l), ['files', 'generatedAt', 'summary', 'version']);
  for (const [path, e] of Object.entries(l.files)) {
    assert.deepEqual(keys(e), ['reads', 'sha', 'spans'], path);
    assert.equal(e.sha, census.files.find((f) => f.path === path)?.sha, `${path} is read at the census sha`);
    for (const r of e.reads) assert.deepEqual(keys(r), ['at', 'model', 'run']);
  }
  assert.deepEqual(keys(l.summary), ['missing', 'percent', 'readChars', 'totalChars']);
  // Whole files only, so the summary needs no text: what the route will answer is what is stored.
  assert.deepEqual(l.summary, ledgerSummary(l, census, { lineChars: () => null }));
  assert.ok(l.summary.percent > 0 && l.summary.percent < 100);
});

test('demo facts.json keeps the facts contract and points into the demo census', () => {
  const f = demoJson('facts.json');
  const census = demoJson('census.json');
  const counted = new Map(census.files.filter((x) => x.included).map((x) => [x.path, x]));
  assert.deepEqual(keys(f), ['censusRev', 'facts', 'files', 'generatedAt', 'version']);
  assert.equal(f.censusRev, census.rev);
  for (const [path, e] of Object.entries(f.files)) {
    assert.deepEqual(keys(e), ['extractor', 'factIds', 'sha'], path);
    assert.equal(e.sha, counted.get(path)?.sha, path);
  }
  const ids = new Set();
  for (const x of f.facts) {
    assert.deepEqual(keys(x), ['attrs', 'extractor', 'file', 'id', 'kind', 'line', 'name', 'origin', 'refs', 'sha'], x.id);
    assert.ok(KINDS.includes(x.kind), x.kind);
    assert.ok(ORIGINS.includes(x.origin), x.origin);
    assert.ok(!ids.has(x.id), `one fact per id: ${x.id}`);
    ids.add(x.id);
    const row = counted.get(x.file);
    assert.ok(row, x.file);
    assert.ok(x.line >= 1 && x.line <= row.lines.total, `${x.id} line`);
  }
  for (const k of ['route', 'screen', 'table', 'queue', 'env', 'function']) assert.ok(f.facts.some((x) => x.kind === k), k);
});

test('demo sections.json keeps the sections contract', () => {
  const s = demoJson('sections.json');
  assert.ok(['censusRev', 'coverage', 'gaps', 'generatedAt', 'ownerCheck', 'parts', 'version'].every((k) => k in s));
  assert.equal(s.censusRev, demoJson('census.json').rev);
  assert.deepEqual(keys(s.coverage), ['owned', 'routes', 'screens', 'tables']);
  for (const v of Object.values(s.coverage)) assert.ok(v === null || (v >= 0 && v <= 1));
  assert.deepEqual(keys(s.ownerCheck), ['facts', 'files', 'ok']);
  for (const p of Object.values(s.parts)) assert.deepEqual(keys(p), ['configs', 'integrations', 'jobs', 'routes', 'screens', 'tables']);
  for (const x of s.gaps) assert.deepEqual(keys(x), ['file', 'id', 'kind', 'line', 'reason']);
});

test('demo files hold nothing personal, no machine path and no secret', () => {
  for (const name of readdirSync(join(DEMO_DIR, ID))) {
    const text = demoFile(name);
    for (const bad of [SECRET, 'sm-fixture', 'AppData', 'C:/', 'C:\\', '/tmp/', 'Users', 'danie']) assert.ok(!text.includes(bad), `${name}: ${bad}`);
  }
});
