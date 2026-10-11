import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID, gridLayout, roughMeasure, spread, wrapText } from '../server/web/flowgrid.js';

// A fixed measure so the numbers never depend on a font: every character is 7px wide at any size.
const measure = (s) => String(s).length * 7;

const scene = () => ({
  rows: [
    { groups: [{ id: 'actors', title: 'People', cls: 'actors' }] },
    { groups: [{ id: 'surface', title: 'Surface' }] },
    { groups: [{ id: 'engine', title: 'Engine' }] },
    { groups: [{ id: 'thispc', title: 'This PC' }, { id: 'outside', title: 'Outside' }] },
  ],
  nodes: [
    { id: 'U', label: 'You, in the browser', group: 'actors', shape: 'stadium' },
    { id: 'SV', label: 'Server', group: 'surface' },
    { id: 'MM', label: 'Mind map page', group: 'surface' },
    { id: 'SB', label: 'State builder', group: 'engine' },
    { id: 'RD', label: 'Readers', group: 'engine' },
    { id: 'GIT', label: 'git', group: 'thispc', shape: 'hex' },
    { id: 'DB', label: 'Version history', group: 'thispc', shape: 'db' },
    { id: 'GH', label: 'GitHub', group: 'outside', shape: 'hex' },
  ],
  edges: [
    { index: 0, from: 'U', to: 'SV', label: 'opens the page' },
    { index: 1, from: 'SV', to: 'SB', label: 'asks for state' },
    { index: 2, from: 'MM', to: 'SB', label: 'asks for state' },
    { index: 3, from: 'SB', to: 'GIT', label: 'runs git' },
    { index: 4, from: 'RD', to: 'GIT', label: 'runs git' },
    { index: 5, from: 'SB', to: 'DB', label: 'saves changes' },
    { index: 6, from: 'RD', to: 'GH', label: 'reads issues' },
    { index: 7, from: 'SV', to: 'MM', label: 'serves the page' },
    { index: 8, from: 'SB', to: 'RD', label: '' },
    { index: 9, from: 'SV', to: 'GH', label: 'checks for updates' },
    { index: 10, from: 'SV', to: 'GIT', label: 'runs git', kind: 'dotted' },
  ],
});

const lay = (s = scene()) => gridLayout(s, { measure });
const rect = (o) => ({ x0: o.x - o.w / 2, x1: o.x + o.w / 2, y0: o.y - o.h / 2, y1: o.y + o.h / 2 });
const overlap = (a, b) => {
  const p = rect(a);
  const q = rect(b);
  return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
};

test('GRID holds the sizes the drawing uses, and the helpers behave', () => {
  for (const k of ['font', 'boxText', 'labelText', 'bandPad', 'gapMin', 'margin']) assert.ok(GRID[k] > 0, k);
  assert.equal(roughMeasure('abcd', 10), 4 * 10 * 0.52);
  assert.deepEqual(wrapText('one two three', 7 * 7, measure), ['one two', 'three']);
  assert.deepEqual(wrapText('supercalifragilistic', 10, measure), ['supercalifragilistic'], 'a long word keeps its own line');
  assert.deepEqual(wrapText('', 50, measure), []);
  const at = spread([0, 0, 0], [10, 10]);
  assert.deepEqual(at.map((v, i) => v - at[0] - i * 10), [0, 0, 0], 'neighbours keep their gap');
  assert.equal(spread([0, 100], [10])[1], 100, 'far apart ones stay where they want');
});

test('bands come out in order: actors first, layers as given, this PC and outside together last', () => {
  const l = lay();
  assert.deepEqual(l.bands.map((b) => b.id), ['actors', 'surface', 'engine', 'thispc', 'outside']);
  const y = (id) => l.bands.find((b) => b.id === id).y;
  assert.ok(y('actors') < y('surface') && y('surface') < y('engine') && y('engine') < y('thispc'));
  assert.equal(y('thispc'), y('outside'), 'same bottom band');
  const pc = l.bands.find((b) => b.id === 'thispc');
  const out = l.bands.find((b) => b.id === 'outside');
  assert.ok(pc.x + pc.w <= out.x, 'this PC sits left of outside, not overlapping it');
  assert.equal(l.bands[0].title, 'People');
});

