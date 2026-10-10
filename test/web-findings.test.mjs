import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { translator } from '../server/web/i18n.js';
import { createFindingsView, diffRows, findingRows, findingWords, sensitiveFiles, usdWords } from '../server/web/findingsview.js';
import findingsTexts from '../server/web/i18n-fd/care-findings.js';

const WEB = new URL('../server/web/', import.meta.url);

// The page dictionary does not hold this file yet (the block integration merges it), so the test layers it on top.
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : `{${k}}`));
function tFor(lang) {
  const base = translator(lang);
  const t = (k, v) => (findingsTexts[lang][k] !== undefined ? fill(findingsTexts[lang][k], v) : base(k, v));
  t.count = base.count;
  return t;
}

// The parameters each rule may use, fixed by the contract of block 3 (bloco-3.md).
const RULES = {
  'doc-cites-missing': ['name', 'kind', 'doc'],
  'code-without-doc': ['file', 'count', 'names'],
  'docs-disagree': ['a', 'b', 'what'],
  'version-mismatch': ['where', 'found', 'expected'],
  'stale-image': ['image', 'screen'],
  'doc-size': ['doc', 'lines', 'kb', 'limit', 'type'],
  'pointer-broken': ['pointer', 'why'],
  'owner-missing': ['folder', 'count'],
};

const finding = (id, over = {}) => ({
  id, rule: 'doc-cites-missing', severity: 'important', state: 'open',
  target: { file: 'docs/api.md', line: 33 }, evidence: [],
  what: { msg: 'watch.doc-cites-missing.what', params: { name: 'GET /orders', kind: 'route', doc: 'docs/api.md' } },
  why: { msg: 'watch.doc-cites-missing.why' }, todo: { msg: 'watch.doc-cites-missing.todo' },
  fix: { kind: 'ai-update', opId: null }, firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-01-02T00:00:00Z', ...over,
});

test('findingRows groups by severity, keeps later apart, hides never and what is already done', () => {
  const list = [
    finding('a', { severity: 'detail' }), finding('b', { severity: 'grave' }), finding('c', { state: 'later' }),
    finding('d', { state: 'never' }), finding('e', { state: 'applied' }), finding('f', { state: 'undone' }),
    finding('g', { state: 'accepted' }),
  ];
  const sections = findingRows(list);
  assert.deepEqual(sections.map((s) => s.id), ['grave', 'important', 'detail', 'later']);
  assert.deepEqual(sections.map((s) => s.rows.map((r) => r.id)), [['b'], ['g'], ['a'], ['c']]);
  const all = sections.flatMap((s) => s.rows.map((r) => r.id));
  for (const gone of ['d', 'e', 'f']) assert.ok(!all.includes(gone), `${gone} stays hidden`);
});

test('findingRows leaves empty sections out, sorts by file and line, and filters by rule', () => {
  const list = [
    finding('x', { target: { file: 'docs/b.md', line: 2 } }), finding('y', { target: { file: 'docs/a.md', line: 9 } }),
    finding('z', { target: { file: 'docs/a.md', line: 3 } }), finding('s', { rule: 'doc-size', severity: 'detail' }),
  ];
  assert.deepEqual(findingRows(list, { rule: 'doc-size' }).map((s) => s.id), ['detail']);
  assert.deepEqual(findingRows(list)[0].rows.map((r) => r.id), ['z', 'y', 'x']);
  assert.deepEqual(findingRows([]), []);
  assert.deepEqual(findingRows(null), []);
  assert.deepEqual(findingRows([finding('w', { severity: 'made-up' })]).map((s) => s.id), ['detail'], 'an unknown severity falls to the lightest');
});

test('diffRows of a split lists the pieces, the index and the files whose links change', () => {
  const proposal = {
    op: { id: 'op:1', kind: 'doc-split', findingId: 'f1', sensitive: false },
    diff: [
      { path: 'docs/guide.md', before: '# Guide\n## One\nx\n## Two\ny\n', after: '# Guide\n- [One](guide/one.md)\n- [Two](guide/two.md)\n' },
      { path: 'docs/guide/one.md', before: null, after: '## One\nx\n' },
      { path: 'docs/guide/two.md', before: null, after: '## Two\ny\n' },
      { path: 'README.md', before: 'See [guide](docs/guide.md#one)\n', after: 'See [guide](docs/guide/one.md)\n' },
    ],
  };
  const rows = diffRows(proposal);
  assert.deepEqual(rows.map((r) => [r.path, r.kind, r.role]), [
    ['docs/guide.md', 'edit', 'index'], ['docs/guide/one.md', 'create', 'piece'],
    ['docs/guide/two.md', 'create', 'piece'], ['README.md', 'edit', 'links'],
  ]);
  assert.deepEqual(rows[1].lines, [{ sign: '+', text: '## One' }, { sign: '+', text: 'x' }]);
  assert.deepEqual([rows[1].added, rows[1].removed], [2, 0]);
  assert.deepEqual(rows[3].lines.filter((l) => l.sign !== ' ').map((l) => l.sign), ['-', '+']);
});

