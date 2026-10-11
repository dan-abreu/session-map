// What the Flow tab does around the view inside a part (flow.md fl09): the way back, who may open it, when it closes by
// itself, the notes under the drawing and the legend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenInside, crumbsOf, keepInner, innerZoomKey } from '../server/web/flowview.js';
import { innerNotes, legendKeys, legendWords } from '../server/web/flowlevel.js';
import { LANGS, translator } from '../server/web/i18n.js';

const en = translator('en');
const pt = translator('pt-BR');
const PROJECT = { id: 'sm-1', arch: { parts: [{ id: 'server', name: 'Server' }, { id: 'ideas', name: 'Ideas', role: 'requests' }, { id: 'flow', name: 'Flow' }] } };

test('the way back names where you came from and the part you are in', () => {
  assert.deepEqual(crumbsOf({ partId: 'server', from: '1' }, 'Server', pt), [{ label: 'Visão geral', level: '1' }, { label: 'Server', level: null }]);
  assert.deepEqual(crumbsOf({ partId: 'server', from: 'parts' }, 'Server', en), [{ label: 'Parts', level: 'parts' }, { label: 'Server', level: null }]);
  assert.deepEqual(crumbsOf(null, '', en), []);
});

test('only a part of the program opens from the inside, and never in the workshop', () => {
  assert.equal(canOpenInside({ mode: 'view', partId: 'server', project: PROJECT }), true);
  assert.equal(canOpenInside({ mode: 'workshop', partId: 'server', project: PROJECT }), false);
  assert.equal(canOpenInside({ mode: 'view', partId: 'ideas', project: PROJECT }), false, 'the requests registry is not drawn');
  assert.equal(canOpenInside({ mode: 'view', partId: 'nope', project: PROJECT }), false);
  assert.equal(canOpenInside({ mode: 'view', partId: null, project: PROJECT }), false);
});

test('the inside view closes by itself on another project or when its part is gone; the zoom starts over per part', () => {
  const inner = { partId: 'server', from: '1', projectId: 'sm-1' };
  assert.equal(keepInner(inner, PROJECT), inner);
  assert.equal(keepInner(inner, { ...PROJECT, id: 'other-2' }), null);
  assert.equal(keepInner(inner, { ...PROJECT, arch: { parts: [{ id: 'flow', name: 'Flow' }] } }), null);
  assert.equal(keepInner(null, PROJECT), null);
  assert.notEqual(innerZoomKey('sm-1', '1', 'view', inner), innerZoomKey('sm-1', '1', 'view', { ...inner, partId: 'flow' }));
  assert.notEqual(innerZoomKey('sm-1', '1', 'view', inner), innerZoomKey('sm-1', '1', 'view', null));
});

test('the notes under the inside view say in plain words what was left out and why', () => {
  const view = {
    nodes: [], edges: [],
    notes: [{ key: 'notCode', paths: ['DESIGN.md', 'test/fixtures/claude/'] }, { key: 'moreNeighbours', items: [{ id: 'part:readers', name: 'Readers' }, { id: 'svc:git', nameKey: 'flow.l1.svc.git' }] }, { key: 'otherFiles', n: 2, paths: ['server/web/index.html', 'server/web/style.css'] }],
    counts: { grouped: 38, cut: 3, arrowsCut: 0 },
  };
  const notes = innerNotes(view, pt, { live: null, keyed: false });
  assert.ok(notes.includes('Citados no arquivo da parte, mas não são código que o desenho lê: DESIGN.md, test/fixtures/claude/.'));
  assert.ok(notes.some((n) => n.includes('Readers') && n.includes('Histórico de versões')), notes.join(' | '));
  assert.ok(notes.some((n) => n.startsWith('38 arquivos estão agrupados')));
  assert.ok(notes.some((n) => n.startsWith('3 ligações menores')));
  assert.ok(notes.some((n) => n.includes('index.html')));
  assert.ok(notes.includes(pt('flow.l2.note.noLive')));
  assert.equal(innerNotes(view, pt, { live: {}, keyed: true }).includes(pt('flow.l2.note.noLive')), false);
  assert.ok(innerNotes({ ...view, notes: [{ key: 'declaredOnly' }] }, en).includes(en('flow.l2.note.declaredOnly')));
  const onlyCode = { ...view, notes: [{ key: 'moreNeighbours', items: [{ id: 'part:readers', name: 'Readers', hidden: true }] }] };
  assert.equal(innerNotes(onlyCode, en).some((n) => n.includes('Readers')), false, 'a part seen only in the code is not named while those links are hidden');
  assert.ok(innerNotes(onlyCode, en, { showHidden: true }).some((n) => n.includes('Readers')));
  assert.ok(innerNotes(view, en, { hiddenNear: 2 }).some((n) => n.startsWith('2 parts linked only by code are hidden')));
});

test('the legend inside a part: the colours of what changed, then the same marks as the general view, in both languages', () => {
  assert.deepEqual(legendKeys('2'), ['live', 'changed', 'quiet', 'unsaved', 'actor', 'svc', 'local', 'declared', 'detected']);
  for (const lang of ['en', 'pt-BR']) for (const k of legendKeys('2')) {
    const word = legendWords(k, translator(lang));
    assert.ok(word && !word.startsWith('flow.'), `${lang} ${k}`);
  }
  for (const key of Object.keys(LANGS.en).filter((k) => k.startsWith('flow.l2.'))) assert.ok(LANGS['pt-BR'][key], `pt-BR ${key}`);
});
