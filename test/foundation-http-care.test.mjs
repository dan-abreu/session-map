import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { loadToken } from '../server/auth.mjs';
import { createApp } from '../server/main.mjs';
import { applyOp, writeCare } from '../server/foundation/care.mjs';
import { runDocwatch } from '../server/foundation/docwatch.mjs';
import { readFindings, writeFindings } from '../server/foundation/findings.mjs';
import { fdDir, readFd, writeFd } from '../server/foundation/store.mjs';
import { careRoutes } from '../server/foundation/http/care.mjs';
import { createFoundationRoute } from '../server/foundation/http/index.mjs';

const ID = 'acme-shop-8324f1';
const OTHER = 'acme-blog-5a6b7c';
const P = `/api/foundation/${ID}`;

// A README of 320 lines in five H2 sections: past the README limit (200), so the watcher asks to split it.
function bigReadme() {
  const rows = ['# acme-shop', '', 'The shop of Ana.', ''];
  for (let s = 1; s <= 5; s++) {
    rows.push(`## Section ${s}`, '');
    for (let i = 0; rows.length < 4 + s * 63; i++) rows.push(`Line ${i} of section ${s}.`);
  }
  while (rows.length < 320) rows.push('Tail line.');
  return `${rows.join('\n')}\n`;
}

function makeRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(root, 'README.md'), bigReadme());
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n\nStart at `src/a.js#hello`.\n\nAlso `src/a.js#gone`.\n');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), '// acme\n\nexport function hello() {\n  return 1;\n}\n');
  writeFileSync(join(root, '.env'), 'STRIPE_KEY=sk_live_never_read\n');
  return root;
}

const CENSUS_FILES = [
  { path: 'README.md', type: 'md', kind: 'doc', included: true, reason: null, owner: null },
  { path: 'docs/guide.md', type: 'md', kind: 'doc', included: true, reason: null, owner: null },
  { path: 'src/a.js', type: 'js', kind: 'code', included: true, reason: null, owner: null },
  { path: '.env', type: 'other', kind: 'secret', included: false, reason: 'secret', owner: null },
];

// Every file under root with its bytes: "byte-identical" means this map is equal.
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(root, abs).split(sep).join('/')] = readFileSync(abs).toString('base64');
    }
  };
  walk(root);
  return out;
}

async function withApp(fn, { demo = false, smDir: given, root: givenRoot } = {}) {
  const root = givenRoot ?? makeRepo('sm-fdcare-root-');
  const other = makeRepo('sm-fdcare-other-');
  const dir = mkdtempSync(join(tmpdir(), 'sm-fdcare-dir-'));
  const smDir = given ?? mkdtempSync(join(tmpdir(), 'sm-fdcare-sm-'));
  const state = {
    projects: [
      { id: ID, name: 'acme-shop', root, arch: null, workCells: [], chats: [] },
      { id: OTHER, name: 'acme-blog', root: other, arch: null, workCells: [], chats: [] },
    ],
  };
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
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
  try {
    await fn({ call, root, other, smDir, state });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    const dirs = [dir, other, ...(givenRoot ? [] : [root]), ...(given ? [] : [smDir])];
    for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

// The watcher's real round on the fixture: findings.json with the README split finding, as refresh would leave it.
async function watch(smDir, root, id = ID) {
  writeFd(smDir, id, 'census.json', { version: 1, generatedAt: '2026-10-10T10:00:00.000Z', rev: 1, files: CENSUS_FILES });
  const out = await runDocwatch({ root, smDir, id, census: readFd(smDir, id, 'census.json', null), facts: null, config: {} });
  assert.ok(out.ok);
  const finding = readFindings(smDir, id).find((f) => f.rule === 'doc-size' && f.target.file === 'README.md');
  assert.ok(finding, 'the 320-line README is a doc-size finding');
  assert.equal(finding.fix.kind, 'split');
  return finding;
}

const enc = encodeURIComponent;

test('reads need the token, writes need the header, the project must exist, and nothing generated yet is 200 null', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('GET', `${P}/findings`, { cookie: false })).status, 401);
    assert.equal((await call('GET', `${P}/care`, { cookie: false })).status, 401);
    for (const what of ['findings', 'uptodate', 'docsize']) {
      const res = await call('GET', `${P}/${what}`);
      assert.equal(res.status, 200, what);
      assert.equal(res.body, null, `${what} before it exists`);
    }
    assert.deepEqual((await call('GET', `${P}/proposals`)).body, []);
    assert.deepEqual((await call('GET', `${P}/care`)).body, { mode: null, askedAt: null });
    const noHeader = await call('PUT', `${P}/care`, { body: { mode: 'auto' }, header: false });
    assert.equal(noHeader.status, 403);
    assert.deepEqual((await call('GET', `${P}/care`)).body.mode, null, 'a refused write left no mode');
    const unknown = await call('GET', '/api/foundation/nobody-000000/findings');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, 'unknown-project');
    const big = await call('PUT', `${P}/care`, { raw: JSON.stringify({ mode: 'auto', pad: 'x'.repeat(70 * 1024) }) });
    assert.equal(big.status, 413);
    assert.equal((await call('GET', `${P}/care`)).body.mode, null);
    const bad = await call('PUT', `${P}/care`, { body: { mode: 'yolo' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'bad-mode');
  });
});

