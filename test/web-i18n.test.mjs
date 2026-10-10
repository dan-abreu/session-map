import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LANGS, translator } from '../server/web/i18n.js';

const WEB = new URL('../server/web/', import.meta.url);
const sources = readdirSync(WEB).filter((f) => /\.(js|html)$/.test(f)).map((f) => [f, readFileSync(new URL(f, WEB), 'utf8')]);

test('en and pt-BR have exactly the same keys, none empty', () => {
  const en = Object.keys(LANGS.en).sort();
  const pt = Object.keys(LANGS['pt-BR']).sort();
  assert.deepEqual(pt.filter((k) => !en.includes(k)), [], 'keys only in pt-BR');
  assert.deepEqual(en.filter((k) => !pt.includes(k)), [], 'keys only in en');
  for (const [lang, dict] of Object.entries(LANGS)) {
    for (const [k, v] of Object.entries(dict)) assert.ok(typeof v === 'string' && v.trim(), `${lang} ${k} is empty`);
  }
});

test('placeholders match between languages', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(LANGS.en)) assert.deepEqual(vars(LANGS['pt-BR'][k]), vars(LANGS.en[k]), k);
});

test('every literal key the page asks for exists', () => {
  const missing = [];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/\bt{1,2}(?:\(\))?\(\s*'([a-zA-Z][\w.-]*)'/g)) if (!(m[1] in LANGS.en)) missing.push(`${file}: ${m[1]}`);
    for (const m of text.matchAll(/\bt{1,2}(?:\(\))?\.count\(\s*'([\w.-]+)'/g)) {
      for (const form of ['one', 'other']) if (!(`${m[1]}.${form}` in LANGS.en)) missing.push(`${file}: ${m[1]}.${form}`);
    }
    for (const m of text.matchAll(/data-i18n(?:-aria|-title|-placeholder)?="([\w.-]+)"/g)) if (!(m[1] in LANGS.en)) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('keys built at runtime exist: server errors, permission states, columns, ranges', () => {
  const dynamic = [
    ...['already-open', 'busy', 'not-running', 'session-changed', 'not-claude', 'kill-refused', 'no-folder', 'live-chat', 'too-many-chats',
      'claude-not-found', 'exited', 'spawn-failed', 'ended', 'unknown-session', 'unknown-front', 'unknown-project', 'unknown-part', 'unknown-layer', 'unknown-group', 'unknown-item', 'no-arch', 'arch-exists', 'bad-node', 'no-clash', 'settings-unreadable', 'nothing-to-undo',
      'unknown-chat', 'token-required', 'network', 'demo', 'generic', 'bad-path', 'sensitive', 'not-found', 'too-large', 'binary', 'bad-line', 'bad-project', 'bad-request'].map((c) => `err.${c}`),
    'action.why.already-open', 'action.why.busy', 'action.archive', 'action.unarchive', 'action.archived', 'action.unarchived',
    ...['allowed', 'denied', 'timeout'].map((s) => `chat.perm.${s}`),
    ...['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'].map((m) => `chat.modeName.${m}`), 'err.bad-mode',
    ...['todo', 'doing', 'done'].flatMap((k) => [`board.${k}`, `board.${k}.empty`, `item.status.${k}`]),
    ...['blocks', 'important', 'detail'].map((w) => `item.weight.${w}`),
    ...['layer', 'part', 'group', 'item'].map((k) => `point.intro.${k}`),
    ...['code', 'page', 'files', 'ai', 'none'].map((s) => `chat.placedBy.${s}`),
    ...['all', 'today', 'd7', 'd15', 'd30', 'd60', 'd90', 'month', 'lastMonth', 'custom'].map((r) => `range.${r}`),
    ...['shared-chat', 'shared-branch', 'lineage', 'file-ref'].map((k) => `link.kind.${k}`),
    ...['question', 'item', 'decision', 'clash', 'ends'].flatMap((k) => [`waiting.count.${k}.one`, `waiting.count.${k}.other`]),
    ...['user', 'project', 'plugin'].map((o) => `skills.origin.${o}`),
    ...['clash', 'decision', 'question'].map((k) => `waiting.${k}`),
    ...['not-flowchart', 'empty-flowchart', 'fence-in-drawing', 'arch-not-here'].map((c) => `flow.err.${c}`),
    ...['working', 'waiting', 'recent'].map((g) => `convs.group.${g}`),
    ...['idea', 'create-arch', 'flow', 'off', 'project'].map((k) => `convs.place.${k}`),
    ...['map', 'vscode', 'terminal', 'sdk'].map((o) => `convs.origin.${o}`),
    ...['busy', 'waiting', 'idle', 'closed', 'unseen'].map((d) => `convs.state.${d}`),
    ...['pinned', 'working', 'waiting', 'visiting', 'today', 'yesterday', 'week', 'older'].map((g) => `convs.group.${g}`),
    ...['running', 'stopped', 'done', 'failed'].flatMap((s) => [`wf.agent.${s}`, `wf.tone.${s}`]),
    ...['project', 'all'].map((k) => `convs.scope.${k}`),
    ...['edit', 'read', 'run', 'search', 'web', 'agent', 'team', 'skill', 'plan', 'ask', 'think', 'tool'].map((k) => `live.step.${k}`),
    ...['edit', 'read', 'run', 'search', 'web', 'agent', 'team', 'skill', 'plan', 'tool'].map((k) => `step.done.${k}`), 'err.bad-images',
    ...['done', 'now', 'open'].map((k) => `chat.todo.${k}`),
    ...['auto', 'maestro', 'ultracode', 'fixed', 'settings'].flatMap((k) => [`run.way.${k}`, `run.why.${k}`, `run.hint.${k}`]),
    ...['direct', 'helpers', 'reinforced', 'ask-reinforce'].map((l) => `run.level.${l}`),
    ...['low', 'medium', 'high', 'xhigh', 'max'].flatMap((e) => [`run.effort.${e}`, `run.effortHint.${e}`]),
    ...['haiku', 'sonnet', 'opus'].map((m) => `run.modelHint.${m}`),
    ...['bad-run', 'restarting', 'bad-limit', 'config-unreadable'].map((c) => `err.${c}`),
    ...['desktop', 'remote', 'claudeai'].map((o) => `convs.origin.${o}`),
    ...['pinned', 'today', 'yesterday', 'week', 'older'].map((g) => `convs.group.${g}`),
    'chat.placedBy.owner', 'chat.placedBy.project', 'err.bad-place',
    ...['working', 'waiting', 'finished'].flatMap((k) => [`now.${k}`, `now.kind.${k}`]),
  ];
  assert.deepEqual(dynamic.filter((k) => !(k in LANGS.en)), []);
});

test('the page has no leftover "not wired yet" texts', () => {
  for (const key of ['action.soon', 'tab.soon']) assert.ok(!(key in LANGS.en), key);
  for (const [file, text] of sources) assert.doesNotMatch(text, /data-soon|inertActions/, file);
});

test('translator counts with plural forms and falls back to English', () => {
  const t = translator('pt-BR');
  assert.equal(t.count('summary.chats', 1), '1 conversa');
  assert.equal(t.count('summary.chats', 3), '3 conversas');
  assert.equal(translator('xx')('tab.map'), 'Map');
});

// CLDR puts 0 in the "one" form for Portuguese, but nobody writes "0 conversa".
test('translator uses the plural form for zero', () => {
  assert.equal(translator('pt-BR').count('summary.chats', 0), '0 conversas');
  assert.equal(translator('en').count('summary.chats', 0), '0 conversations');
});

test('no text is written twice in one language: a second copy would silently replace the first', () => {
  const source = readFileSync(new URL('../server/web/i18n.js', import.meta.url), 'utf8');
  for (const name of ['en', 'ptBR']) {
    const start = source.indexOf(`const ${name} = {`);
    const body = source.slice(start, source.indexOf('\n};', start));
    const keys = [...body.matchAll(/^  '([^']+)':/gm)].map((m) => m[1]);
    const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(twice, [], name);
  }
});
