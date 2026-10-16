import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { normalizePath, projectIdOf } from '../server/paths.mjs';
import { DEFAULT_PROJECT_CLASS, PROJECT_CLASSES, mergeProjectClasses, othersConfig, othersSettings, projectClassOf, projectClasses } from '../server/ai/others.mjs';
import { aiKeyHash } from '../server/ai/runner.mjs';
import { reviewPicks } from '../server/ai/helper.mjs';
import { forgetLife, lifeOf, placeChanged, settleAi } from '../server/ai/life.mjs';

// Sigilo por projeto: each project has a data class (client | internal | public) in config.json's
// ai.others.projectClass, the strictest ('client') when nothing is said. The map's bulk work sends the project's class,
// so a client project's conversations never reach an AI the router keeps client data from.

const ROOT_A = 'C:\\clients\\Shop';
const ROOT_B = 'C:\\mine\\Tool';
const KEY_A = normalizePath(ROOT_A);
const KEY_B = normalizePath(ROOT_B);

test('a project nobody classified is a client project, the strictest class', () => {
  assert.deepEqual([...PROJECT_CLASSES], ['client', 'internal', 'public']);
  assert.equal(DEFAULT_PROJECT_CLASS, 'client');
  assert.equal(projectClassOf(undefined, ROOT_A), 'client');
  assert.equal(projectClassOf({ others: {} }, ROOT_A), 'client');
  assert.equal(projectClassOf({ others: { projectClass: { [KEY_B]: 'public' } } }, ROOT_A), 'client');
  assert.deepEqual(projectClasses(undefined), {});
});

test('the class is read as written, by the normalized root, and a bad one is the strictest', () => {
  const ai = { others: { projectClass: { [KEY_A]: 'internal', [KEY_B]: 'public', 'c:/x': 'secret', 'c:/y': 7, '': 'public' } } };
  assert.equal(projectClassOf(ai, ROOT_A), 'internal');
  assert.equal(projectClassOf(ai, 'c:/CLIENTS/shop/'), 'internal', 'the same folder written another way');
  assert.equal(projectClassOf(ai, ROOT_B), 'public');
  assert.equal(projectClassOf(ai, 'C:/x'), 'client', 'an unknown class is client');
  assert.deepEqual(projectClasses(ai), { [KEY_A]: 'internal', [KEY_B]: 'public' }, 'only valid entries are shown');
  assert.deepEqual(projectClasses({ others: { projectClass: ['public'] } }), {});
  assert.deepEqual(projectClasses({ others: { projectClass: 'public' } }), {});
});

test('saving other settings keeps the classes, and a class change keeps the other settings', () => {
  const ai = { others: { enabled: true, dailyUSD: 2, off: ['openai'], projectClass: { [KEY_A]: 'internal' } } };
  const capOnly = othersConfig(ai, ['gemini'], { dailyUSD: 3 });
  assert.deepEqual(capOnly.others.projectClass, { [KEY_A]: 'internal' });
  const next = othersConfig(ai, ['gemini'], { projectClass: mergeProjectClasses(ai, { [KEY_B]: 'public', [KEY_A]: null }) });
  assert.deepEqual(next.others.projectClass, { [KEY_B]: 'public' });
  assert.equal(next.others.dailyUSD, 2);
  assert.deepEqual(next.others.off, ['openai']);
  assert.equal('projectClass' in othersConfig({}, [], { dailyUSD: 1 }).others, false, 'nothing said, nothing written');
  assert.equal('projectClass' in othersConfig(ai, [], { projectClass: {} }).others, false, 'an emptied map is not written');
  // The view of the settings keeps its shape.
  assert.deepEqual(Object.keys(othersSettings(ai, ['gemini'])).sort(), ['dailyUSD', 'enabled', 'keys', 'models', 'off']);
});

// ---- the bulk queue --------------------------------------------------------------------------------------------

