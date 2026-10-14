import test from 'node:test';
import assert from 'node:assert/strict';
import { listeningLinks } from '../server/main.mjs';

// The token is the page's password: the "listening" log line prints it only to an interactive terminal;
// a captured log (stderr redirected to a file) gets the links with the key masked.

test('a terminal gets the whole links; a captured log gets the key masked', () => {
  const shown = listeningLinks(4001, 'abc123', { tty: true });
  assert.equal(shown.local, 'http://127.0.0.1:4001/?k=abc123');
  assert.equal(shown.lan, undefined);

  const masked = listeningLinks(4001, 'abc123', { tty: false });
  assert.equal(masked.local, 'http://127.0.0.1:4001/?k=…');
  assert.ok(!masked.local.includes('abc123'), 'the token never reaches a captured log');

  const lanMasked = listeningLinks(4001, 'abc123', { lan: '192.168.0.10', tty: false });
  assert.equal(lanMasked.local, 'http://127.0.0.1:4001/?k=…');
  assert.equal(lanMasked.lan, 'http://192.168.0.10:4001/?k=…');
  assert.ok(!JSON.stringify(lanMasked).includes('abc123'));

  const lanShown = listeningLinks(4001, 'abc123', { lan: '192.168.0.10', tty: true });
  assert.equal(lanShown.lan, 'http://192.168.0.10:4001/?k=abc123');
});
