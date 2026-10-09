import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFileName, markdownOf, pngSize, isAutoDraft, svgDocument } from '../server/web/flowexport.js';

test('exportFileName: the project name in plain letters, then -flow and the extension', () => {
  assert.equal(exportFileName('Feira Livre', 'svg'), 'feira-livre-flow.svg');
  assert.equal(exportFileName('São Luís', 'png'), 'sao-luis-flow.png');
  assert.equal(exportFileName('', 'md'), 'flow.md');
  assert.equal(exportFileName('???', 'mmd'), 'flow.mmd');
});

test('markdownOf: a title and the mermaid block, ready to paste in a README', () => {
  const md = markdownOf('Feira', 'flowchart LR\n  a --> b', 'Flow');
  assert.equal(md, '# Feira · Flow\n\n```mermaid\nflowchart LR\n  a --> b\n```\n');
  assert.ok(!markdownOf('X', 'flowchart LR\n```\nbad', 'Flow').includes('```\nbad'), 'a fence inside the drawing never closes the block');
});

test('pngSize: twice the drawing, kept inside what a canvas holds', () => {
  assert.deepEqual(pngSize(800, 400), { width: 1600, height: 800, scale: 2 });
  const big = pngSize(9000, 6000);
  assert.ok(big.width <= 8192 && big.height <= 8192, 'inside the canvas limit');
  assert.ok(Math.abs(big.width / big.height - 1.5) < 0.01, 'same proportion');
  assert.deepEqual(pngSize(0, 0), { width: 2, height: 2, scale: 2 });
});

test('isAutoDraft: a map with parts and no diagram in its README is drawn by session-map', () => {
  const arch = (o) => ({ source: 'worktree', mermaid: null, parts: [{ id: 'a' }], ...o });
  assert.equal(isAutoDraft(arch({})), true);
  assert.equal(isAutoDraft(arch({ mermaid: 'flowchart LR\n a-->b' })), false);
  assert.equal(isAutoDraft(arch({ source: 'none', parts: [] })), false);
  assert.equal(isAutoDraft(arch({ parts: [] })), false, 'nothing to draw');
  assert.equal(isAutoDraft(arch({ source: 'main-branch' })), true);
});

test('svgDocument: a stand-alone file with the size, the namespace and a background', () => {
  const doc = svgDocument('<svg viewBox="0 0 300 120" width="100%" style="max-width: 480px; min-width: 240px" class="x"><g/></svg>', { width: 300, height: 120, background: '#fff' });
  assert.match(doc, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg /);
  assert.match(doc, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(doc, /width="300" height="120"/);
  assert.match(doc, /<rect width="100%" height="100%" fill="#fff"\/>/);
  assert.ok(!/max-width|min-width|width="100%" /.test(doc.replace('<rect width="100%"', '')), 'the screen sizing is dropped');
  assert.match(doc, /viewBox="0 0 300 120"/);
});
