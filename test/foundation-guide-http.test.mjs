import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToken } from '../server/auth.mjs';
import { createApp } from '../server/main.mjs';
import { readFd, writeFd } from '../server/foundation/store.mjs';

// B5-T12: the guide's routes (profile, practices, compass, ideas, /api/library) behind the gates of index § 3.

const ID = 'acme-shop-8324f1';
const P = `/api/foundation/${ID}`;
const DEMO = fileURLToPath(new URL('../demo/foundation/acme-shop-8324f1/', import.meta.url));
const KNOWLEDGE = fileURLToPath(new URL('../knowledge/', import.meta.url));
const pkgOf = (id) => JSON.parse(readFileSync(join(KNOWLEDGE, `${id}.json`), 'utf8'));
const NOW = '2026-10-10T12:00:00.000Z';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'sm-fdguide-root-'));
  writeFileSync(join(root, 'README.md'), '# acme-shop\n\nThe shop of Ana.\n');
  writeFileSync(join(root, 'package.json'), '{\n  "name": "acme-shop",\n  "dependencies": {\n    "next": "^16.0.1"\n  }\n}\n');
  writeFileSync(join(root, '.env'), 'STRIPE_KEY=sk_live_never_read\n');
  return root;
}

const CENSUS = {
  version: 1, generatedAt: NOW, rev: 1, head: null, tool: 'own',
  files: [
    { path: 'README.md', type: 'md', kind: 'doc', included: true, reason: null, lines: { total: 3, code: 2, comment: 0, blank: 1 }, owner: null },
    { path: 'package.json', type: 'json', kind: 'code', included: true, reason: null, lines: { total: 6, code: 6, comment: 0, blank: 0 }, owner: null },
    { path: '.env', type: 'other', kind: 'secret', included: false, reason: 'secret', lines: null, owner: null },
  ],
};

