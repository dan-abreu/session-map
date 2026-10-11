import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipStore, escapeXml, outlineOf, freeMindOf, xmindFiles, xmindOf, mapFileName } from '../server/web/mmexport.js';

const tree = {
  id: 'p', label: 'Feira <Livre> & Cia', children: [
    { id: 'l:a', label: 'Camada "A"', children: [
      { id: 'pt:x', label: 'Parte X', children: [{ id: 'i:x:1', label: "Item 'um'\nem duas linhas", children: [] }] },
      { id: 'pt:y', label: 'Parte Y', children: [] },
    ] },
    { id: 'l:b', label: 'Camada B', children: [] },
  ],
};

test('mapFileName: the project name in plain letters, then -mind-map and the extension', () => {
  assert.equal(mapFileName('São Luís', 'mm'), 'sao-luis-mind-map.mm');
  assert.equal(mapFileName('', 'xmind'), 'mind-map.xmind');
});

test('escapeXml: the five characters, and the controls XML cannot hold', () => {
  assert.equal(escapeXml(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&apos;f');
  assert.equal(escapeXml('x\u0000y\u000bz'), 'xyz');
  assert.equal(escapeXml('l1\nl2\tok'), 'l1&#xA;l2&#x9;ok');
  assert.equal(escapeXml(null), '');
});

test('outlineOf: a nested list, the root as the title, two spaces per level', () => {
  const md = outlineOf(tree);
  assert.equal(md, '# Feira \\<Livre\\> \\& Cia\n\n- Camada "A"\n  - Parte X\n    - Item \'um\' em duas linhas\n  - Parte Y\n- Camada B\n');
});

test('outlineOf: markdown marks in a label are escaped with a backslash', () => {
  const md = outlineOf({ id: 'p', label: 'P', children: [{ id: 'a', label: '*bold* [x](y) # not a title', children: [] }] });
  assert.equal(md, '# P\n\n- \\*bold\\* \\[x\\]\\(y\\) \\# not a title\n');
});

test('outlineOf: backslash, html tags and entities in a label stay as text', () => {
  const md = outlineOf({ id: 'p', label: 'P', children: [{ id: 'a', label: 'a\\b <b>x</b> &copy; `c` ~s~ a|b', children: [] }] });
  assert.equal(md, '# P\n\n- a\\\\b \\<b\\>x\\</b\\> \\&copy; \\`c\\` \\~s\\~ a\\|b\n');
});

test('outlineOf: a label that starts like a list, a quote or a bullet is not read as structure', () => {
  const kids = ['1. x', '2) y', '> q', '- z', '+ w'].map((label, i) => ({ id: 'k' + i, label, children: [] }));
  const md = outlineOf({ id: 'p', label: 'P', children: kids });
  assert.equal(md, '# P\n\n- 1\\. x\n- 2\\) y\n- \\> q\n- \\- z\n- \\+ w\n');
});

test('outlineOf: the root title is escaped too', () => {
  assert.equal(outlineOf({ id: 'p', label: '[Home](http://x)', children: [] }), '# \\[Home\\]\\(http://x\\)\n\n');
  assert.equal(outlineOf({ id: 'p', label: 'Root ###', children: [] }), '# Root \\#\\#\\#\n\n');
});

test('freeMindOf: one node per box, text escaped, children nested', () => {
  const mm = freeMindOf(tree);
  assert.ok(mm.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1">'));
  assert.ok(mm.includes('<node ID="ID_1" TEXT="Feira &lt;Livre&gt; &amp; Cia">'));
  assert.ok(mm.includes('TEXT="Camada &quot;A&quot;"'));
  assert.ok(mm.includes('TEXT="Item &apos;um&apos; em duas linhas"'), 'a line break inside a label becomes a space');
  assert.ok(mm.includes('<node ID="ID_5" TEXT="Parte Y"/>'), 'a box with no children closes itself');
  assert.equal((mm.match(/<node /g) ?? []).length, 6);
  assert.equal((mm.match(/<\/node>/g) ?? []).length, 3, 'the ones with children close');
  assert.ok(mm.trimEnd().endsWith('</map>'));
  const ids = [...mm.matchAll(/ID="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('crc32: the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

// A tiny reader for what zipStore writes: the central directory lists name, size and crc of every file.
function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50, 'ends with the end-of-directory mark');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assert.equal(v.getUint32(local, true), 0x04034b50);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.push({ name, method, crc, size, data: bytes.subarray(start, start + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('zipStore: every file is kept as it is, with its size and crc, in order', () => {
  const enc = new TextEncoder();
  const zip = zipStore([{ name: 'a.txt', data: enc.encode('hello') }, { name: 'dir/ç.json', data: enc.encode('{"ok":true}') }]);
  assert.ok(zip instanceof Uint8Array);
  const files = readZip(zip);
  assert.deepEqual(files.map((f) => f.name), ['a.txt', 'dir/ç.json']);
  assert.ok(files.every((f) => f.method === 0), 'store only, no compression');
  assert.equal(new TextDecoder().decode(files[0].data), 'hello');
  assert.equal(files[0].crc, crc32(enc.encode('hello')));
  assert.equal(new TextDecoder().decode(files[1].data), '{"ok":true}');
});

test('xmindFiles: content, manifest and metadata, content with the sheet and the topics', () => {
  const files = xmindFiles(tree);
  assert.deepEqual(files.map((f) => f.name), ['content.json', 'manifest.json', 'metadata.json']);
  const [content, manifest, meta] = files.map((f) => JSON.parse(new TextDecoder().decode(f.data)));
  assert.equal(content.length, 1);
  assert.equal(content[0].class, 'sheet');
  assert.equal(content[0].title, 'Feira <Livre> & Cia');
  const root = content[0].rootTopic;
  assert.equal(root.class, 'topic');
  assert.equal(root.title, 'Feira <Livre> & Cia');
  assert.deepEqual(root.children.attached.map((t) => t.title), ['Camada "A"', 'Camada B']);
  assert.deepEqual(root.children.attached[0].children.attached.map((t) => t.title), ['Parte X', 'Parte Y']);
  assert.equal(root.children.attached[1].children, undefined, 'a leaf has no children key');
  const ids = [];
  (function collect(t) { ids.push(t.id); for (const c of t.children?.attached ?? []) collect(c); })(root);
  assert.equal(new Set(ids).size, ids.length, 'topic ids are unique');
  assert.deepEqual(Object.keys(manifest['file-entries']).sort(), ['content.json', 'metadata.json']);
  assert.equal(typeof meta.creator.name, 'string');
});

test('xmindOf: a zip with the three files, readable back', () => {
  const files = readZip(xmindOf(tree));
  assert.deepEqual(files.map((f) => f.name), ['content.json', 'manifest.json', 'metadata.json']);
  for (const f of files) assert.equal(f.crc, crc32(f.data));
  assert.equal(JSON.parse(new TextDecoder().decode(files[0].data))[0].rootTopic.title, 'Feira <Livre> & Cia');
});