test('every box sits inside its band and inside the drawing; no two boxes overlap', () => {
  const l = lay();
  assert.equal(l.boxes.length, 8);
  for (const b of l.boxes) {
    const band = l.bands.find((x) => x.id === b.group);
    const r = rect(b);
    assert.ok(r.x0 >= band.x - 0.01 && r.x1 <= band.x + band.w + 0.01, `${b.id} across`);
    assert.ok(r.y0 >= band.y && r.y1 <= band.y + band.h, `${b.id} down`);
    assert.ok(r.x0 >= 0 && r.x1 <= l.width && r.y0 >= 0 && r.y1 <= l.height, `${b.id} in the drawing`);
  }
  for (let i = 0; i < l.boxes.length; i++) for (let j = i + 1; j < l.boxes.length; j++) {
    assert.ok(!overlap(l.boxes[i], l.boxes[j]), `${l.boxes[i].id} / ${l.boxes[j].id}`);
  }
  for (let i = 0; i < l.bands.length; i++) for (let j = i + 1; j < l.bands.length; j++) {
    assert.ok(!overlap({ ...l.bands[i], x: l.bands[i].x + l.bands[i].w / 2, y: l.bands[i].y + l.bands[i].h / 2 }, { ...l.bands[j], x: l.bands[j].x + l.bands[j].w / 2, y: l.bands[j].y + l.bands[j].h / 2 }), `bands ${i}/${j}`);
  }
});

test('every arrow with words gets a label slot, and no label touches a box or another label', () => {
  const s = scene();
  const l = lay(s);
  const withWords = s.edges.filter((e) => e.label);
  for (const e of withWords) assert.ok(l.labels.some((x) => x.indexes.includes(e.index)), `edge ${e.index} has a label`);
  const without = l.labels.flatMap((x) => x.indexes);
  assert.ok(!without.includes(8), 'an arrow with no words gets no label');
  assert.equal(l.paths.length, s.edges.length, 'every arrow is drawn');
  for (let i = 0; i < l.labels.length; i++) {
    assert.ok(l.labels[i].lines.length > 0 && l.labels[i].w > 0 && l.labels[i].h > 0);
    for (let j = i + 1; j < l.labels.length; j++) assert.ok(!overlap(l.labels[i], l.labels[j]), `labels ${l.labels[i].text} / ${l.labels[j].text}`);
    for (const b of l.boxes) assert.ok(!overlap(l.labels[i], b), `label ${l.labels[i].text} on box ${b.id}`);
  }
});

test('an arrow between two parts of one layer dips below its band instead of crossing boxes', () => {
  const l = lay();
  const p = l.paths.find((x) => x.index === 7); // SV -> MM, both in the surface band
  const band = l.bands.find((b) => b.id === 'surface');
  const lab = l.labels.find((x) => x.indexes.includes(7));
  assert.ok(lab.y - lab.h / 2 >= band.y + band.h - GRID.bandPad - GRID.lanePad - 1 || lab.y > band.y + band.h / 2, 'label sits in the lane at the bottom of the band');
  const sv = l.boxes.find((b) => b.id === 'SV');
  assert.ok(lab.y > sv.y + sv.h / 2, 'label is under the boxes');
  assert.match(p.d, /^M[\d.-]+,[\d.-]+Q.*Q/, 'a dip: down, across through the label, back up');
  for (const b of l.boxes.filter((x) => x.group === 'surface')) assert.ok(!overlap(lab, b));
});

test('arrows with the same words from one box, or into one box, share one label', () => {
  const l = lay();
  const git = l.labels.filter((x) => x.text === 'runs git');
  // SB -> GIT and RD -> GIT share their head box with the same words; SV -> GIT is another kind and stays apart.
  const shared = git.find((x) => x.indexes.includes(3));
  assert.deepEqual([...shared.indexes].sort(), [3, 4], 'two parts reaching git with the same words use one label');
  assert.ok(git.some((x) => x.indexes.length === 1 && x.indexes[0] === 10), 'another kind keeps its own label');
  const state = l.labels.find((x) => x.text === 'asks for state');
  assert.deepEqual([...state.indexes].sort(), [1, 2]);
  assert.equal(l.labels.filter((x) => x.text === 'asks for state').length, 1);
  const lone = l.labels.find((x) => x.text === 'saves changes');
  assert.deepEqual(lone.indexes, [5]);
});