test('--demo reads the invented files and refuses every write with 403', async () => {
  await withApp(async ({ call }) => {
    const read = await call('GET', `${P}/findings`);
    assert.equal(read.status, 200);
    assert.equal((await call('GET', `${P}/care`)).status, 200);
    for (const [method, what, body] of [['PUT', 'care', { mode: 'auto' }], ['POST', 'findings/f:000000000000', { action: 'later' }], ['POST', 'op/op:x/accept', {}], ['POST', 'op/op:x/undo', {}]]) {
      const res = await call(method, `${P}/${what}`, { body });
      assert.equal(res.status, 403, `${method} ${what}`);
      assert.equal(res.body.error, 'demo');
    }
  }, { demo: true });
});

test('the care mode survives a restart of the server, and askedAt is the first answer', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdcare-keep-'));
  const root = makeRepo('sm-fdcare-keep-root-');
  try {
    let askedAt;
    await withApp(async ({ call }) => {
      const put = await call('PUT', `${P}/care`, { body: { mode: 'suggest' } });
      assert.equal(put.status, 200);
      assert.equal(put.body.mode, 'suggest');
      askedAt = put.body.askedAt;
      assert.ok(askedAt);
    }, { smDir, root });
    await withApp(async ({ call }) => {
      assert.deepEqual((await call('GET', `${P}/care`)).body, { mode: 'suggest', askedAt });
      const put = await call('PUT', `${P}/care`, { body: { mode: 'auto' } });
      assert.deepEqual(put.body, { mode: 'auto', askedAt });
    }, { smDir, root });
  } finally {
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('suggest: accepting a finding keeps the repository byte-identical until the proposal is accepted; the body cannot choose files', async () => {
  await withApp(async ({ call, root, smDir }) => {
    const finding = await watch(smDir, root);
    const before = snapshot(root);
    assert.equal((await call('PUT', `${P}/care`, { body: { mode: 'suggest' } })).status, 200);
    const evil = {
      action: 'accept',
      files: [{ path: 'src/a.js', after: 'pwned' }, { path: 'evil.txt', after: 'pwned' }],
      op: { id: 'op:evil', kind: 'doc-update', files: [{ path: 'evil.txt', after: 'pwned' }] },
      after: 'pwned', path: 'src/a.js', mode: 'auto',
    };
    const res = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: evil });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'proposed');
    assert.notEqual(res.body.opId, 'op:evil');
    assert.equal(res.body.proposal.state, 'open');
    assert.ok(res.body.proposal.diff.some((d) => d.path === 'README.md'));
    assert.ok(res.body.proposal.diff.every((d) => !JSON.stringify(d).includes('pwned')), 'nothing from the body went into the proposal');
    assert.deepEqual(snapshot(root), before, 'suggest writes nothing');

    const list = await call('GET', `${P}/proposals`);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].op.id, res.body.opId);
    assert.equal((await call('GET', `${P}/findings`)).body.findings.find((f) => f.id === finding.id).state, 'accepted');

    const accept = await call('POST', `${P}/op/${enc(res.body.opId)}/accept`, { body: { files: [{ path: 'evil.txt', after: 'pwned' }] } });
    assert.equal(accept.status, 200, JSON.stringify(accept.body));
    assert.equal(accept.body.status, 'applied');
    const after = snapshot(root);
    assert.notDeepEqual(after, before);
    assert.ok(Object.keys(after).some((p) => p.startsWith('README/')), 'the pieces were written');
    assert.equal(existsSync(join(root, 'evil.txt')), false);
    assert.equal(after['src/a.js'], before['src/a.js']);
    assert.equal((await call('GET', `${P}/proposals?state=open`)).body.length, 0);
    const again = await call('POST', `${P}/op/${enc(res.body.opId)}/accept`, { body: {} });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'not-open');
  });
});