async function withApp(fn, { demo = false } = {}) {
  const root = makeRepo();
  const dir = mkdtempSync(join(tmpdir(), 'sm-fdguide-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdguide-sm-'));
  const state = { projects: [{ id: ID, name: 'acme-shop', root, arch: null, workCells: [], chats: [] }] };
  const token = demo ? 'f'.repeat(64) : loadToken(smDir);
  const app = createApp({ dir, smDir, demo, chat: null, token, collectFn: () => state });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const host = `127.0.0.1:${port}`;
  const call = (method, path, { body, raw, cookie = true, header = true } = {}) => new Promise((resolve, reject) => {
    const headers = { host };
    if (cookie) headers.cookie = `sm_token=${token}`;
    if (method !== 'GET') Object.assign(headers, { origin: `http://${host}`, 'content-type': 'application/json', ...(header ? { 'x-session-map': '1' } : {}) });
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let parsed = text;
        try { parsed = JSON.parse(text); } catch { /* plain text */ }
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.on('error', reject);
    req.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
  try {
    await fn({ call, root, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    for (const d of [dir, root, smDir]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const READS = ['profile', 'practices', 'compass', 'ideas'];
const enc = encodeURIComponent;

test('every read needs the token, an unknown project is 404, and nothing computed yet is 200 null', async () => {
  await withApp(async ({ call }) => {
    for (const what of READS) {
      assert.equal((await call('GET', `${P}/${what}`, { cookie: false })).status, 401, what);
      const res = await call('GET', `${P}/${what}`);
      assert.equal(res.status, 200, what);
      assert.equal(res.body, null, `${what} before the first round`);
      const unknown = await call('GET', `/api/foundation/nobody-000000/${what}`);
      assert.equal(unknown.status, 404);
      assert.equal(unknown.body.error, 'unknown-project');
    }
    assert.equal((await call('GET', `/api/library?project=${ID}`, { cookie: false })).status, 401);
    const lib = await call('GET', '/api/library?project=nobody-000000');
    assert.equal(lib.status, 404);
    assert.equal(lib.body.error, 'unknown-project');
    assert.equal((await call('GET', `/api/library?project=${enc('../acme')}`)).status, 404);
  });
});

test('writes need the header and the body stays under 64 KB', async () => {
  await withApp(async ({ call, smDir }) => {
    assert.equal((await call('PUT', `${P}/profile`, { body: { owner: { country: 'BR' } }, header: false })).status, 403);
    assert.equal((await call('POST', `${P}/idea`, { body: { text: 'add a report' }, header: false })).status, 403);
    assert.equal((await call('POST', `${P}/idea`, { raw: JSON.stringify({ text: 'x', pad: 'y'.repeat(70 * 1024) }) })).status, 413);
    assert.equal(readFd(smDir, ID, 'profile.json', null), null, 'a refused write left nothing');
    assert.equal(readFd(smDir, ID, 'ideas.json', null), null);
  });
});

test('PUT profile takes only the owner, refuses a bad value with bad-owner, and recomputes the guide', async () => {
  await withApp(async ({ call, smDir }) => {
    writeFd(smDir, ID, 'census.json', CENSUS);
    const bad = await call('PUT', `${P}/profile`, { body: { owner: { money: 'lottery' } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'bad-owner');
    const sneaky = await call('PUT', `${P}/profile`, { body: { owner: { country: 'BR' }, detected: { types: ['game'] } } });
    assert.equal(sneaky.status, 400, 'only `owner` may be sent');
    assert.equal(sneaky.body.error, 'bad-owner');
    assert.equal((await call('PUT', `${P}/profile`, { body: [] })).body.error, 'bad-owner');
    assert.equal(readFd(smDir, ID, 'profile.json', null), null, 'refused patches wrote nothing');

    const ok = await call('PUT', `${P}/profile`, { body: { owner: { country: 'br', money: 'subscription' } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.owner.country, 'BR');
    assert.equal(ok.body.owner.money, 'subscription');
    assert.deepEqual(ok.body.effective.laws, ['LGPD']);
    assert.ok(ok.body.questions.every((q) => q.key !== 'money' && q.key !== 'country'));
    const stored = readFd(smDir, ID, 'profile.json', null);
    assert.equal(stored.owner.money, 'subscription');
    assert.ok(stored.detected.stacks.some((s) => s.name === 'next'), 'the detection ran on the project');
    assert.ok(readFd(smDir, ID, 'practices.json', null), 'practices recomputed');
    assert.ok(readFd(smDir, ID, 'compass.json', null), 'compass recomputed');
    const again = await call('GET', `${P}/profile`);
    assert.equal(again.body.owner.money, 'subscription');
  });
});

test('GET practices and compass join the texts from the library by id, never from the files on disk', async () => {
  await withApp(async ({ call, smDir }) => {
    const next = pkgOf('stack-next').items.find((i) => i.id === 'next.supported-version');
    const legal = pkgOf('legal-lgpd-br');
    writeFd(smDir, ID, 'practices.json', {
      version: 1, generatedAt: NOW, profileHash: '0'.repeat(16),
      items: [
        { id: next.id, pkg: 'stack-next', front: 'operation', ladder: 'N2', severity: 'E', state: 'unverified', reason: 'no-data', evidence: [], attested: null,
          text: { title: { en: 'EVIL' } }, title: { en: 'EVIL' } },
        { id: 'nobody.knows', pkg: '../../../etc/passwd', front: 'security', ladder: 'N0', severity: 'E', state: 'fail', reason: null, evidence: [], attested: null },
      ],
      ladder: { level: null, provisional: false, nextPercent: 0, byFront: {} },
    });
    const pr = await call('GET', `${P}/practices`);
    assert.equal(pr.status, 200);
    const [known, unknown] = pr.body.items;
    assert.equal(known.text.title.en, next.title.en);
    assert.equal(known.text.doneWhen['pt-BR'], next.doneWhen['pt-BR']);
    assert.equal(known.source.url, next.source.url);
    assert.equal(known.effort, next.effort);
    assert.ok(!('title' in known), 'a field written on disk is not passed along');
    assert.ok(!pr.text.includes('EVIL'));
    assert.equal(unknown.text, null, 'an id the library does not know has no text (and is never a path)');

    writeFd(smDir, ID, 'compass.json', {
      version: 1, generatedAt: NOW, stage: { key: 'prototype', origin: 'guessed', reason: 'no-data' },
      stages: ['idea', 'prototype', 'first-client', 'growth', 'company'], fronts: [],
      next3: [{ itemId: next.id, front: 'operation', example: { params: { app: 'web' } }, ask: { text: { en: 'a', 'pt-BR': 'b' }, skills: [], role: 'operations' } }],
      disclaimers: ['legal-lgpd-br', '../evil'],
    });
    const co = await call('GET', `${P}/compass`);
    assert.equal(co.status, 200);
    const [first] = co.body.next3;
    assert.equal(first.text.title['pt-BR'], next.title['pt-BR']);
    assert.equal(first.text.example.en, next.example.en.replace('{app}', 'web'));
    assert.deepEqual(co.body.disclaimers, ['legal-lgpd-br', '../evil'], 'the contract field is kept');
    assert.deepEqual(co.body.notices, [{ pkg: 'legal-lgpd-br', text: legal.disclaimer }]);
  });
});

test('POST idea classifies and saves; GET ideas shows it with stages, level and what blocks it', async () => {
  await withApp(async ({ call, smDir }) => {
    assert.equal((await call('POST', `${P}/idea`, { body: { text: '' } })).body.error, 'bad-idea');
    assert.equal((await call('POST', `${P}/idea`, { body: { text: { en: 'x' } } })).body.error, 'bad-idea');
    assert.equal((await call('POST', `${P}/idea`, { body: { text: 'add a report', size: 'huge' } })).body.error, 'bad-idea');
    const res = await call('POST', `${P}/idea`, { body: { text: 'cobrar por assinatura' } });
    assert.equal(res.status, 200);
    assert.match(res.body.id, /^idea:[0-9a-f]{8}$/);
    assert.equal(res.body.size, 'large');
    assert.ok(res.body.sensitive.includes('money'));
    assert.ok(res.body.checks.length > 0);
    assert.ok(res.body.checks.every((c) => ['pass', 'fail', 'unverified', 'na'].includes(c.state)));
    const stored = readFd(smDir, ID, 'ideas.json', null);
    assert.equal(stored.version, 1);
    assert.equal(stored.ideas.length, 1);
    assert.ok(!('stages' in stored.ideas[0]), 'the file keeps the contract shape');
    const list = await call('GET', `${P}/ideas`);
    const [idea] = list.body.ideas;
    assert.equal(idea.id, res.body.id);
    assert.equal(idea.stages.length, 14);
    assert.ok(idea.stages.every((s) => typeof s.applies === 'boolean' && s.reason?.msg), 'each stage says why it shows or hides');
    assert.equal(idea.level.provisional, true);
    assert.equal(idea.canDone.ok, false);
    assert.ok(idea.checks.every((c) => typeof c.text === 'string' && c.text.length > 0), 'each check carries the standard text');
  });
});

test('POST idea/:iid attests, refuses done with an essential open, accepts it explicitly, reopens and resizes', async () => {
  await withApp(async ({ call, smDir }) => {
    const { body: idea } = await call('POST', `${P}/idea`, { body: { text: 'login com Google' } });
    const at = (action, extra = {}) => call('POST', `${P}/idea/${enc(idea.id)}`, { body: { action, ...extra } });
    assert.equal((await call('POST', `${P}/idea/${enc('idea:00000000')}`, { body: { action: 'reopen' } })).body.error, 'unknown-idea');
    assert.equal((await call('POST', `${P}/idea/${enc('../ideas')}`, { body: { action: 'reopen' } })).status, 404);
    assert.equal((await at('fly')).body.error, 'bad-idea');
    const missing = await at('attest', { checkId: '99.nope', note: 'ok', days: 30 });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'unknown-check');
    const check = idea.checks.find((c) => c.state === 'unverified');
    assert.equal((await at('attest', { checkId: check.id, note: 'x'.repeat(301), days: 30 })).body.error, 'bad-idea');
    assert.equal((await at('attest', { checkId: check.id, note: 'ok', days: 0 })).body.error, 'bad-idea');
    assert.equal((await at('attest', { checkId: check.id, note: 'ok', days: 366 })).body.error, 'bad-idea');
    const attested = await at('attest', { checkId: check.id, note: 'Ana checked it', days: 30 });
    assert.equal(attested.status, 200);
    const after = attested.body.checks.find((c) => c.id === check.id);
    assert.equal(after.state, 'pass');
    assert.equal(after.attest.note, 'Ana checked it');

    const essential = attested.body.checks.some((c) => c.state === 'unverified' && c.severity === 'E');
    assert.ok(essential, 'the idea still has an essential check nobody verified');
    const refused = await at('done');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, 'essential-failed');
    assert.equal(readFd(smDir, ID, 'ideas.json', null).ideas[0].status, 'open');
    const done = await at('done', { acceptUnverified: true });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'done');
    assert.ok(done.body.acceptedUnverified.length > 0);
    const reopened = await at('reopen');
    assert.equal(reopened.body.status, 'open');
    assert.equal(reopened.body.doneAt, null);
    const resized = await at('resize', { size: 'trivial', sensitive: [] });
    assert.equal(resized.body.size, 'trivial');
    assert.deepEqual(resized.body.origin, { size: 'owner', sensitive: 'owner' });
    assert.ok(resized.body.checks.length < done.body.checks.length, 'a trivial idea walks fewer stages');
    assert.ok(resized.body.stages.some((s) => !s.applies && s.reason.msg === 'std.reason.outOfSize'), 'hidden stages come with the reason');
    assert.equal((await at('resize', { size: 'giant' })).body.error, 'bad-idea');
  });
});

test('an essential check that failed blocks done even with acceptUnverified', async () => {
  await withApp(async ({ call, smDir }) => {
    const { body: idea } = await call('POST', `${P}/idea`, { body: { text: 'login com Google' } });
    const essential = new Set(idea.checks.filter((c) => c.severity === 'E').map((c) => c.id));
    // A practice of the library that covers an essential check of this idea (linked by its `standard` ids), failing here.
    const pkgs = readdirSync(KNOWLEDGE).filter((n) => n.endsWith('.json')).map((n) => pkgOf(n.slice(0, -5)));
    const found = pkgs.flatMap((pkg) => pkg.items.map((item) => ({ pkg, item })))
      .find(({ item }) => (item.standard ?? []).some((s) => essential.has(s)));
    assert.ok(found, 'some practice covers an essential check of a login idea');
    const { pkg, item } = found;
    writeFd(smDir, ID, 'practices.json', {
      version: 1, generatedAt: NOW, profileHash: '0'.repeat(16),
      items: [{ id: item.id, pkg: pkg.id, front: item.front, ladder: item.ladder, severity: item.severity, state: 'fail', reason: null, evidence: [{ file: 'README.md', line: 1 }], attested: null }],
      ladder: { level: null, provisional: false, nextPercent: 0, byFront: {} },
    });
    const list = await call('GET', `${P}/ideas`);
    const failed = list.body.ideas[0].checks.filter((c) => c.state === 'fail');
    assert.ok(failed.some((c) => essential.has(c.id)), 'the failing practice reaches the idea through the library link');
    assert.ok(failed.every((c) => c.evidence.some((e) => e.file === 'README.md')));
    const blocked = await call('POST', `${P}/idea/${enc(idea.id)}`, { body: { action: 'done', acceptUnverified: true } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'essential-failed');
  });
});

test('POST practice/:id attests a practice and keeps it through the recompute', async () => {
  await withApp(async ({ call, smDir }) => {
    assert.equal((await call('POST', `${P}/practice/x`, { body: { action: 'attest', note: 'ok' } })).body.error, 'unknown-check');
    writeFd(smDir, ID, 'census.json', CENSUS);
    assert.equal((await call('PUT', `${P}/profile`, { body: { owner: { country: 'BR' } } })).status, 200);
    const doc = readFd(smDir, ID, 'practices.json', null);
    const manual = doc.items.find((i) => i.state === 'unverified' && i.reason === 'needs-human');
    assert.ok(manual, 'a practice waits for a person');
    const p = (id, body) => call('POST', `${P}/practice/${enc(id)}`, { body });
    const dots = await p('../x', { action: 'attest', note: 'ok' });
    assert.equal(dots.status, 400, 'an id with .. is refused, never a path');
    assert.equal(dots.body.error, 'bad-idea', 'refused by its shape, before any lookup');
    assert.equal((await p(manual.id, { action: 'launch' })).body.error, 'bad-idea');
    assert.equal((await p(manual.id, { action: 'attest', note: 'x'.repeat(301) })).body.error, 'bad-idea');
    const res = await p(manual.id, { action: 'attest', note: 'Ana looked', days: 30 });
    assert.equal(res.status, 200);
    const item = res.body.items.find((i) => i.id === manual.id);
    assert.equal(item.state, 'pass');
    assert.equal(item.attested.note, 'Ana looked');
    assert.ok(item.text, 'the answer is the joined practices');
    assert.equal(readFd(smDir, ID, 'practices.json', null).items.find((i) => i.id === manual.id).attested.note, 'Ana looked');
  });
});

test('GET /api/library answers the applicable packages, gaps and invalid files without the local folder path', async () => {
  await withApp(async ({ call, smDir }) => {
    mkdirSync(join(smDir, 'knowledge'), { recursive: true });
    writeFileSync(join(smDir, 'knowledge', 'broken.json'), '{ not json');
    writeFd(smDir, ID, 'profile.json', {
      version: 1, generatedAt: NOW,
      detected: { types: ['web'], stacks: [{ name: 'next', version: '16.0.1', file: 'package.json', line: 4 }, { name: 'remix', version: '2.0.0', file: 'package.json', line: 5 }], signals: [], team: { kind: 'solo', authors: 1 }, deploy: [] },
      owner: { country: null, laws: [], money: null, audience: [], stage: null, types: [], team: null }, askedAt: null,
    });
    const res = await call('GET', `/api/library?project=${ID}`);
    assert.equal(res.status, 200);
    const ids = res.body.packages.map((p) => p.id);
    assert.ok(ids.includes('stack-next'));
    assert.ok(!ids.includes('stack-flutter'), 'only what applies to the profile');
    for (const p of res.body.packages) {
      assert.deepEqual(Object.keys(p).sort(), ['checkedAt', 'disclaimer', 'id', 'itemCount', 'kind', 'source', 'status', 'title']);
    }
    assert.ok(res.body.gaps.some((g) => g.kind === 'stack' && g.name === 'remix'));
    assert.ok(Array.isArray(res.body.stale));
    assert.deepEqual(res.body.invalid.map((i) => i.file), ['broken.json']);
    assert.deepEqual(Object.keys(res.body.invalid[0]).sort(), ['error', 'file']);
    assert.ok(!res.text.includes(smDir.replace(/\\/g, '\\\\')) && !res.text.includes(smDir), 'never the local folder');
  });
});

test('--demo reads from demo/foundation and refuses every write with 403', async () => {
  await withApp(async ({ call }) => {
    for (const what of READS) {
      const res = await call('GET', `${P}/${what}`);
      assert.equal(res.status, 200, what);
      assert.ok(res.body, `${what} has demo data`);
    }
    const compass = (await call('GET', `${P}/compass`)).body;
    assert.equal(compass.next3.length, 3);
    assert.ok(compass.next3.every((n) => n.text && n.text.title.en), 'texts joined in the demo too');
    const lib = await call('GET', `/api/library?project=${ID}`);
    assert.equal(lib.status, 200);
    assert.ok(lib.body.packages.length > 0);
    for (const [method, path, body] of [['PUT', 'profile', { owner: { country: 'BR' } }], ['POST', 'idea', { text: 'add a report' }], ['POST', 'idea/idea:00000000', { action: 'reopen' }], ['POST', 'practice/x', { action: 'attest' }]]) {
      const res = await call(method, `${P}/${path}`, { body });
      assert.equal(res.status, 403, path);
      assert.equal(res.body.error, 'demo');
    }
  }, { demo: true });
});

test('the demo files are coherent: every evidence points at a file and line of the demo census', () => {
  const read = (name) => JSON.parse(readFileSync(join(DEMO, name), 'utf8'));
  const census = read('census.json');
  const lines = new Map(census.files.filter((f) => f.included).map((f) => [f.path, f.lines.total]));
  const evidence = [];
  const profile = read('profile.json');
  for (const s of profile.detected.stacks) evidence.push({ file: s.file, line: s.line });
  for (const s of profile.detected.signals) evidence.push(...s.evidence);
  for (const d of profile.detected.deploy) evidence.push(...d.evidence);
  const practices = read('practices.json');
  for (const i of practices.items) evidence.push(...i.evidence);
  const ideas = read('ideas.json');
  for (const idea of ideas.ideas) for (const c of idea.checks) evidence.push(...c.evidence);
  assert.ok(evidence.length > 0);
  for (const e of evidence) {
    // The git-repo practice points at `.git` when the census has a commit (B5-T9): not a census row, by design.
    if (e.file === '.git' && census.head && e.line === 1) continue;
    assert.ok(lines.has(e.file), `${e.file} is in the demo census`);
    assert.ok(Number.isInteger(e.line) && e.line >= 1 && e.line <= lines.get(e.file), `${e.file}:${e.line} exists`);
  }
  for (const doc of [profile, practices, read('compass.json'), ideas]) assert.equal(doc.version, 1);
  const compass = read('compass.json');
  const ids = new Set(practices.items.map((i) => i.id));
  assert.ok(compass.next3.every((n) => ids.has(n.itemId)), 'the route points at practices of the demo');
  assert.ok(ideas.ideas.some((i) => i.size === 'large' && i.sensitive.includes('money')));
  assert.ok(!JSON.stringify([profile, practices, compass, ideas]).match(/daniel|c:\/dev|\/users\//i), 'nothing personal');
});
