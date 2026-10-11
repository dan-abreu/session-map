import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTORS, LINK_RULES, SERVICES, actorOfApp, linkLabelKey, roleOfPart, serviceOf } from '../server/arch/flowcatalog.mjs';
import { LANGS } from '../server/web/i18n.js';

test('serviceOf: commands, SDKs, hosts and scopes find their service', () => {
  assert.deepEqual([serviceOf({ type: 'command', value: 'git' })?.id, serviceOf({ type: 'command', value: 'git' })?.where], ['svc:git', 'this-pc']);
  assert.equal(serviceOf({ type: 'sdk', value: '@anthropic-ai/sdk' })?.id, 'svc:claude');
  assert.equal(serviceOf({ type: 'command', value: 'claude' })?.id, 'svc:claude');
  assert.equal(serviceOf({ type: 'host', value: 'api.github.com' })?.id, 'svc:github');
  assert.equal(serviceOf({ type: 'sdk', value: '@sentry/node' })?.id, 'svc:sentry');
  assert.equal(serviceOf({ type: 'dep', value: 'mercadopago' })?.id, 'svc:mercadopago');
  assert.equal(serviceOf({ type: 'dep', value: '@prisma/client' })?.id, 'svc:database');
  assert.equal(serviceOf({ type: 'dep', value: 'supabase_flutter' })?.id, 'svc:supabase');
  assert.equal(serviceOf({ type: 'host', value: 'abc.supabase.co' })?.id, 'svc:supabase');
  assert.equal(serviceOf({ type: 'file', value: 'vercel.json' })?.id, 'svc:vercel');
});

test('serviceOf: an unknown outside host is a service of its own; local and namespace hosts are none', () => {
  const svc = serviceOf({ type: 'host', value: 'api.example.com' });
  assert.equal(svc.id, 'svc:host:api.example.com');
  assert.equal(svc.name, 'api.example.com');
  assert.equal(svc.where, 'internet');
  for (const host of ['localhost', '10.0.0.1', '127.0.0.1', '192.168.0.4', 'www.w3.org', 'schema.org']) assert.equal(serviceOf({ type: 'host', value: host }), null, host);
});

test('serviceOf: a command that means two things is read by what its file is about', () => {
  assert.equal(serviceOf({ type: 'command', value: 'powershell', tags: ['toast'] })?.id, 'svc:toast');
  assert.equal(serviceOf({ type: 'command', value: 'powershell', tags: ['terminal'] })?.id, 'svc:terminal');
  assert.equal(serviceOf({ type: 'command', value: 'powershell' }), null);
  assert.equal(serviceOf({ type: 'command', value: 'ls-files' }), null);
});

test('actorOfApp: the folder or the route tells who uses the screens', () => {
  assert.equal(actorOfApp('admin', '/dashboard'), 'actor:admin');
  assert.equal(actorOfApp('web', '/painel/pedidos'), 'actor:admin');
  assert.equal(actorOfApp('customer', null), 'actor:customer');
  assert.equal(actorOfApp('cliente', '/'), 'actor:customer');
  assert.equal(actorOfApp('entregador', '/'), 'actor:pro');
  assert.equal(actorOfApp('web', '/cart'), 'actor:user');
});

test('every name and label key of the catalog exists in English and in Portuguese', () => {
  const keys = [...SERVICES, ...Object.values(ACTORS)].flatMap((e) => [e.nameKey, e.labelKey]).filter(Boolean);
  keys.push('flow.l1.svc.host', 'flow.l1.lbl.http', 'flow.l1.lbl.related', 'flow.l1.lbl.uses', 'flow.l1.lbl.missing', 'flow.l1.lbl.hosting');
  for (const k of ['actors', 'outside', 'thispc']) keys.push(`flow.l1.layer.${k}`);
  for (const k of ['declared', 'detected', 'ai', 'confirmed']) keys.push(`flow.l1.origin.${k}`);
  for (const lang of ['en', 'pt-BR']) assert.deepEqual(keys.filter((k) => !(k in LANGS[lang])), [], lang);
});

test('the Claude CLI flags literal is Claude', () => {
  assert.equal(serviceOf({ type: 'literal', value: 'claude-cli' })?.id, 'svc:claude');
});