test('auto: accepting applies at once and op/:opId/undo gives back every byte (removing the new pieces asks for confirm)', async () => {
  await withApp(async ({ call, root, smDir }) => {
    const finding = await watch(smDir, root);
    const before = snapshot(root);
    await call('PUT', `${P}/care`, { body: { mode: 'auto' } });
    const res = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'accept' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'applied');
    assert.notDeepEqual(snapshot(root), before);
    const accepted = readFindings(smDir, ID).find((f) => f.id === finding.id);
    assert.equal(accepted.state, 'accepted');
    assert.equal(accepted.fix.opId, res.body.opId);

    const noConfirm = await call('POST', `${P}/op/${enc(res.body.opId)}/undo`, { body: {} });
    assert.equal(noConfirm.status, 409);
    assert.equal(noConfirm.body.error, 'needs-confirm');
    const undo = await call('POST', `${P}/op/${enc(res.body.opId)}/undo`, { body: { confirm: true } });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.ok(undo.body.restored.includes('README.md'));
    assert.deepEqual(snapshot(root), before, 'undo restores byte for byte');
    assert.equal(readFindings(smDir, ID).find((f) => f.id === finding.id).state, 'undone');
    const twice = await call('POST', `${P}/op/${enc(res.body.opId)}/undo`, { body: { confirm: true } });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error, 'already-undone');
  });
});

test('suggest: a proposal that went stale (changed-since) is turned down with op/:opId/dismiss and the finding answers again', async () => {
  await withApp(async ({ call, root, smDir }) => {
    const finding = await watch(smDir, root);
    const url = `${P}/findings/${enc(finding.id)}`;
    const stateOf = () => readFindings(smDir, ID).find((f) => f.id === finding.id).state;
    await call('PUT', `${P}/care`, { body: { mode: 'suggest' } });
    const res = await call('POST', url, { body: { action: 'accept' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'proposed');
    writeFileSync(join(root, 'README.md'), `${bigReadme()}Edited by Ana.\n`);
    const edited = snapshot(root);
    const stale = await call('POST', `${P}/op/${enc(res.body.opId)}/accept`, { body: { confirm: true } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'changed-since');

    const dismiss = await call('POST', `${P}/op/${enc(res.body.opId)}/dismiss`, { body: {} });
    assert.equal(dismiss.status, 200, JSON.stringify(dismiss.body));
    assert.equal(dismiss.body.state, 'dismissed');
    assert.equal(stateOf(), 'undone', 'the finding is free again');
    assert.deepEqual(snapshot(root), edited, 'turning a proposal down writes nothing in the repository');
    assert.equal((await call('GET', `${P}/proposals?state=open`)).body.length, 0);
    assert.equal((await call('GET', `${P}/proposals?state=dismissed`)).body.length, 1);

    const later = await call('POST', url, { body: { action: 'later' } });
    assert.equal(later.status, 200, JSON.stringify(later.body));
    assert.equal(later.body.finding.state, 'later');
    const again = await call('POST', url, { body: { action: 'accept' } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.status, 'proposed');
    assert.notEqual(again.body.opId, res.body.opId);
  });
});

test('dismiss without an edit: the repository stays the same, a dismissed proposal cannot be accepted or dismissed again, and the finding can be marked never', async () => {
  await withApp(async ({ call, root, smDir }) => {
    const finding = await watch(smDir, root);
    const before = snapshot(root);
    await call('PUT', `${P}/care`, { body: { mode: 'suggest' } });
    const res = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'accept' } });
    const op = `${P}/op/${enc(res.body.opId)}`;
    const dismiss = await call('POST', `${op}/dismiss`, { body: {} });
    assert.equal(dismiss.status, 200, JSON.stringify(dismiss.body));
    assert.deepEqual(snapshot(root), before);
    const accept = await call('POST', `${op}/accept`, { body: { confirm: true } });
    assert.equal(accept.status, 409);
    assert.equal(accept.body.error, 'not-open');
    const twice = await call('POST', `${op}/dismiss`, { body: {} });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error, 'not-open');
    assert.deepEqual(snapshot(root), before);
    const never = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'never' } });
    assert.equal(never.status, 200, JSON.stringify(never.body));
    assert.equal(never.body.finding.state, 'never');
  });
});