test('an empty scene and a scene with only parts do not throw', () => {
  const none = gridLayout({}, { measure });
  assert.deepEqual([none.bands, none.boxes, none.labels, none.paths], [[], [], [], []]);
  assert.ok(none.width >= 0 && none.height >= 0 && Number.isFinite(none.width));
  const empty = gridLayout({ rows: [], nodes: [], edges: [] });
  assert.equal(empty.boxes.length, 0);

  const only = lay({
    rows: [{ groups: [{ id: 'a', title: 'A' }] }, { groups: [{ id: 'b', title: 'B' }] }],
    nodes: [{ id: 'X', label: 'X', group: 'a' }, { id: 'Y', label: 'Y', group: 'a' }, { id: 'Z', label: 'Z', group: 'b' }],
    edges: [{ index: 0, from: 'X', to: 'Z', label: 'feeds' }, { index: 1, from: 'X', to: 'Y', label: 'next' }],
  });
  assert.deepEqual(only.bands.map((b) => b.id), ['a', 'b']);
  assert.equal(only.boxes.length, 3);
  assert.equal(only.paths.length, 2);

  const one = lay({ rows: [{ groups: [{ id: 'a' }] }], nodes: [{ id: 'X', label: 'X', group: 'a' }], edges: [] });
  assert.equal(one.boxes.length, 1);
});

test('bad input is ignored: unknown boxes, self arrows, duplicates, boxes in no band', () => {
  const l = lay({
    rows: [{ groups: [{ id: 'a' }] }, { groups: [{ id: 'b' }] }],
    nodes: [{ id: 'X', label: 'X', group: 'a' }, { id: 'X', label: 'again', group: 'a' }, { id: 'Z', label: 'Z', group: 'b' }, { id: 'N', label: 'N', group: 'nowhere' }],
    edges: [{ index: 0, from: 'X', to: 'X', label: 'self' }, { index: 1, from: 'X', to: 'GHOST', label: 'lost' }, { index: 2, from: 'Z', to: 'X', label: 'up' }],
  });
  assert.deepEqual(l.boxes.map((b) => b.id).sort(), ['X', 'Z']);
  assert.equal(l.paths.length, 1);
  assert.equal(l.paths[0].from, 'X', 'the arrow is written from the upper box');
  assert.equal(l.paths[0].head, 'start', 'and its head moves to where it belonged');
});

test('the layout is deterministic: the same scene gives the same drawing', () => {
  assert.deepEqual(lay(scene()), lay(scene()));
  assert.deepEqual(gridLayout(scene()), gridLayout(scene()));
});

test('a piece of a part can carry a short description under its name: the box grows for it, at most three lines', () => {
  const s = scene();
  const plain = lay(s).boxes.find((b) => b.id === 'SV');
  s.nodes = s.nodes.map((n) => (n.id === 'SV' ? { ...n, sub: 'Answers every request of the page and keeps the key of this computer safe from other machines on the network, always.' } : n));
  const out = lay(s);
  const sv = out.boxes.find((b) => b.id === 'SV');
  assert.ok(sv.sub.length >= 2 && sv.sub.length <= 3, String(sv.sub.length));
  assert.ok(sv.h > plain.h);
  assert.ok(sv.sub.at(-1).length > 0);
  assert.ok(sv.sub.every((line) => measure(line) <= GRID.subText + 1));
  for (const a of out.boxes) for (const b of out.boxes) {
    if (a === b) continue;
    const apart = a.x + a.w / 2 <= b.x - b.w / 2 || b.x + b.w / 2 <= a.x - a.w / 2 || a.y + a.h / 2 <= b.y - b.h / 2 || b.y + b.h / 2 <= a.y - a.h / 2;
    assert.ok(apart, `${a.id} and ${b.id} overlap`);
  }
  assert.deepEqual(lay(scene()).boxes.find((b) => b.id === 'SV').sub, [], 'no description, no extra lines');
});