test('diffRows marks removed files, keeps context short and cuts very long files', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 20', 'LINE 20');
  const [edit] = diffRows({ op: { kind: 'doc-update' }, diff: [{ path: 'docs/a.md', before, after }] });
  assert.equal(edit.role, 'file');
  assert.deepEqual(edit.lines.filter((l) => l.sign !== ' ').map((l) => l.text), ['line 20', 'LINE 20']);
  assert.ok(edit.lines.length <= 8, 'only a few lines around the change');
  const [gone] = diffRows({ op: { kind: 'delete' }, diff: [{ path: 'docs/old.md', before: 'a\nb\n', after: null }] });
  assert.equal(gone.kind, 'delete');
  assert.deepEqual(gone.lines.map((l) => l.sign), ['-', '-']);
  const long = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n');
  const [big] = diffRows({ op: {}, diff: [{ path: 'new.md', before: null, after: long }] });
  assert.equal(big.added, 500);
  assert.ok(big.lines.length < 500 && big.cut > 0, 'a long new file is cut, with the number hidden');
  assert.deepEqual(diffRows(null), []);
  assert.deepEqual(diffRows({ diff: 'nope' }), []);
});

test('sensitiveFiles names what a proposal would remove', () => {
  const proposal = { op: { sensitive: false }, diff: [{ path: 'a.md', before: 'x', after: null }, { path: 'b.md', before: 'x', after: 'y' }] };
  assert.deepEqual(sensitiveFiles(proposal), ['a.md']);
  assert.deepEqual(sensitiveFiles({ op: { sensitive: true }, diff: [{ path: 'b.md', before: 'x', after: 'y' }] }), ['b.md'], 'a sensitive operation lists all its files');
  assert.deepEqual(sensitiveFiles({ op: {}, diff: [{ path: 'b.md', before: 'x', after: 'y' }] }), []);
});

test('usdWords never shows a cost of zero', () => {
  assert.equal(usdWords(0.0412), '0.04');
  assert.equal(usdWords(1.5), '1.50');
  assert.equal(usdWords(0.0004), '0.01');
  assert.equal(usdWords(0), '0.01');
});

test('every rule has what, why and todo in both languages, using only the parameters of the contract', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  for (const [rule, allowed] of Object.entries(RULES)) {
    for (const part of ['what', 'why', 'todo']) {
      const key = `watch.${rule}.${part}`;
      for (const lang of ['en', 'pt-BR']) {
        const text = findingsTexts[lang][key];
        assert.ok(typeof text === 'string' && text.trim(), `${key} in ${lang}`);
        for (const v of vars(text)) assert.ok(allowed.includes(v), `${key} in ${lang} uses {${v}}, not in the contract`);
      }
      assert.deepEqual(vars(findingsTexts['pt-BR'][key]).sort(), vars(findingsTexts.en[key]).sort(), `${key} blanks differ`);
    }
  }
  const watchKeys = Object.keys(findingsTexts.en).filter((k) => k.startsWith('watch.'));
  assert.equal(watchKeys.length, 8 * 3, 'no text for a rule the contract does not have');
});

test('the findings texts have the same keys and blanks in en and pt-BR, and repeat no other text', async () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(findingsTexts['pt-BR']).sort(), Object.keys(findingsTexts.en).sort());
  for (const [k, v] of Object.entries(findingsTexts.en)) {
    assert.ok(findingsTexts['pt-BR'][k]?.trim() && v.trim(), `${k} is empty`);
    assert.deepEqual(vars(findingsTexts['pt-BR'][k]), vars(v), `${k} blanks differ`);
  }
  const source = readFileSync(new URL('i18n.js', WEB), 'utf8');
  const start = source.indexOf('const en = {');
  const base = new Set([...source.slice(start, source.indexOf('\n};', start)).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]));
  const others = new Set();
  // care.js will merge this file later (block integration), so it is not "another" owner.
  for (const file of readdirSync(new URL('i18n-fd/', WEB))) {
    if (['care-findings.js', 'care.js'].includes(file)) continue;
    const { default: part } = await import(new URL(`i18n-fd/${file}`, WEB));
    for (const k of Object.keys(part.en ?? {})) others.add(k);
  }
  for (const k of Object.keys(findingsTexts.en)) {
    assert.ok(!base.has(k), `${k} is already in i18n.js`);
    assert.ok(!others.has(k), `${k} is already in another text file`);
    assert.match(k, /^(findings|watch)\./, `${k} stays in the findings namespace`);
  }
});

