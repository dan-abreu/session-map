import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aesBackend, getKey, keysFile, listKeys, removeKey, setKey, validateKey } from '../server/ai/keys.mjs';

const KEY = 'sk-or-v1-0123456789abcdefSECRETPART9876';
const tmp = () => mkdtempSync(join(tmpdir(), 'sm-keys-'));

// Reverses and base64s the text: enough to prove the file never holds the key as typed.
function fakeBackend() {
  const calls = { seal: 0, open: 0 };
  return {
    calls,
    scheme: 'fake',
    seal: async (plain) => { calls.seal++; return Buffer.from([...plain].reverse().join('')).toString('base64'); },
    open: async (sealed) => { calls.open++; return [...Buffer.from(sealed, 'base64').toString()].reverse().join(''); },
  };
}

test('a saved key comes back whole, and the file holds neither the key nor most of it', async () => {
  const smDir = tmp();
  try {
    const backend = fakeBackend();
    const saved = await setKey(smDir, 'openrouter', KEY, { backend, now: () => '2026-10-10T12:00:00.000Z' });
    assert.deepEqual(saved, { ok: true, key: { provider: 'openrouter', set: true, last4: '9876', savedAt: '2026-10-10T12:00:00.000Z' } });
    assert.equal(keysFile(smDir), join(smDir, 'ai-keys.json'));
    const text = readFileSync(keysFile(smDir), 'utf8');
    assert.ok(!text.includes(KEY));
    assert.ok(!text.includes('SECRETPART'));
    assert.equal(await getKey(smDir, 'openrouter', { backend }), KEY);
    assert.equal(backend.calls.open, 1);
    assert.equal(await getKey(smDir, 'openrouter', { backend }), KEY);
    assert.equal(backend.calls.open, 1, 'an opened key is kept in memory, not opened again');
    if (process.platform !== 'win32') assert.equal(statSync(keysFile(smDir)).mode & 0o777, 0o600);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('listKeys tells which providers have a key and its last four characters, never the key', async () => {
  const smDir = tmp();
  try {
    const backend = fakeBackend();
    assert.deepEqual(listKeys(smDir), []);
    await setKey(smDir, 'gemini', 'AIzaSyA1234567890abcdefghijklmnopqrstu', { backend, now: () => 't1' });
    await setKey(smDir, 'deepseek', 'sk-deepseek0123456789wxyz', { backend, now: () => 't2' });
    const list = listKeys(smDir);
    assert.deepEqual(list, [
      { provider: 'deepseek', set: true, last4: 'wxyz', savedAt: 't2' },
      { provider: 'gemini', set: true, last4: 'rstu', savedAt: 't1' },
    ]);
    assert.ok(!JSON.stringify(list).includes('AIzaSyA1234567890'));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('removeKey forgets one provider only, and getKey of an unknown or missing key is null', async () => {
  const smDir = tmp();
  try {
    const backend = fakeBackend();
    await setKey(smDir, 'gemini', 'AIzaSyA1234567890abcdefghijklmnopqrstu', { backend });
    await setKey(smDir, 'deepseek', 'sk-deepseek0123456789wxyz', { backend });
    assert.equal(removeKey(smDir, 'gemini'), true);
    assert.equal(removeKey(smDir, 'gemini'), false);
    assert.equal(await getKey(smDir, 'gemini', { backend }), null);
    assert.equal(await getKey(smDir, 'nope', { backend }), null);
    assert.equal(await getKey(smDir, 'deepseek', { backend }), 'sk-deepseek0123456789wxyz');
    assert.deepEqual(listKeys(smDir).map((k) => k.provider), ['deepseek']);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a key is checked before anything is stored', async () => {
  const smDir = tmp();
  try {
    const backend = fakeBackend();
    assert.equal(validateKey('nope', KEY), 'unknown-provider');
    assert.equal(validateKey('openai', 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdEfGhIjKl'), null);
    assert.equal(validateKey('openai', 'sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), null);
    assert.equal(validateKey('gemini', 'short'), 'invalid-key');
    assert.equal(validateKey('gemini', 'x'.repeat(401)), 'invalid-key');
    assert.equal(validateKey('gemini', 'has a space in it'), 'invalid-key');
    assert.equal(validateKey('gemini', 'line\nbreak0123456'), 'invalid-key');
    assert.equal(validateKey('gemini', 'tab\tinside0123456'), 'invalid-key');
    assert.equal(validateKey('gemini', 42), 'invalid-key');
    assert.equal(validateKey('gemini', KEY), null);
    assert.deepEqual(await setKey(smDir, 'gemini', 'short', { backend }), { ok: false, error: 'invalid-key' });
    assert.deepEqual(await setKey(smDir, '__proto__', KEY, { backend }), { ok: false, error: 'unknown-provider' });
    assert.equal(backend.calls.seal, 0);
    assert.equal(existsSync(keysFile(smDir)), false);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a failing lock gives a short error, and a key sealed another way is not opened', async () => {
  const smDir = tmp();
  try {
    const broken = { scheme: 'fake', seal: async () => { throw new Error(`could not seal ${KEY}`); }, open: async () => { throw new Error('no'); } };
    const res = await setKey(smDir, 'gemini', KEY, { backend: broken });
    assert.deepEqual(res, { ok: false, error: 'encrypt-failed' });
    await setKey(smDir, 'gemini', KEY, { backend: fakeBackend() });
    const other = { ...fakeBackend(), scheme: 'other' };
    assert.equal(await getKey(smDir, 'gemini', { backend: other }), null);
    assert.equal(other.calls.open, 0);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a damaged keys file reads as no keys', async () => {
  const smDir = tmp();
  try {
    writeFileSync(join(smDir, 'ai-keys.json'), '{not json');
    assert.deepEqual(listKeys(smDir), []);
    assert.equal(await getKey(smDir, 'gemini', { backend: fakeBackend() }), null);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the AES backend round-trips with a random machine secret kept beside the keys', async () => {
  const smDir = tmp();
  try {
    const backend = aesBackend(smDir);
    await setKey(smDir, 'deepseek', KEY, { backend });
    assert.ok(existsSync(join(smDir, 'ai-keys.secret')));
    if (process.platform !== 'win32') assert.equal(statSync(join(smDir, 'ai-keys.secret')).mode & 0o777, 0o600);
    assert.ok(!readFileSync(keysFile(smDir), 'utf8').includes('SECRETPART'));
    assert.equal(await getKey(smDir, 'deepseek', { backend: aesBackend(smDir) }), KEY);
    const sealedTwice = [await backend.seal(KEY), await backend.seal(KEY)];
    assert.notEqual(sealedTwice[0], sealedTwice[1], 'a fresh nonce each time');
    const tampered = Buffer.from(sealedTwice[0], 'base64');
    tampered[tampered.length - 1] ^= 1;
    await assert.rejects(backend.open(tampered.toString('base64')));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