test('dismiss: an applied proposal stays accepted, a forged opId is 400 and an operation of another project is 404', async () => {
  await withApp(async ({ call, root, smDir, other }) => {
    const finding = await watch(smDir, root);
    await call('PUT', `${P}/care`, { body: { mode: 'suggest' } });
    const res = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'accept' } });
    assert.equal((await call('POST', `${P}/op/${enc(res.body.opId)}/accept`, { body: { confirm: true } })).status, 200);
    const late = await call('POST', `${P}/op/${enc(res.body.opId)}/dismiss`, { body: {} });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, 'not-open');
    assert.equal((await call('GET', `${P}/proposals?state=accepted`)).body.length, 1, 'still accepted');
    assert.equal(readFindings(smDir, ID).find((f) => f.id === finding.id).state, 'accepted');

    for (const forged of ['..%2F..%2Fcare', 'op%3A..%2Fx', 'op%3Aa%5Cb', 'x'.repeat(120)]) {
      const r = await call('POST', `${P}/op/${forged}/dismiss`, { body: {} });
      assert.equal(r.status, 400, forged);
      assert.equal(r.body.error, 'bad-id');
    }
    const theirs = applyOp({ id: OTHER, root: other }, { id: 'op:theirs', kind: 'doc-update', files: [{ path: 'docs/guide.md', after: '# Changed\n' }] }, { smDir, mode: 'suggest' });
    assert.equal(theirs.status, 'proposed');
    const r = await call('POST', `${P}/op/op%3Atheirs/dismiss`, { body: {} });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'not-found');
    assert.equal(readFd(smDir, OTHER, 'proposals/theirs.json', null).state, 'open', 'their proposal is untouched');
  });
});

test('pointers: only a document the census includes is read', async () => {
  await withApp(async ({ call, root, smDir }) => {
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'x', 'notes.md'), 'See `src/a.js#hello`.\n');
    assert.equal((await call('GET', `${P}/pointers?doc=docs/guide.md`)).body, null, 'no census yet: nothing to answer');
    await watch(smDir, root);
    assert.equal((await call('GET', `${P}/pointers?doc=docs/guide.md`)).status, 200);
    const outside = await call('GET', `${P}/pointers?doc=node_modules/x/notes.md`);
    assert.equal(outside.status, 404);
    assert.equal(outside.body.error, 'not-found');
  });
});

test('after Desfazer the finding can be accepted, put off or marked never again (and look leaves it undone)', async () => {
  await withApp(async ({ call, root, smDir }) => {
    const finding = await watch(smDir, root);
    const url = `${P}/findings/${enc(finding.id)}`;
    const stateOf = () => readFindings(smDir, ID).find((f) => f.id === finding.id).state;
    const acceptAndUndo = async () => {
      const res = await call('POST', url, { body: { action: 'accept' } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.status, 'applied');
      assert.equal(res.body.finding.state, 'accepted');
      assert.equal(res.body.finding.fix.opId, res.body.opId);
      const undo = await call('POST', `${P}/op/${enc(res.body.opId)}/undo`, { body: { confirm: true } });
      assert.equal(undo.status, 200, JSON.stringify(undo.body));
      assert.equal(stateOf(), 'undone');
      return res.body.opId;
    };
    await call('PUT', `${P}/care`, { body: { mode: 'auto' } });
    const first = await acceptAndUndo();
    const second = await acceptAndUndo();
    assert.notEqual(first, second, 'the second fix is a new operation');

    await call('PUT', `${P}/care`, { body: { mode: 'look' } });
    const look = await call('POST', url, { body: { action: 'accept', confirm: true } });
    assert.equal(look.body.error, 'look-only');
    assert.equal(stateOf(), 'undone', 'a refused accept does not move the finding');

    const later = await call('POST', url, { body: { action: 'later' } });
    assert.equal(later.status, 200, JSON.stringify(later.body));
    assert.equal(later.body.finding.state, 'later');
    await call('PUT', `${P}/care`, { body: { mode: 'auto' } });
    await acceptAndUndo();
    const never = await call('POST', url, { body: { action: 'never' } });
    assert.equal(never.status, 200, JSON.stringify(never.body));
    assert.equal(never.body.finding.state, 'never');
  });
});

test('refused writes leave an audit line too: forged ids and a finding that does not exist', async () => {
  const lines = [];
  const write = process.stderr.write;
  process.stderr.write = function capture(chunk, ...rest) {
    for (const row of String(chunk).split('\n')) {
      try { const j = JSON.parse(row); if (j.event === 'foundation-care-write') lines.push(j); } catch { /* not ours */ }
    }
    return write.call(this, chunk, ...rest);
  };
  try {
    await withApp(async ({ call }) => {
      await call('POST', `${P}/op/..%2F..%2Fcare/accept`, { body: {} });
      await call('POST', `${P}/op/..%2F..%2Fcare/undo`, { body: { confirm: true } });
      await call('POST', `${P}/findings/f%3A..%2Fx`, { body: { action: 'later' } });
      await call('POST', `${P}/findings/f%3A0123456789ab`, { body: { action: 'later' } });
    });
  } finally {
    process.stderr.write = write;
  }
  const seen = lines.map((l) => [l.what, l.id, l.error]);
  assert.deepEqual(seen, [
    ['op-accept', '../../care', 'bad-id'],
    ['op-undo', '../../care', 'bad-id'],
    ['finding', 'f:../x', 'bad-id'],
    ['finding', 'f:0123456789ab', 'not-found'],
  ]);
});

test('look (and a mode never chosen): accepting writes nothing and leaves the finding open', async () => {
  for (const mode of [null, 'look']) {
    await withApp(async ({ call, root, smDir }) => {
      const finding = await watch(smDir, root);
      const before = snapshot(root);
      if (mode) await call('PUT', `${P}/care`, { body: { mode } });
      const res = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'accept', confirm: true } });
      assert.equal(res.status, 409, String(mode));
      assert.equal(res.body.error, 'look-only');
      assert.deepEqual(snapshot(root), before);
      assert.equal(readFindings(smDir, ID).find((f) => f.id === finding.id).state, 'open');
      assert.deepEqual((await call('GET', `${P}/proposals`)).body, []);
    });
  }
});