test('findingWords fills the texts with the parameters of the finding, in plain words', () => {
  const words = findingWords(finding('a'), tFor('en'));
  assert.match(words.what, /GET \/orders/);
  assert.match(words.what, /docs\/api\.md/);
  assert.doesNotMatch(`${words.what} ${words.why} ${words.todo}`, /\{\w+\}/, 'no blank is left');
  assert.match(words.what, /route/i, 'the kind of thing is said in words');
  const pointer = findingWords(finding('p', { rule: 'pointer-broken', what: { msg: 'x', params: { pointer: 'src/a.ts#run', why: 'symbol-missing' } } }), tFor('pt-BR'));
  assert.doesNotMatch(pointer.what, /symbol-missing/, 'the reason code is turned into words');
  assert.doesNotMatch(pointer.what, /\{\w+\}/);
});

test('the findings style sheet exists and keeps to the colors of the app', () => {
  const css = new URL('css/fd-care-findings.css', WEB);
  assert.ok(existsSync(css));
  const text = readFileSync(css, 'utf8');
  assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, 'colors come from the variables of style.css');
  assert.doesNotMatch(text, /border-(left|right):\s*[2-9]/, 'no stripe on a side');
});

// ----- the view, without a browser: a tiny element tree and a fake server -----

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.rawArgs = c; this.children = kids(c); } });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const buttons = (root) => walk(root).filter((n) => n.tag === 'button');
const button = (root, re) => buttons(root).find((b) => re.test(textOf(b)));

function fakeServer(routes) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: decodeURIComponent(path), body });
    const hit = routes(init.method, decodeURIComponent(path), body);
    return { ok: (hit?.status ?? 200) < 400, status: hit?.status ?? 200, json: async () => (hit ? hit.body : null) };
  };
  return { calls, restore: () => { globalThis.fetch = saved; } };
}

function makeView(mode, extra = {}) {
  const t = tFor('en');
  const opened = [];
  const view = createFindingsView({
    h, t: () => t, project: () => ({ id: 'acme-shop-8324f1' }), careMode: () => mode, errorText: (c) => `error:${c}`,
    openFile: (path, line) => opened.push([path, line]), ...extra,
  });
  const root = h('div');
  return { view, root, opened, screen: () => ({ tag: 'div', attrs: {}, children: root.children }) };
}

const PROPOSAL = {
  op: { id: 'op:1', kind: 'doc-update', findingId: 'f1', sensitive: false },
  mode: 'suggest', createdAt: '2026-01-02T00:00:00Z', state: 'open',
  diff: [{ path: 'docs/api.md', before: 'GET /orders\nold\n', after: 'new\n' }],
};

test('suggest mode: the estimate is shown before anything starts, then the proposal, then apply', async () => {
  let proposals = [];
  const server = fakeServer((method, path, body) => {
    if (path.endsWith('/findings') && method === 'GET') return { body: [finding('f1')] };
    if (path.endsWith('/proposals')) return { body: proposals };
    if (path.endsWith('/findings/f1/estimate')) return { body: { usd: 0.0412 } };
    if (path.endsWith('/findings/f1') && method === 'POST') { proposals = [PROPOSAL]; return { body: { ok: true, status: 'proposed', opId: 'op:1' } }; }
    if (path.endsWith('/op/op:1/accept')) { proposals = []; return { body: { ok: true, status: 'applied', opId: 'op:1' } }; }
    return { status: 404, body: { error: 'not-found' } };
  });
  try {
    const { view, root, screen } = makeView('suggest');
    await view.render(root);
    assert.match(textOf(screen()), /GET \/orders/);
    assert.ok(button(screen(), /Update with AI/), 'the AI button is there');
    assert.ok(button(screen(), /Not now/) && button(screen(), /Never/));
    assert.equal(server.calls.filter((c) => c.method === 'POST').length, 0);

    await button(screen(), /Update with AI/).attrs.onclick();
    assert.match(textOf(screen()), /0\.04/, 'the estimate is on the screen');
    assert.equal(server.calls.filter((c) => c.method === 'POST').length, 0, 'nothing started before the owner agrees');

    await button(screen(), /Yes, go ahead/).attrs.onclick();
    const post = server.calls.find((c) => c.method === 'POST');
    assert.deepEqual(post.body, { action: 'accept' }, 'the client sends only the word, never a text');
    assert.match(textOf(screen()), /Proposed change/);
    assert.match(textOf(screen()), /docs\/api\.md/);

    await button(screen(), /Apply/).attrs.onclick();
    const apply = server.calls.at(-3) ?? server.calls.find((c) => c.path.endsWith('/op/op:1/accept'));
    assert.ok(server.calls.some((c) => c.path.endsWith('/op/op:1/accept') && c.method === 'POST'));
    assert.deepEqual(server.calls.find((c) => c.path.endsWith('/op/op:1/accept')).body, {});
    assert.match(textOf(screen()), /Changes/, 'says where to see and undo it');
    assert.ok(apply);
  } finally { server.restore(); }
});

