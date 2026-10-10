import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.mjs';
import { readJsonFile } from '../store.mjs';
import { providerOf } from './providers.mjs';

// The keys of the helper AIs live only in session-map's own folder, never in a project (which may be shared or
// committed), each one locked: DPAPI for the current Windows user, elsewhere AES-256-GCM with a random machine secret.
// Nothing here ever logs, returns or throws a key; the page only ever sees the last four characters.

const KEY_MIN = 10;
const KEY_MAX = 400;
const PRINTABLE = /^[\x21-\x7E]+$/;
const DPAPI_TIMEOUT_MS = 20_000;

export const keysFile = (smDir) => join(smDir, 'ai-keys.json');
const secretFile = (smDir) => join(smDir, 'ai-keys.secret');

// Opened keys stay in memory, so DPAPI's PowerShell runs once per key and not once per call.
const opened = new Map();
const memoKey = (smDir, provider) => `${smDir}\0${provider}`;

function writePrivate(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* Windows: the user's profile folder already keeps it private */ }
}

// ---- the locks ---------------------------------------------------------------------

const powershell = () => {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  return root ? join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
};

// The secret travels on stdin as base64 and comes back the same way: never on the command line.
const DPAPI_SCRIPT = (verb) => [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())',
  "$extra = [Text.Encoding]::UTF8.GetBytes('session-map ai keys')",
  `$out = [Security.Cryptography.ProtectedData]::${verb}($data, $extra, 'CurrentUser')`,
  '[Console]::Out.Write([Convert]::ToBase64String($out))',
].join('\n');

function runPowershell(script, inputB64) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    let child;
    try {
      child = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      reject(new Error(`dpapi-spawn ${err.code ?? ''}`.trim()));
      return;
    }
    let out = '';
    const timer = setTimeout(() => child.kill(), DPAPI_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`dpapi-spawn ${err.code ?? ''}`.trim())); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`dpapi-exit ${code}`));
    });
    child.stdin.end(inputB64);
  });
}

export function dpapiBackend() {
  return {
    scheme: 'dpapi',
    seal: async (plain) => runPowershell(DPAPI_SCRIPT('Protect'), Buffer.from(plain, 'utf8').toString('base64')),
    open: async (sealed) => Buffer.from(await runPowershell(DPAPI_SCRIPT('Unprotect'), sealed), 'base64').toString('utf8'),
  };
}

function machineSecret(smDir) {
  try {
    const stored = Buffer.from(readFileSync(secretFile(smDir), 'utf8').trim(), 'base64');
    if (stored.length === 32) return stored;
  } catch { /* first key on this machine */ }
  const fresh = randomBytes(32);
  mkdirSync(smDir, { recursive: true });
  writePrivate(secretFile(smDir), fresh.toString('base64'));
  return fresh;
}

// Sealed text: base64 of nonce (12) + tag (16) + ciphertext.
export function aesBackend(smDir) {
  return {
    scheme: 'aes-256-gcm',
    seal: async (plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', machineSecret(smDir), iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    open: async (sealed) => {
      const raw = Buffer.from(sealed, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', machineSecret(smDir), raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

export const defaultBackend = (smDir) => (process.platform === 'win32' ? dpapiBackend() : aesBackend(smDir));

// ---- the store ---------------------------------------------------------------------

function readStore(smDir) {
  const stored = readJsonFile(keysFile(smDir), null);
  const keys = stored?.keys && typeof stored.keys === 'object' && !Array.isArray(stored.keys) ? stored.keys : {};
  return { version: 1, keys: Object.fromEntries(Object.entries(keys).filter(([id, k]) => providerOf(id) && typeof k?.data === 'string')) };
}

const writeStore = (smDir, store) => {
  mkdirSync(smDir, { recursive: true });
  writePrivate(keysFile(smDir), JSON.stringify(store, null, 1));
};

// null when the key may be stored, else a short reason.
export function validateKey(provider, key) {
  if (!providerOf(provider)) return 'unknown-provider';
  if (typeof key !== 'string' || key.length < KEY_MIN || key.length > KEY_MAX || !PRINTABLE.test(key)) return 'invalid-key';
  return null;
}

export async function setKey(smDir, provider, key, { backend = defaultBackend(smDir), now = () => new Date().toISOString() } = {}) {
  const invalid = validateKey(provider, key);
  if (invalid) return { ok: false, error: invalid };
  let data;
  try {
    data = await backend.seal(key);
  } catch {
    log('warn', 'ai-key-seal-failed', { provider, scheme: backend.scheme });
    return { ok: false, error: 'encrypt-failed' };
  }
  const store = readStore(smDir);
  const entry = { scheme: backend.scheme, data, last4: key.slice(-4), savedAt: now() };
  store.keys[provider] = entry;
  writeStore(smDir, store);
  opened.delete(memoKey(smDir, provider));
  return { ok: true, key: { provider, set: true, last4: entry.last4, savedAt: entry.savedAt } };
}

export function removeKey(smDir, provider) {
  opened.delete(memoKey(smDir, provider));
  const store = readStore(smDir);
  if (!Object.hasOwn(store.keys, provider)) return false;
  delete store.keys[provider];
  writeStore(smDir, store);
  return true;
}

// Server side only: the key itself, or null when none is stored or it cannot be opened here.
export async function getKey(smDir, provider, { backend = defaultBackend(smDir) } = {}) {
  if (!providerOf(provider)) return null;
  const entry = readStore(smDir).keys[provider];
  if (!entry || entry.scheme !== backend.scheme) return null;
  const memo = opened.get(memoKey(smDir, provider));
  if (memo?.data === entry.data) return memo.key;
  try {
    const key = await backend.open(entry.data);
    opened.set(memoKey(smDir, provider), { data: entry.data, key });
    return key;
  } catch {
    log('warn', 'ai-key-open-failed', { provider, scheme: entry.scheme });
    return null;
  }
}

export function listKeys(smDir) {
  return Object.entries(readStore(smDir).keys)
    .map(([provider, k]) => ({ provider, set: true, last4: String(k.last4 ?? ''), savedAt: k.savedAt ?? null }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}