test('a delete asks for confirm in the three modes; with confirm, look still writes nothing and auto deletes', async () => {
  await withApp(async ({ call, root, smDir }) => {
    const project = { id: ID, root };
    const op = { id: 'op:drop-guide', kind: 'delete', files: [{ path: 'docs/guide.md', after: null }] };
    // Only the server makes operations; a delete proposal is one it stored after the owner confirmed in suggest mode.
    assert.equal(applyOp(project, op, { smDir, mode: 'suggest', confirm: true }).status, 'proposed');
    for (const mode of ['auto', 'suggest', 'look']) {
      await call('PUT', `${P}/care`, { body: { mode } });
      const res = await call('POST', `${P}/op/op%3Adrop-guide/accept`, { body: {} });
      assert.equal(res.status, 409, mode);
      assert.equal(res.body.error, 'needs-confirm', mode);
      assert.ok(existsSync(join(root, 'docs', 'guide.md')));
    }
    await call('PUT', `${P}/care`, { body: { mode: 'look' } });
    const look = await call('POST', `${P}/op/op%3Adrop-guide/accept`, { body: { confirm: true } });
    assert.equal(look.body.error, 'look-only');
    assert.ok(existsSync(join(root, 'docs', 'guide.md')));
    await call('PUT', `${P}/care`, { body: { mode: 'auto' } });
    const auto = await call('POST', `${P}/op/op%3Adrop-guide/accept`, { body: { confirm: 'yes' } });
    assert.equal(auto.body.error, 'needs-confirm', 'only confirm: true counts');
    const done = await call('POST', `${P}/op/op%3Adrop-guide/accept`, { body: { confirm: true } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.status, 'applied');
    assert.equal(existsSync(join(root, 'docs', 'guide.md')), false);
  });
});

test('forged ids: ../ in an opId or fid is refused, and an operation of another project is not found here', async () => {
  await withApp(async ({ call, smDir, other }) => {
    await call('PUT', `${P}/care`, { body: { mode: 'auto' } });
    for (const forged of ['..%2F..%2Fcare', 'op%3A..%2Fx', '..', 'op%3A', '%2E%2E', 'op%3Aa%5Cb', 'x'.repeat(120)]) {
      for (const verb of ['accept', 'undo']) {
        const res = await call('POST', `${P}/op/${forged}/${verb}`, { body: { confirm: true } });
        assert.ok([400, 404].includes(res.status), `${forged} ${verb}: ${res.status}`);
        assert.notEqual(res.body.ok, true);
      }
    }
    assert.equal((await call('POST', `${P}/op/..%2F..%2Fcare/accept`, { body: {} })).body.error, 'bad-id');

    const theirs = applyOp({ id: OTHER, root: other }, { id: 'op:theirs', kind: 'doc-update', files: [{ path: 'docs/guide.md', after: '# Changed\n' }] }, { smDir, mode: 'suggest' });
    assert.equal(theirs.status, 'proposed');
    const before = snapshot(other);
    const res = await call('POST', `${P}/op/op%3Atheirs/accept`, { body: { confirm: true } });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not-found');
    assert.equal((await call('POST', `${P}/op/op%3Atheirs/undo`, { body: { confirm: true } })).status, 404);
    assert.deepEqual(snapshot(other), before);

    for (const fid of ['f%3A..%2F..%2Fx', 'nope', 'f%3AABCDEF000000', 'f%3A%2E%2E']) {
      const r = await call('POST', `${P}/findings/${fid}`, { body: { action: 'later' } });
      assert.equal(r.status, 400, fid);
      assert.equal(r.body.error, 'bad-id');
    }
    const missing = await call('POST', `${P}/findings/f%3A0123456789ab`, { body: { action: 'later' } });
    assert.equal(missing.status, 404);
    assert.equal((await call('GET', `${P}/findings/f%3A0123456789ab/estimate`)).status, 404);
  });
});

test('later and never only change the state; a wrong action or a move the state machine forbids is refused', async () => {
  await withApp(async ({ call, root, smDir }) => {
    const finding = await watch(smDir, root);
    const before = snapshot(root);
    const bad = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'delete' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'bad-action');
    const later = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'later' } });
    assert.equal(later.status, 200);
    assert.equal(later.body.finding.state, 'later');
    const never = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'never' } });
    assert.equal(never.body.finding.state, 'never');
    const back = await call('POST', `${P}/findings/${enc(finding.id)}`, { body: { action: 'accept' } });
    assert.equal(back.status, 409);
    assert.equal(back.body.error, 'bad-transition');
    assert.deepEqual(snapshot(root), before);
  });
});

