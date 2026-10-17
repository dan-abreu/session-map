import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { deriveSpecialists } from '../server/ai/specialists.mjs';
import { roleBrief } from '../server/ai/agents-run.mjs';
import { roleOf } from '../server/ai/agents.mjs';

// The other engines get the domain specialist's card (id158, or68): named by id or found from the files the work touches.

const FILES = {
  'README.md': '# Parts\n\n## Engine\n\n- [Alpha](alpha.md)\n- [Beta](beta.md)\n',
  'alpha.md': '# Alpha\n\nAlpha works.\n\n## Where in the code\n\n- `server/alpha/`\n\n## Rules that must not break\n\n- Alpha rule.\n\n## What\'s missing\n\n- [ ] x `al01`\n',
  'beta.md': '# Beta\n\nBeta works.\n\n## Where in the code\n\n- `server/beta/`\n\n## What\'s missing\n\n- [ ] y `be01`\n',
};
const arch = parseArch('docs/architecture', FILES, 'worktree');
const specialists = deriveSpecialists({ arch, readPart: (p) => FILES[p.file.split('/').pop()], files: [] });
const TASK = 'fix the header, run the tests';

async function withServer(specialistsOf, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-spec-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-spec-sm-'));
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...(args ?? [])]); return { stdout: 'done' }; };
  const app = createApp({
    dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => ({ generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] }),
    helpers: {}, runAi: { exec, bin: (n) => n === 'codex', specialistsOf, keyOf: async () => 'sk-test-key-1234' },
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (body) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/ai/run', headers: { 'x-session-map-token': token, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ kind: 'code', provider: 'openai', task: TASK, cwd: 'C:/repo', ...body }));
  });
  try {
    await fn({ call, calls });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}

// Codex runs as `node <its script> exec … <brief>` (id171): the brief is the last argument.
const briefOf = (calls) => calls.find((c) => c[0] === process.execPath && c.includes('exec'))?.at(-1) ?? '';

test('roleBrief puts the card between the role line and the task, and is unchanged without a card', () => {
  const coder = roleOf('code');
  const brief = roleBrief(coder, TASK, 'CARD');
  assert.ok(brief.indexOf('session-map-role: coder') < brief.indexOf('CARD') && brief.indexOf('CARD') < brief.indexOf(TASK));
  assert.equal(roleBrief(coder, TASK), roleBrief(coder, TASK, ''));
});

test('a run named for a specialist carries its card to the other AI; the answer says who worked', async () => {
  await withServer(async () => ({ ok: true, arch, specialists }), async ({ call, calls }) => {
    const r = await call({ specialist: 'sm-alpha' });
    assert.equal(r.status, 200);
    assert.equal(r.json.specialist, 'sm-alpha');
    const brief = briefOf(calls);
    assert.match(brief, /^session-map-role: coder /);
    assert.match(brief, /You own the "Alpha" part/);
    assert.match(brief, /Alpha rule\./);
    assert.ok(brief.endsWith(TASK));
  });
});

test('the files the work touches pick the specialist; an unknown id and a project without a map are refused', async () => {
  await withServer(async () => ({ ok: true, arch, specialists }), async ({ call, calls }) => {
    const byFiles = await call({ files: ['server/beta/b.mjs'] });
    assert.equal(byFiles.json.specialist, 'sm-beta');
    assert.match(briefOf(calls), /You own the "Beta" part/);
    const unknown = await call({ specialist: 'sm-nope' });
    assert.deepEqual([unknown.status, unknown.json.error], [400, 'unknown-specialist']);
    const noMatch = await call({ files: ['elsewhere/x.mjs'] });
    assert.equal(noMatch.json.specialist, null, 'files no part owns run with the role alone');
  });
  await withServer(async () => ({ ok: false, error: 'no-map' }), async ({ call }) => {
    const r = await call({ specialist: 'sm-alpha' });
    assert.deepEqual([r.status, r.json.error], [400, 'no-specialists']);
  });
});

test('a run that names no specialist is what it was: the role alone', async () => {
  await withServer(async () => { throw new Error('must not be asked'); }, async ({ call, calls }) => {
    const r = await call({});
    assert.equal(r.status, 200);
    assert.equal(r.json.specialist, null);
    assert.doesNotMatch(briefOf(calls), /You own the/);
  });
});

test('files that are not a list of paths are refused, not ignored; the specialist wins over files', async () => {
  await withServer(async () => ({ ok: true, arch, specialists }), async ({ call }) => {
    for (const files of ['server/beta/b.mjs', [{ a: 1 }], [1]]) {
      const r = await call({ files });
      assert.deepEqual([r.status, r.json.error], [400, 'bad-files']);
    }
    const both = await call({ specialist: 'sm-alpha', files: ['server/beta/b.mjs'] });
    assert.equal(both.json.specialist, 'sm-alpha');
  });
});