test('a level-2 scene (rows of several groups, arrows inside and across) lays out without overlaps and draws every arrow', () => {
  const s = {
    rows: [
      { groups: [{ id: 'in-actors', title: 'Comes in', cls: 'actors' }, { id: 'in-parts', title: '', cls: 'parts' }] },
      { groups: [{ id: 'entry', title: 'Where it starts' }] },
      { groups: [{ id: 'work', title: 'What does the work' }] },
      { groups: [{ id: 'work-2', title: '' }] },
      { groups: [{ id: 'base', title: 'Pieces it leans on' }] },
      { groups: [{ id: 'out-parts', title: 'Hands on to', cls: 'parts' }, { id: 'out-local', title: '', cls: 'thispc' }] },
    ],
    nodes: [
      { id: 'BR', label: 'You, in the browser', group: 'in-actors', shape: 'stadium' },
      { id: 'FL', label: 'Flow', group: 'in-parts' },
      { id: 'M', label: 'main.mjs', sub: 'Serves the page and the api.', group: 'entry' },
      ...['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: x, label: `${x}.mjs`, sub: 'Does one thing.', group: 'work' })),
      { id: 'f', label: 'f.mjs', group: 'work-2' },
      { id: 'L', label: 'log.mjs', group: 'base' },
      { id: 'G', label: '+12 files', sub: 'in server/web', group: 'base', shape: 'group' },
      { id: 'MM', label: 'Mind map page', group: 'out-parts' },
      { id: 'GIT', label: 'Version history', group: 'out-local', shape: 'db' },
    ],
    edges: [
      { index: 0, from: 'BR', to: 'M', label: 'pages and clicks' },
      { index: 1, from: 'FL', to: 'M', label: 'the drawing' },
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => ({ index: 2 + i, from: x, to: 'M', label: 'lends code', headAtStart: false })),
      { index: 8, from: 'L', to: 'a', label: 'lends code' },
      { index: 9, from: 'a', to: 'b', label: 'lends code' },
      { index: 10, from: 'M', to: 'MM', label: 'what the screen shows' },
      { index: 11, from: 'c', to: 'GIT', label: 'runs git' },
      { index: 12, from: 'G', to: 'M', label: 'lends code' },
    ],
  };
  const out = gridLayout(s, { measure });
  assert.equal(out.paths.length, 13);
  for (const a of out.boxes) for (const b of out.boxes) {
    if (a === b) continue;
    const apart = a.x + a.w / 2 <= b.x - b.w / 2 || b.x + b.w / 2 <= a.x - a.w / 2 || a.y + a.h / 2 <= b.y - b.h / 2 || b.y + b.h / 2 <= a.y - a.h / 2;
    assert.ok(apart, `${a.id} and ${b.id} overlap`);
  }
  for (const a of out.labels) for (const b of [...out.labels, ...out.boxes]) {
    if (a === b) continue;
    const apart = a.x + a.w / 2 <= b.x - b.w / 2 || b.x + b.w / 2 <= a.x - a.w / 2 || a.y + a.h / 2 <= b.y - b.h / 2 || b.y + b.h / 2 <= a.y - a.h / 2;
    assert.ok(apart, `label ${a.text} touches ${b.id ?? b.text}`);
  }
});

test('a band with no title keeps no room for one: its box sits as close to the top as to the bottom', () => {
  const scene = (title) => ({
    rows: [{ groups: [{ id: 'a', title, cls: 'actors' }] }, { groups: [{ id: 'b', title, cls: 'parts' }] }],
    nodes: [{ id: 'A', label: 'You', group: 'a', shape: 'stadium' }, { id: 'B', label: 'Server', group: 'b' }],
    edges: [{ index: 0, from: 'A', to: 'B', label: '1 · pages', kind: 'arrow' }],
  });
  const titled = gridLayout(scene('Who uses it'));
  const bare = gridLayout(scene(''));
  assert.ok(bare.height < titled.height);
  for (const band of bare.bands) {
    const box = bare.boxes.find((b) => b.group === band.id);
    const above = box.y - box.h / 2 - band.y;
    const below = band.y + band.h - (box.y + box.h / 2);
    assert.ok(Math.abs(above - below) <= 1, `${band.id}: ${above} above, ${below} below`);
  }
});