test('estimate, uptodate, docsize and pointers answer from the stored files or work it out now', async () => {
  await withApp(async ({ call, root, smDir }) => {
    const finding = await watch(smDir, root);
    const est = await call('GET', `${P}/findings/${enc(finding.id)}/estimate`);
    assert.equal(est.status, 200);
    assert.equal(est.body.costUSD, 0, 'the program splits: no AI to pay');
    const aiFinding = readFindings(smDir, ID).find((f) => f.fix?.kind === 'ai-update');
    if (aiFinding) assert.ok((await call('GET', `${P}/findings/${enc(aiFinding.id)}/estimate`)).body.costUSD > 0);

    writeFd(smDir, ID, 'uptodate.json', { version: 1, generatedAt: 'x', lines: [{ id: 'g1.census-owners', group: 1, state: 'warning' }] });
    assert.equal((await call('GET', `${P}/uptodate`)).body.lines[0].id, 'g1.census-owners');

    const size = await call('GET', `${P}/docsize`);
    assert.equal(size.status, 200);
    const readme = size.body.docs.find((d) => d.path === 'README.md');
    assert.equal(readme.type, 'readme');
    assert.equal(readme.state, 'warning');
    assert.equal(readme.action, 'split');
    assert.ok(readme.lines >= 320, String(readme.lines));
    assert.ok(size.body.docs.every((d) => d.path !== '.env'));

    const ptr = await call('GET', `${P}/pointers?doc=docs/guide.md`);
    assert.equal(ptr.status, 200);
    assert.deepEqual(ptr.body.pointers.map((p) => [p.ptr, p.line, p.ok, p.target ?? p.why]), [
      ['src/a.js#hello', 3, true, 3],
      ['src/a.js#gone', 5, false, 'symbol-missing'],
    ]);
    writeFileSync(join(root, 'src', 'a.js'), '// acme\n// moved down\n\nexport function hello() {}\n');
    assert.equal((await call('GET', `${P}/pointers?doc=docs/guide.md`)).body.pointers[0].target, 4, 'the line is worked out on each call');
    assert.equal((await call('GET', `${P}/pointers?doc=../x.md`)).status, 400);
    assert.equal((await call('GET', `${P}/pointers`)).status, 400);
    assert.equal((await call('GET', `${P}/pointers?doc=.env`)).status, 400);
    assert.equal((await call('GET', `${P}/pointers?doc=src/a.js`)).status, 400);
    assert.equal((await call('GET', `${P}/pointers?doc=docs/none.md`)).status, 404);
  });
});

const TOKEN = 't'.repeat(64);
const GUIDE_FIXED = '# Guide\n\nStart at `src/a.js#hello`.\n';

