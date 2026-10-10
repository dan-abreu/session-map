import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../store.mjs';
import { helperSettings } from './helper.mjs';
import { getKey, listKeys, removeKey, setKey } from './keys.mjs';
import { aiStatus, lifeOf } from './life.mjs';
import { providerOf, publicCatalog, runApiJSON } from './providers.mjs';

// What the "Other AIs" dialog reads and writes (sb07): the keys, which helper takes the bulk work and its daily cap.
// The transport (token, demo, logging) is in main.mjs; every answer here is free of any key.

const CONFIG_FILE = 'config.json';
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const DAILY_MAX_USD = 1000;
const TEST_PROMPT = 'Reply with {"ok": true}';
const TEST_TIMEOUT_MS = 30_000;
const TEST_LIMIT = 5;
const TEST_WINDOW_MS = 60_000;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const fail = (status, error) => ({ status, body: { ok: false, error } });

function readConfig(smDir) {
  try {
    const config = JSON.parse(readFileSync(join(smDir, CONFIG_FILE), 'utf8'));
    return isObject(config) ? config : null;
  } catch (err) {
    return err.code === 'ENOENT' ? {} : null;
  }
}

// ai: the test doubles the page's collect also gets ({bin, run, apiRun, keyOf}); backend: the lock for keys (tests).
export function createHelperRoutes({ smDir, ai = {}, backend, apiRun = runApiJSON, now = Date.now }) {
  const lockOpt = backend ? { backend } : {};
  const life = () => lifeOf(smDir, readConfig(smDir) ?? {}, backend && !ai.keyOf ? { ...ai, keyOf: (provider) => getKey(smDir, provider, lockOpt) } : ai);
  const tests = [];

  const view = () => {
    const config = readConfig(smDir) ?? {};
    return { ok: true, providers: publicCatalog(), keys: listKeys(smDir), helper: helperSettings(config.ai), status: aiStatus(life()) };
  };

  // patch: {provider, key?} and/or {helper: {provider, model?, enabled}, dailyUSD}
  async function save(patch) {
    if (!isObject(patch)) return fail(400, 'bad-helpers');
    const { key, helper, dailyUSD } = patch;
    if (key === undefined && helper === undefined && dailyUSD === undefined) return fail(400, 'bad-helpers');
    if (key !== undefined && (typeof key !== 'string' || !providerOf(patch.provider))) return fail(400, providerOf(patch.provider) ? 'invalid-key' : 'unknown-provider');
    if (helper !== undefined) {
      if (!isObject(helper) || !providerOf(helper.provider)) return fail(400, 'unknown-provider');
      if (typeof helper.enabled !== 'boolean') return fail(400, 'bad-helpers');
      // '' is the page's empty field: the provider's usual model, no pin.
      if (helper.model !== undefined && helper.model !== '' && !(typeof helper.model === 'string' && MODEL_RE.test(helper.model))) return fail(400, 'bad-helpers');
    }
    if (dailyUSD !== undefined && !(typeof dailyUSD === 'number' && Number.isFinite(dailyUSD) && dailyUSD >= 0 && dailyUSD <= DAILY_MAX_USD)) return fail(400, 'bad-helpers');

    const config = readConfig(smDir);
    if (!config) return fail(409, 'config-unreadable');
    if (key !== undefined) {
      const saved = await setKey(smDir, patch.provider, key, lockOpt);
      if (!saved.ok) return fail(saved.error === 'encrypt-failed' ? 500 : 400, saved.error);
    }
    const aiConfig = isObject(config.ai) ? { ...config.ai } : {};
    let resume = null;
    if (helper !== undefined) {
      if (helper.enabled && !listKeys(smDir).some((k) => k.provider === helper.provider)) return fail(409, 'no-key');
      const before = helperSettings(config.ai);
      const model = helper.model ?? (before.provider === helper.provider ? aiConfig.helper?.model : undefined);
      aiConfig.helper = { provider: helper.provider, ...(model ? { model } : {}), enabled: helper.enabled };
      // A helper the owner turns on, swaps, gives a new model or saves again while paused starts clean: the page tells
      // them to save the choice again to give a paused helper another chance.
      const after = helperSettings(aiConfig);
      const same = before.enabled && before.provider === after.provider && before.model === after.model;
      if (helper.enabled && (!same || life().queue.status().helper?.paused)) resume = helper.provider;
    }
    if (dailyUSD !== undefined) aiConfig.helperDailyUSD = dailyUSD;
    if (helper !== undefined || dailyUSD !== undefined) {
      writeAtomic(join(smDir, CONFIG_FILE), `${JSON.stringify({ ...config, ai: aiConfig }, null, 2)}\n`);
    }
    if (resume) life().queue.resumeHelper(resume);
    return { status: 200, body: view() };
  }

  function remove(provider) {
    if (!providerOf(provider)) return fail(400, 'unknown-provider');
    const config = readConfig(smDir);
    if (!config) return fail(409, 'config-unreadable');
    removeKey(smDir, provider);
    // Without its key the helper could only fall back to Claude: say so in the choice too.
    const h = helperSettings(config.ai);
    if (h.enabled && h.provider === provider) {
      writeAtomic(join(smDir, CONFIG_FILE), `${JSON.stringify({ ...config, ai: { ...config.ai, helper: { ...config.ai.helper, enabled: false } } }, null, 2)}\n`);
    }
    return { status: 200, body: view() };
  }

  async function test(provider) {
    if (!providerOf(provider)) return fail(400, 'unknown-provider');
    const t = now();
    while (tests.length && t - tests[0] >= TEST_WINDOW_MS) tests.shift();
    if (tests.length >= TEST_LIMIT) return fail(429, 'too-many-tests');
    tests.push(t);
    const key = await getKey(smDir, provider, lockOpt);
    if (!key) return fail(409, 'no-key');
    // A test is a real paid call: it counts against the provider's daily cap, and stops there like the bulk work.
    const settings = helperSettings((readConfig(smDir) ?? {}).ai);
    const { queue } = life();
    if (queue.spentToday(provider) >= settings.dailyUSD) return fail(429, 'cap-reached');
    const model = settings.provider === provider ? settings.model : undefined;
    const r = await apiRun(TEST_PROMPT, { provider, key, timeoutMs: TEST_TIMEOUT_MS, ...(model ? { model } : {}) });
    queue.recordSpend(provider, Number(r?.costUSD));
    // Only the verdict leaves: never the key, the model's words or an error body.
    if (r?.ok) return { status: 200, body: { ok: true, costUSD: Number.isFinite(r.costUSD) ? r.costUSD : 0 } };
    // 502: the provider, not this page, said no. The status keeps the page's generic client from reading it as a success.
    return fail(502, typeof r?.error === 'string' ? r.error.slice(0, 30) : 'failed');
  }

  return { view, save, remove, test };
}