test('a band that goes on in the row under it is one band, titled once, and its title sits clear above its boxes', () => {
  const s = {
    rows: [
      { groups: [{ id: 'entry', title: 'Where it starts' }] },
      { groups: [{ id: 'work', title: 'What does the work' }] },
      { groups: [{ id: 'work_1', title: '', cont: 'work' }] },
      { groups: [{ id: 'base', title: 'Pieces it leans on' }] },
    ],
    nodes: [
      { id: 'APP', label: 'app.js', group: 'entry' },
      ...['a', 'b', 'c', 'd', 'e'].map((x) => ({ id: x, label: `${x}.js`, group: 'work' })),
      { id: 'f', label: 'f.js', group: 'work_1' },
      { id: 'g', label: 'g.js', group: 'work_1' },
      { id: 'z', label: 'z.js', group: 'base' },
    ],
    edges: [
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x, i) => ({ index: i, from: 'APP', to: x, label: 'uses', kind: 'dotted' })),
      { index: 7, from: 'a', to: 'z', label: 'uses', kind: 'dotted' },
    ],
  };
  const l = lay(s);
  assert.deepEqual(l.bands.map((b) => b.id), ['entry', 'work', 'base'], 'no untitled band of its own');
  const work = l.bands.find((b) => b.id === 'work');
  for (const id of ['a', 'f', 'g']) {
    const b = l.boxes.find((x) => x.id === id);
    assert.ok(b.y - b.h / 2 >= work.y && b.y + b.h / 2 <= work.y + work.h, `${id} inside the one work band`);
  }
  // The title's text (drawn from y + 21 at 15px) ends well above the first boxes of its band.
  for (const band of l.bands) {
    const top = Math.min(...l.boxes.filter((b) => (b.id === 'APP' ? 'entry' : b.id === 'z' ? 'base' : 'work') === band.id).map((b) => b.y - b.h / 2));
    assert.ok(top - (band.y + 25) >= 10, `${band.id}: ${top - (band.y + 25)}px between title and boxes`);
  }
  // The seven "uses" arrows leaving app.js share one label under it, whatever row they go to.
  const uses = l.labels.filter((x) => x.text === 'uses');
  assert.ok(uses.some((x) => x.indexes.length === 7), `labels: ${uses.map((x) => x.indexes.length)}`);
  assert.ok(uses.length <= 2);
});

test('an arrow passing a row of boxes keeps clear of them', () => {
  const s = {
    rows: [{ groups: [{ id: 'r0', title: 'A' }] }, { groups: [{ id: 'r1', title: 'B' }] }, { groups: [{ id: 'r2', title: 'C' }] }],
    nodes: [
      { id: 'T', label: 'top.js', group: 'r0' },
      ...['m1', 'm2', 'm3'].map((x) => ({ id: x, label: `${x}.js`, group: 'r1' })),
      { id: 'B', label: 'bottom.js', group: 'r2' },
    ],
    edges: [{ index: 0, from: 'T', to: 'B', label: 'reads' }, ...['m1', 'm2', 'm3'].map((x, i) => ({ index: i + 1, from: 'T', to: x, label: 'uses' }))],
  };
  const l = lay(s);
  const p = l.paths.find((x) => x.index === 0);
  const row = l.boxes.filter((b) => b.id.startsWith('m'));
  const y = row[0].y;
  // Where the long arrow crosses the middle row it runs straight down: find its x there from its path.
  const pts = [...p.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  const near = pts.filter((q) => Math.abs(q.y - y) <= row[0].h / 2 + 20);
  assert.ok(near.length, 'the path has points beside the middle row');
  for (const q of near) for (const b of row) assert.ok(Math.abs(q.x - b.x) >= b.w / 2 + GRID.passBoxGap - GRID.passW, `x ${q.x} too close to ${b.id}`);
});