const PARTS = { layers: [], parts: [{ id: 'orders', name: 'Orders', about: 'Builds the basket.', codePaths: [] }] };
const PARTS_KEYS = [['orders', 'Orders', 'Builds the basket.']];

// Digests whose place keys Claude will not review, so each call goes to one AI only.
function plainDigests(n) {
  const out = [];
  for (let i = 0; out.length < n; i++) {
    const digest = { title: `t${i}`, branch: null, prompts: [], files: [], commits: [] };
    if (!reviewPicks(aiKeyHash({ kind: 'place', digest, parts: PARTS_KEYS }))) out.push(digest);
  }
  return out;
}

async function withLife(config, fn) {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-pclass-'));
  const calls = { claude: 0, api: [] };
  const run = async () => { calls.claude++; return { ok: true, value: { partId: 'orders' }, costUSD: 0.01 }; };
  const apiRun = async (prompt, opts) => { calls.api.push(opts.provider); return { ok: true, value: { partId: 'orders' }, costUSD: 0.0001, provider: opts.provider }; };
  writeFileSync(join(smDir, 'ai-keys.json'), JSON.stringify({ version: 1, keys: { gemini: { scheme: 'fake', data: 'sealed', last4: 'cdef' } } }));
  if (config) writeFileSync(join(smDir, 'config.json'), JSON.stringify(config));
  try {
    const life = lifeOf(smDir, {}, { bin: 'fake-claude', run, apiRun, keyOf: async () => 'sk-gemini-0123456789abcdef' });
    await fn({ smDir, life, calls });
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
}

const jobsFor = (digests, tag) => digests.map((digest, i) => ({ sessionId: `${tag}${i}`, digest }));

test('the bulk work of an unclassified project goes to the other AIs too: the class is only a label', async () => {
  await withLife(null, async ({ smDir, life, calls }) => {
    const p = { smDir, projectId: projectIdOf(ROOT_A), arch: PARTS };
    placeChanged(life, p, jobsFor(plainDigests(1), 'a'));
    await settleAi(smDir);
    assert.deepEqual(calls.api, ['gemini'], 'a direct Gemini key takes it as well');
    assert.equal(calls.claude, 0);
  });
});

test('client and internal projects alike send their bulk work to the other AIs', async () => {
  const config = { ai: { others: { projectClass: { [KEY_A]: 'client', [KEY_B]: 'internal' } } } };
  await withLife(config, async ({ smDir, life, calls }) => {
    const [d1, d2] = plainDigests(2);
    placeChanged(life, { smDir, projectId: projectIdOf(ROOT_A), arch: PARTS }, [{ sessionId: 'shop', digest: d1 }]);
    await settleAi(smDir);
    assert.deepEqual(calls.api, ['gemini']);
    assert.equal(calls.claude, 0);
    placeChanged(life, { smDir, projectId: projectIdOf(ROOT_B), arch: PARTS }, [{ sessionId: 'tool', digest: d2 }]);
    await settleAi(smDir);
    assert.deepEqual(calls.api, ['gemini', 'gemini']);
    assert.equal(calls.claude, 0);
  });
});

test('a class changed on the page is read by the next job without a restart, and keeps the work going to the other AIs', async () => {
  await withLife(null, async ({ smDir, life, calls }) => {
    const p = { smDir, projectId: projectIdOf(ROOT_B), arch: PARTS };
    const [d1, d2] = plainDigests(2);
    placeChanged(life, p, [{ sessionId: 'a', digest: d1 }]);
    await settleAi(smDir);
    assert.deepEqual(calls.api, ['gemini']);
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { projectClass: { [KEY_B]: 'public' } } } }));
    placeChanged(life, p, [{ sessionId: 'b', digest: d2 }]);
    await settleAi(smDir);
    assert.deepEqual(calls.api, ['gemini', 'gemini']);
  });
});

// ---- the settings route ----------------------------------------------------------------------------------------

const backend = { scheme: 'fake', seal: async (plain) => `sealed:${plain}`, open: async (sealed) => sealed.slice(7) };