// A pointer-broken finding on docs/guide.md whose fix the AI writes: where a wrong order of checks costs money.
function seedAiFinding(smDir) {
  writeFd(smDir, ID, 'census.json', { version: 1, generatedAt: 'x', rev: 1, files: CENSUS_FILES });
  const fid = 'f:aaaaaaaaaaaa';
  writeFindings(smDir, ID, [{
    id: fid, rule: 'pointer-broken', severity: 'important', target: { file: 'docs/guide.md', line: 5 }, evidence: [],
    what: { msg: 'watch.pointer-broken.what', params: { pointer: 'src/a.js#gone', why: 'symbol-missing' } },
    why: { msg: 'watch.pointer-broken.why' }, todo: { msg: 'watch.pointer-broken.todo' },
    fix: { kind: 'ai-update', opId: null }, state: 'open', firstSeen: 'x', lastSeen: 'x',
  }]);
  return fid;
}

// The dispatcher alone with the care routes (an injected AI), on a fresh repository and brain folder.
async function withDispatcher(fn, { ai, demo = false, demoDir } = {}) {
  const root = makeRepo('sm-fdcare-ai-');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-fdcare-ai-sm-'));
  const project = { id: ID, name: 'acme-shop', root };
  const handle = createFoundationRoute({ smDir, demo, demoDir, token: TOKEN, projects: async () => [project], modules: [{ routes: careRoutes({ ai }) }] });
  const run = async (method, path, body) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const req = Object.assign(fakeRequest(chunks), { method, headers: { cookie: `sm_token=${TOKEN}`, 'x-session-map': '1' } });
    let status;
    let text = '';
    const res = { headersSent: false, writeHead: (s) => { status = s; }, end: (t) => { text = t; } };
    await handle(req, res, new URL(`http://127.0.0.1${path}`));
    return { status, body: JSON.parse(text) };
  };
  try {
    await fn({ run, root, smDir });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const fixingAi = (prompts, { wait = 0, failFirst = false } = {}) => async (prompt) => {
  prompts.push(prompt);
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  if (failFirst && prompts.length === 1) return { ok: false, error: 'timeout' };
  return { ok: true, value: { after: GUIDE_FIXED }, costUSD: 0.01 };
};

test('an AI fix comes from the finding alone: whatever the AI or the body name, only the finding document is touched', async () => {
  const prompts = [];
  await withDispatcher(async ({ run, root, smDir }) => {
    const fid = seedAiFinding(smDir);
    writeCare(smDir, ID, 'auto');
    const before = snapshot(root);
    const res = await run('POST', `${P}/findings/${enc(fid)}`, { action: 'accept', files: [{ path: 'src/a.js', after: 'pwned' }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'applied');
    assert.deepEqual(res.body.files, ['docs/guide.md']);
    assert.equal(prompts.length, 1);
    const after = snapshot(root);
    assert.equal(after['src/a.js'], before['src/a.js']);
    assert.equal(readFileSync(join(root, 'docs', 'guide.md'), 'utf8'), GUIDE_FIXED);
  }, { ai: fixingAi(prompts) });
});

test('look (and a mode never chosen) refuses an AI fix before the AI is asked: nothing is spent', async () => {
  for (const mode of [null, 'look']) {
    const prompts = [];
    await withDispatcher(async ({ run, root, smDir }) => {
      const fid = seedAiFinding(smDir);
      if (mode) writeCare(smDir, ID, mode);
      const before = snapshot(root);
      const res = await run('POST', `${P}/findings/${enc(fid)}`, { action: 'accept', confirm: true });
      assert.equal(res.status, 409, String(mode));
      assert.equal(res.body.error, 'look-only');
      assert.equal(prompts.length, 0, `${mode}: the AI was not asked`);
      assert.deepEqual(snapshot(root), before);
      assert.equal(readFindings(smDir, ID)[0].state, 'open');
    }, { ai: fixingAi(prompts) });
  }
});

test('a second accept of the same finding while the first still runs is refused as busy: the AI is paid once', async () => {
  const prompts = [];
  await withDispatcher(async ({ run, smDir }) => {
    const fid = seedAiFinding(smDir);
    writeCare(smDir, ID, 'auto');
    const [a, b] = await Promise.all([
      run('POST', `${P}/findings/${enc(fid)}`, { action: 'accept' }),
      run('POST', `${P}/findings/${enc(fid)}`, { action: 'accept' }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
    assert.equal((a.status === 409 ? a : b).body.error, 'busy');
    assert.equal(prompts.length, 1, 'the AI was asked once');
    assert.equal(readdirSync(join(fdDir(smDir, ID), 'undo')).length, 1, 'one operation, one undo record');
    const third = await run('POST', `${P}/findings/${enc(fid)}`, { action: 'accept' });
    assert.equal(third.body.error, 'bad-transition', 'once the first is done the finding is no longer busy');
  }, { ai: fixingAi(prompts, { wait: 60 }) });
});

test('a failed AI fix frees the finding: the next accept is not busy', async () => {
  const prompts = [];
  await withDispatcher(async ({ run, smDir }) => {
    const fid = seedAiFinding(smDir);
    writeCare(smDir, ID, 'auto');
    const first = await run('POST', `${P}/findings/${enc(fid)}`, { action: 'accept' });
    assert.equal(first.status, 422);
    assert.equal(first.body.error, 'ai-failed');
    const second = await run('POST', `${P}/findings/${enc(fid)}`, { action: 'accept' });
    assert.equal(second.status, 200, JSON.stringify(second.body));
  }, { ai: fixingAi(prompts, { failFirst: true }) });
});

test('--demo answers care, findings and proposals from demo/foundation/<id>/, never from the brain folder', async () => {
  const demoDir = mkdtempSync(join(tmpdir(), 'sm-fdcare-demo-'));
  try {
    mkdirSync(join(demoDir, ID));
    const care = { mode: 'suggest', askedAt: '2026-10-01T09:00:00.000Z' };
    const findings = { version: 1, findings: [{ id: 'f:0123456789ab', rule: 'doc-size', state: 'open', target: { file: 'README.md' } }] };
    const proposals = [{ op: { id: 'op:demo-a' }, state: 'open' }, { op: { id: 'op:demo-b' }, state: 'accepted' }];
    writeFileSync(join(demoDir, ID, 'care.json'), JSON.stringify(care));
    writeFileSync(join(demoDir, ID, 'findings.json'), JSON.stringify(findings));
    writeFileSync(join(demoDir, ID, 'proposals.json'), JSON.stringify(proposals));
    await withDispatcher(async ({ run, smDir, root }) => {
      // What the real brain folder holds must not leak into the demo.
      writeCare(smDir, ID, 'auto');
      applyOp({ id: ID, root }, { id: 'op:real', kind: 'doc-update', files: [{ path: 'docs/guide.md', after: '# x\n' }] }, { smDir, mode: 'suggest' });
      assert.deepEqual((await run('GET', `${P}/care`)).body, care);
      assert.deepEqual((await run('GET', `${P}/findings`)).body, findings);
      assert.deepEqual((await run('GET', `${P}/proposals?state=open`)).body, [proposals[0]]);
      assert.deepEqual((await run('GET', `${P}/proposals`)).body, proposals);
      assert.equal((await run('PUT', `${P}/care`, { mode: 'look' })).status, 403);
    }, { demo: true, demoDir });
  } finally {
    await rm(demoDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test('--demo answers pointers from demo/foundation/<id>/pointers.json, keyed by document', async () => {
  const demoDir = mkdtempSync(join(tmpdir(), 'sm-fdcare-demo-'));
  try {
    mkdirSync(join(demoDir, ID));
    const rows = [{ line: 3, ptr: 'src/a.js#hello', path: 'src/a.js', symbol: 'hello', ok: true, target: 3 }];
    writeFileSync(join(demoDir, ID, 'pointers.json'), JSON.stringify({ 'docs/guide.md': rows }));
    await withDispatcher(async ({ run }) => {
      assert.deepEqual((await run('GET', `${P}/pointers?doc=docs/guide.md`)).body, { doc: 'docs/guide.md', pointers: rows });
      assert.deepEqual((await run('GET', `${P}/pointers?doc=README.md`)).body, { doc: 'README.md', pointers: [] });
      assert.deepEqual((await run('GET', `${P}/pointers?doc=constructor.md`)).body, { doc: 'constructor.md', pointers: [] });
    }, { demo: true, demoDir });
  } finally {
    await rm(demoDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

// A request stand-in for the dispatcher alone: emits the body chunks, then end.
function fakeRequest(chunks) {
  const listeners = {};
  const req = {
    on(event, fn) {
      listeners[event] = fn;
      if (event === 'end') queueMicrotask(() => { for (const c of chunks) listeners.data?.(c); listeners.end?.(); });
      return req;
    },
  };
  return req;
}