test('roleOfPart: a part is read by the words of its id and name, the more specific first', () => {
  const role = (id, name) => roleOfPart({ id, name });
  assert.equal(role('readers', 'Readers'), 'reader');
  assert.equal(role('state-builder', 'State builder'), 'state');
  assert.equal(role('page-chat', 'Page chat'), 'chat', 'a chat page is about the chat');
  assert.equal(role('mind-map-page', 'Mind map page'), 'page');
  assert.equal(role('architecture-map', 'Architecture map'), 'archmap');
  assert.equal(role('flow', 'Flow'), 'diagram', 'a part called just Flow is the drawing');
  assert.equal(role('signup-flow', 'Signup flow'), null, 'flow inside a longer name is not the drawing');
  assert.equal(role('watcher-and-alerts', 'Watcher and alerts'), 'alerts');
  assert.equal(role('plugin-and-terminal', 'Plugin and terminal'), 'plugin');
  assert.equal(role('api', 'API'), 'server');
  assert.equal(role('banco', 'Banco de dados'), 'db');
  assert.equal(role('worker', 'Worker'), 'queue');
  assert.equal(role('alpha', 'Alpha'), null);
});

test('linkLabelKey: the words of an arrow come from the target when it says what it takes, else from the source', () => {
  const p = (id, name) => ({ id: `part:${id}`, kind: 'part', partId: id, name });
  assert.equal(linkLabelKey(p('readers', 'Readers'), p('state-builder', 'State builder')), 'flow.l1.lbl.role.reader');
  assert.equal(linkLabelKey(p('server', 'Server'), p('mind-map-page', 'Mind map page')), 'flow.l1.lbl.role.toPage');
  assert.equal(linkLabelKey(p('api', 'API'), p('worker', 'Worker')), 'flow.l1.lbl.queue');
  assert.equal(linkLabelKey(p('web', 'Web'), p('db', 'Database')), 'flow.l1.lbl.data');
  assert.equal(linkLabelKey(p('page-chat', 'Page chat'), p('server', 'Server')), 'flow.l1.lbl.role.chat');
  assert.equal(linkLabelKey(p('alpha', 'Alpha'), p('beta', 'Beta')), null);
  assert.equal(linkLabelKey({ id: 'free:x', kind: 'free', name: 'Readers' }, p('beta', 'Beta')), 'flow.l1.lbl.role.reader', 'a free box is read by its name too');
  assert.equal(linkLabelKey({ id: 'svc:git', kind: 'service', name: 'Readers' }, p('beta', 'Beta')), null, 'actors and services keep the catalog words');
});

test('linkLabelKey: one part handing on to several others says what each one gets, so the arrows can be told apart', () => {
  const p = (id, name) => ({ id: `part:${id}`, kind: 'part', partId: id, name });
  const sb = p('state-builder', 'State builder');
  const fd = p('foundation', 'Foundation');
  const bi = p('bootstrap-and-inspection', 'Bootstrap and inspection');
  const targets = [p('flow', 'Flow'), p('watcher-and-alerts', 'Watcher and alerts'), p('orchestration', 'Orchestration'), p('architecture-map', 'Architecture map'), p('page-chat', 'Page chat'), bi];
  for (const from of [sb, fd, bi]) {
    const keys = targets.filter((t) => t !== from).map((t) => linkLabelKey(from, t));
    assert.ok(keys.every(Boolean), from.name);
    const pairs = keys.filter((k) => k.startsWith('flow.l1.lbl.pair.'));
    assert.equal(new Set(pairs).size, pairs.length, `${from.name}: no two targets share pair words`);
    assert.ok(pairs.length >= 3, `${from.name}: at least three targets get their own words`);
  }
  assert.equal(linkLabelKey(sb, p('server', 'Server')), 'flow.l1.lbl.role.state', 'a pair with no words of its own keeps the source words');
  assert.equal(linkLabelKey(p('server', 'Server'), p('mind-map-page', 'Mind map page')), 'flow.l1.lbl.role.toPage');
});

test('every role and arrow word of the table exists in English and in Portuguese', () => {
  const keys = [...new Set(LINK_RULES.map((r) => r.key))];
  assert.ok(keys.length >= 15);
  for (const lang of ['en', 'pt-BR']) assert.deepEqual(keys.filter((k) => !(k in LANGS[lang])), [], lang);
});
