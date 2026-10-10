import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextOf } from '../server/chat/context.mjs';
import { PROJECT_CONTEXT_MAX } from '../server/chat/project.mjs';
import { parseArch } from '../server/arch/parse.mjs';

// The project chat (orchestration or01, first step): a chat about the whole project that starts from a compact summary.
const fixture = (name) => {
  const dir = fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));
  return Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
};
const HISTORY = 'THE WHOLE EARLIER CONVERSATION';
const chat = (title, extra = {}) => ({
  sessionId: `${title}-id`, title, status: 'closed', live: false, archived: false, updatedAt: '2026-10-09T10:00:00Z',
  waiting: { strong: false, weak: false, items: [] }, card: null, lastPrompt: HISTORY, lastAssistantText: HISTORY, ...extra,
});
const feira = (extra = {}) => ({
  id: 'feira-abc123', name: 'feira', root: '/work/feira', mainBranch: 'main',
  arch: parseArch('docs/architecture', fixture('arch-en')),
  chats: [
    chat('Checkout copy', { status: 'busy', live: true, card: { doing: 'Writing the cookie notice', decided: ['Keep the notice short'] } }),
    chat('Photo upload', { updatedAt: '2026-10-09T09:00:00Z', waiting: { strong: true, weak: false, items: [] }, card: { decided: ['Photos go to the bucket'] } }),
  ],
  decisions: [{ kind: 'item', text: 'Pick the refund policy', partId: 'orders' }, { kind: 'decision', text: 'Choose the hosting plan' }],
  activity: [
    { kind: 'commit', ts: '2026-10-09T08:00:00Z', subject: 'feat(storefront): stall photos' },
    { kind: 'push', ts: '2026-10-09T08:05:00Z', branch: 'main' },
    { kind: 'tag', ts: '2026-10-08T20:00:00Z', subject: 'v1.4.0' },
    { kind: 'commit', ts: '2026-10-08T19:00:00Z', subject: 'fix(orders): basket total' },
  ],
  ...extra,
});
const all = (ctx) => ctx.sections.join('\n\n');
const bytes = (ctx) => Buffer.byteLength(all(ctx), 'utf8');

test('the project chat reads the layers and parts with one line each and the open items they hold', () => {
  const ctx = contextOf(feira(), { kind: 'project' });
  assert.equal(ctx.error, undefined);
  assert.equal(ctx.part, null, 'it is about the whole project, not one part');
  const text = all(ctx);
  assert.ok(text.includes('Project: feira'));
  for (const layer of ['Entry points', 'Engine']) assert.ok(text.includes(layer), layer);
  assert.ok(text.includes('Storefront: The public site where people browse the weekly stalls.'), 'a part with its one line');
  assert.match(text, /Storefront[^\n]*2 open, 1 in progress/, 'the open items of a part, counted');
  assert.match(text, /Orders[^\n]*1 open/);
  assert.match(text, /Courier app[^\n]*nothing open/);
});

test('it says what is working now, what waits for the person, the latest decisions, the last changes and the versions', () => {
  const text = all(contextOf(feira(), { kind: 'project' }));
  assert.match(text, /Working now:[\s\S]*Checkout copy[\s\S]*Writing the cookie notice/);
  assert.match(text, /Working now:[\s\S]*Real stall photos \(Storefront\)/, 'an item in progress');
  assert.match(text, /Waiting for you:[\s\S]*Pick the refund policy \(Orders\)[\s\S]*Choose the hosting plan/);
  assert.match(text, /Waiting for you:[\s\S]*Photo upload/, 'a conversation that asks the person something');
  assert.match(text, /Recent decisions:[\s\S]*Keep the notice short[\s\S]*Photos go to the bucket/);
  assert.match(text, /Last changes:[\s\S]*2026-10-09 feat\(storefront\): stall photos[\s\S]*2026-10-08 fix\(orders\): basket total/);
  assert.match(text, /Versions: v1\.4\.0/);
  assert.ok(!text.includes(HISTORY), 'never the history of a conversation');
});

test('the rule: a new request becomes an item in the right part\'s What\'s missing, the flow follows the map, codes are cited', () => {
  const text = all(contextOf(feira(), { kind: 'project' }));
  assert.match(text, /docs\/architecture\//);
  assert.match(text, /What's missing/);
  assert.match(text, /right part/);
  assert.match(text, /flow/i, 'architecture and flow go together');
  assert.match(text, /cite the item's code/i);
  const quiet = all(contextOf(feira({ chats: [], decisions: [], activity: [] }), { kind: 'project' }));
  assert.deepEqual([...quiet.matchAll(/(?<![\w-])([a-z]{1,4}(?:-[a-z]{1,8})?\d{1,4})(?![\w-])/gi)].map((m) => m[1]), [], 'the fixed texts cite no item code');
});

test('the summary stays compact on a huge project: capped in bytes, with what was left out counted', () => {
  const long = 'A very long explanation of what this part does, repeated to fill the line. '.repeat(6);
  const base = feira();
  const parts = Array.from({ length: 300 }, (_, n) => ({
    id: `p${n}`, name: `Part número ${n}`, about: long, file: `docs/architecture/p${n}.md`, codePaths: [],
    groups: [{ name: '', items: Array.from({ length: 30 }, (__, k) => ({ code: null, title: `Item ${k}`, detail: [], status: k % 3 ? 'todo' : 'doing', who: null, weight: null, milestone: null, line: k })) }],
  }));
  const arch = { ...base.arch, layers: [{ id: 'all', name: 'Everything', partIds: parts.map((p) => p.id) }], parts };
  const huge = feira({
    arch,
    chats: Array.from({ length: 200 }, (_, n) => chat(`Busy chat ${n}`, { status: 'busy', live: true, card: { doing: long, decided: [long, long] } })),
    decisions: Array.from({ length: 200 }, (_, n) => ({ kind: 'decision', text: `Decision ${n}: ${long}` })),
    activity: Array.from({ length: 500 }, (_, n) => ({ kind: n % 10 ? 'commit' : 'tag', ts: '2026-10-09T08:00:00Z', subject: `change ${n} ${long}` })),
  });
  const ctx = contextOf(huge, { kind: 'project' });
  assert.ok(PROJECT_CONTEXT_MAX <= 4096, 'about 3 to 4 KB');
  assert.ok(bytes(ctx) <= PROJECT_CONTEXT_MAX, `${bytes(ctx)} bytes`);
  const text = all(ctx);
  assert.match(text, /more parts/, 'what did not fit is counted, not silently dropped');
  assert.match(text, /What's missing/, 'the rule always fits');
});

test('a project without a map still gets a project chat, told there is no map yet', () => {
  const bare = feira({ arch: { source: 'none', dir: null, lang: 'en', layers: [], parts: [] }, decisions: [] });
  const ctx = contextOf(bare, { kind: 'project' });
  assert.equal(ctx.error, undefined);
  const text = all(ctx);
  assert.ok(text.includes('Project: feira'));
  assert.match(text, /no architecture map yet/);
  assert.match(text, /Checkout copy/, 'what runs still shows');
});

test('a map in Portuguese keeps its section names in the rule', () => {
  const pt = feira({ arch: parseArch('docs/arquitetura', fixture('arch-pt')) });
  assert.match(all(contextOf(pt, { kind: 'project' })), /O que falta/);
});