test('auto mode: one click applies, no estimate step', async () => {
  const server = fakeServer((method, path) => {
    if (path.endsWith('/findings') && method === 'GET') return { body: [finding('f1')] };
    if (path.endsWith('/proposals')) return { body: [] };
    if (method === 'POST') return { body: { ok: true, status: 'applied', opId: 'op:9' } };
    return { status: 404, body: { error: 'not-found' } };
  });
  try {
    const { view, root, screen } = makeView('auto');
    await view.render(root);
    await button(screen(), /Update with AI/).attrs.onclick();
    assert.equal(server.calls.filter((c) => c.method === 'POST').length, 1);
    assert.ok(!server.calls.some((c) => c.path.endsWith('/estimate')));
    assert.match(textOf(screen()), /Changes/);
  } finally { server.restore(); }
});

test('look only and not-asked-yet: nothing can be accepted, and the screen says why', async () => {
  for (const mode of ['look', null]) {
    const server = fakeServer((method, path) => (path.endsWith('/findings') ? { body: [finding('f1')] } : { body: [] }));
    try {
      const { view, root, screen } = makeView(mode);
      await view.render(root);
      assert.ok(button(screen(), /Update with AI/).attrs.disabled, `disabled in ${mode}`);
      assert.match(textOf(screen()), mode ? /Look only/ : /Choose how/);
      assert.ok(!button(screen(), /Not now/).attrs.disabled, 'saying "not now" writes nothing, so it works');
    } finally { server.restore(); }
  }
});

test('"Not now" and "Never" send the word and reload the list', async () => {
  let list = [finding('f1'), finding('f2', { rule: 'doc-size', severity: 'detail', fix: { kind: 'doc-split', opId: null }, what: { msg: 'x', params: { doc: 'README.md', lines: 320, kb: 12, limit: 300, type: 'readme' } } })];
  const server = fakeServer((method, path, body) => {
    if (path.endsWith('/findings') && method === 'GET') return { body: list };
    if (path.endsWith('/proposals')) return { body: [] };
    if (method === 'POST') { list = list.filter((f) => f.id !== path.split('/').at(-1)); return { body: { ok: true } }; }
    return { status: 404, body: {} };
  });
  try {
    const { view, root, screen } = makeView('suggest');
    await view.render(root);
    const card = walk(screen()).filter((n) => n.tag === 'li' && /GET \/orders/.test(textOf(n)))[0];
    await button(card, /Not now/).attrs.onclick();
    assert.deepEqual(server.calls.find((c) => c.method === 'POST').body, { action: 'later' });
    assert.doesNotMatch(textOf(screen()), /GET \/orders/, 'gone from the list after the reload');
    await button(screen(), /Never/).attrs.onclick();
    assert.deepEqual(server.calls.filter((c) => c.method === 'POST').at(-1).body, { action: 'never' });
  } finally { server.restore(); }
});

test('a proposal that removes files asks for confirmation naming them, and only then sends confirm', async () => {
  const removal = { ...PROPOSAL, op: { id: 'op:2', kind: 'delete', findingId: 'f1', sensitive: true }, diff: [{ path: 'docs/old.md', before: 'x\n', after: null }] };
  const server = fakeServer((method, path) => {
    if (path.endsWith('/findings') && method === 'GET') return { body: [finding('f1', { state: 'accepted' })] };
    if (path.endsWith('/proposals')) return { body: [removal] };
    if (path.endsWith('/op/op:2/accept')) return { body: { ok: true, status: 'applied', opId: 'op:2' } };
    return { status: 404, body: {} };
  });
  try {
    const { view, root, screen } = makeView('suggest');
    await view.render(root);
    await button(screen(), /Apply/).attrs.onclick();
    assert.equal(server.calls.filter((c) => c.method === 'POST').length, 0, 'asked first');
    assert.match(textOf(screen()), /docs\/old\.md/);
    await button(screen(), /Yes, go ahead/).attrs.onclick();
    assert.deepEqual(server.calls.find((c) => c.method === 'POST').body, { confirm: true });
  } finally { server.restore(); }
});

