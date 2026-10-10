import test from 'node:test';
import assert from 'node:assert/strict';
import { isSlug, slugify, truncate } from '../src/index.js';

test('slugify makes a dash-separated slug', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('truncate cuts long text and keeps short text', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
});

test('isSlug accepts slugs only', () => {
  assert.equal(isSlug('a-b'), true);
  assert.equal(isSlug('A b'), false);
});