async function withServer(fn, { seed } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-pclass-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-pclass-sm-'));
  if (seed) seed(smDir);
  const state = { generatedAt: new Date().toISOString(), waitingCount: 0, projects: [{ id: projectIdOf(ROOT_A), name: 'Shop', root: ROOT_A }, { id: projectIdOf(ROOT_B), name: 'Tool', root: ROOT_B }] };
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => state, helpers: { backend, apiRun: async () => ({ ok: true, value: {}, costUSD: 0 }) } });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, cookie: `sm_token=${token}`, ...(method !== 'GET' ? { origin: `http://127.0.0.1:${port}`, 'x-session-map': '1', 'content-type': 'application/json' } : {}) };
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await fn({ call, smDir });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

const URL_ = '/api/settings/ai-helpers';
const saved = (smDir) => JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8')).ai?.others?.projectClass;

test('GET shows the classes chosen so far and the class of everything else', async () => {
  await withServer(async ({ call }) => {
    const r = await call('GET', URL_);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.projectClass, {});
    assert.equal(r.json.projectClassDefault, 'client');
    assert.deepEqual(r.json.projectClasses, ['client', 'internal', 'public']);
    // The page needs the server's folder rule to spell a root the same way (Windows ignores case and reads /c/ as c:).
    assert.equal(r.json.pathRule, process.platform === 'win32' ? 'windows' : 'posix');
  });
  await withServer(async ({ call }) => {
    assert.deepEqual((await call('GET', URL_)).json.projectClass, { [KEY_A]: 'internal' });
  }, { seed: (smDir) => writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { projectClass: { [KEY_A]: 'internal' } } } })) });
});

test('POST saves the class of known projects, keyed by the normalized root, and keeps the rest of the settings', async () => {
  await withServer(async ({ call, smDir }) => {
    assert.equal((await call('POST', URL_, { dailyUSD: 2 })).status, 200);
    const r = await call('POST', URL_, { projectClass: { [ROOT_B]: 'public', [ROOT_A]: 'internal' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.projectClass, { [KEY_A]: 'internal', [KEY_B]: 'public' });
    assert.deepEqual(saved(smDir), { [KEY_A]: 'internal', [KEY_B]: 'public' });
    assert.equal(r.json.others.dailyUSD, 2);
    // One at a time works too, and null goes back to the default.
    const one = await call('POST', URL_, { projectClass: { [ROOT_A]: null } });
    assert.deepEqual(one.json.projectClass, { [KEY_B]: 'public' });
    // A later cap change keeps the classes.
    const cap = await call('POST', URL_, { dailyUSD: 4 });
    assert.deepEqual(cap.json.projectClass, { [KEY_B]: 'public' });
  });
});

test('POST refuses an unknown project, an unknown class and a wrong shape, and writes nothing', async () => {
  await withServer(async ({ call, smDir }) => {
    const unknown = await call('POST', URL_, { projectClass: { 'C:\\nowhere': 'public' } });
    assert.deepEqual([unknown.status, unknown.json.error], [400, 'unknown-project']);
    const badClass = await call('POST', URL_, { projectClass: { [ROOT_A]: 'secret' } });
    assert.deepEqual([badClass.status, badClass.json.error], [400, 'bad-project-class']);
    for (const bad of ['public', ['public'], null, 7]) {
      const r = await call('POST', URL_, { projectClass: bad });
      assert.deepEqual([r.status, r.json.error], [400, 'bad-project-class'], JSON.stringify(bad));
    }
    // One bad entry spoils the whole request: the good one beside it is not saved.
    const mixed = await call('POST', URL_, { projectClass: { [ROOT_A]: 'public', 'C:\\nowhere': 'public' } });
    assert.equal(mixed.status, 400);
    assert.throws(() => readFileSync(join(smDir, 'config.json')), /ENOENT/);
    const proto = await call('POST', URL_, { projectClass: JSON.parse('{"__proto__": "public"}') });
    assert.equal(proto.status, 400);
  });
});