test('the server saying needs-confirm, look-only or refused becomes words, never a silent success', async () => {
  for (const [answer, expect] of [[{ ok: true, status: 'look-only' }, /Look only/], [{ ok: false, status: 'refused', error: 'secret-file' }, /secret/i], [{ ok: true, status: 'needs-confirm', opId: 'op:3' }, /Yes, go ahead/]]) {
    const server = fakeServer((method, path) => {
      if (path.endsWith('/findings') && method === 'GET') return { body: [finding('f1')] };
      if (path.endsWith('/proposals')) return { body: [] };
      if (method === 'POST') return { body: answer };
      return { status: 404, body: {} };
    });
    try {
      const { view, root, screen } = makeView('auto');
      await view.render(root);
      await button(screen(), /Update with AI/).attrs.onclick();
      assert.match(textOf(screen()), expect, JSON.stringify(answer));
      assert.doesNotMatch(textOf(screen()), /See it in Changes/);
    } finally { server.restore(); }
  }
});

test('before anything is read the screen says so, and a failed read shows the error', async () => {
  let server = fakeServer((method, path) => (path.endsWith('/findings') ? { body: null } : { body: null }));
  try {
    const { view, root, screen } = makeView('look');
    await view.render(root);
    assert.match(textOf(screen()), /not read yet/i);
  } finally { server.restore(); }
  server = fakeServer(() => ({ status: 404, body: { error: 'unknown-project' } }));
  try {
    const { view, root, screen } = makeView('look');
    await view.render(root);
    assert.match(textOf(screen()), /error:unknown-project/);
  } finally { server.restore(); }
});

test('an empty list says everything is in order, and the file of a finding opens in Files', async () => {
  let server = fakeServer((method, path) => (path.endsWith('/findings') ? { body: [] } : { body: [] }));
  try {
    const { view, root, screen } = makeView('look');
    await view.render(root);
    assert.match(textOf(screen()), /in order/i);
  } finally { server.restore(); }
  server = fakeServer((method, path) => (path.endsWith('/findings') ? { body: [finding('f1')] } : { body: [] }));
  try {
    const { view, root, screen, opened } = makeView('look');
    await view.render(root);
    await button(screen(), /docs\/api\.md:33/).attrs.onclick();
    assert.deepEqual(opened, [['docs/api.md', 33]]);
  } finally { server.restore(); }
});

test('a split proposal shows the pieces and the index before anything is written', async () => {
  const split = {
    op: { id: 'op:4', kind: 'doc-split', findingId: 'f2', sensitive: false }, mode: 'suggest', state: 'open',
    diff: [
      { path: 'README.md', before: '# R\n## A\n1\n## B\n2\n', after: '# R\n- [A](README/a.md)\n- [B](README/b.md)\n' },
      { path: 'README/a.md', before: null, after: '## A\n1\n' }, { path: 'README/b.md', before: null, after: '## B\n2\n' },
    ],
  };
  const server = fakeServer((method, path) => {
    if (path.endsWith('/findings') && method === 'GET') return { body: [finding('f2', { rule: 'doc-size', severity: 'detail', state: 'accepted', fix: { kind: 'doc-split', opId: 'op:4' }, what: { msg: 'x', params: { doc: 'README.md', lines: 320, kb: 12, limit: 300, type: 'readme' } } })] };
    if (path.endsWith('/proposals')) return { body: [split] };
    return { status: 404, body: {} };
  });
  try {
    const { view, root, screen } = makeView('suggest');
    await view.render(root);
    const text = textOf(screen());
    assert.match(text, /cut into 2 pieces/);
    assert.match(text, /README\/a\.md/);
    assert.match(text, /README\/b\.md/);
    assert.match(text, /index/i);
  } finally { server.restore(); }
});

test('a real browser writes null as the word "null": nothing empty is ever handed to replaceChildren', async () => {
  const server = fakeServer((method, path) => (path.endsWith('/findings') ? { body: [finding('f1')] } : { body: [] }));
  try {
    const { view, root, screen } = makeView('auto');
    await view.render(root);
    const regions = [root, ...walk(screen())].filter((n) => n.rawArgs);
    assert.ok(regions.length >= 3);
    for (const r of regions) assert.ok(r.rawArgs.every((x) => x != null && x !== false), r.attrs.class ?? 'root');
    assert.doesNotMatch(textOf(screen()), /null|undefined/);
    assert.doesNotMatch(textOf(screen()), /Small things Small things|Important Important/, 'the severity is not said twice');
  } finally { server.restore(); }
});
