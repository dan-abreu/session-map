import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../store.mjs';
import { getKey, listKeys, removeKey, setKey } from './keys.mjs';
import { aiStatus, lifeOf } from './life.mjs';
import { normalizePath } from '../paths.mjs';
import { DEFAULT_PROJECT_CLASS, PROJECT_CLASSES, mergeProjectClasses, othersConfig, othersSettings, projectClasses } from './others.mjs';
import { estimateCostUSD, providerOf, publicCatalog, runApiJSON } from './providers.mjs';
import { bulkModelOf } from './router.mjs';

// What the "Other AIs" dialog reads and writes (or14): the keys, a switch per provider and ONE daily cap for all of
// them together. Which AI does which task is the router's decision (router.mjs), never the owner's.
// The transport (token, demo, logging) is in main.mjs; every answer here is free of any key.

const CONFIG_FILE = 'config.json';
const DAILY_MAX_USD = 1000;
const TEST_PROMPT = 'Reply with {"ok": true}';
const TEST_TIMEOUT_MS = 30_000;
const TEST_MAX_TOKENS = 64;
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
// roots: async () => the roots of the projects the map knows; a class can be set only for those.
export function createHelperRoutes({ smDir, ai = {}, backend, apiRun = runApiJSON, now = Date.now, roots = async () => [] }) {
  const lockOpt = backend ? { backend } : {};
  const life = () => lifeOf(smDir, readConfig(smDir) ?? {}, backend && !ai.keyOf ? { ...ai, keyOf: (provider) => getKey(smDir, provider, lockOpt) } : ai);
  const tests = [];
  const keyIds = () => listKeys(smDir).map((k) => k.provider);

  // others: what is chosen (enabled, the one daily cap, who is switched off); status.others: what is happening.
  const view = () => {
    const config = readConfig(smDir) ?? {};
    const keys = listKeys(smDir);
    // projectClass: the classes chosen so far, by normalized root; any project not in it is projectClassDefault.
    return {
      ok: true, providers: publicCatalog(), keys, others: othersSettings(config.ai, keys.map((k) => k.provider)), status: aiStatus(life()),
      projectClass: projectClasses(config.ai), projectClassDefault: DEFAULT_PROJECT_CLASS, projectClasses: [...PROJECT_CLASSES],
    };
  };

  // -> {change: {normalizedRoot: class|null}} or {error}. Only the roots of projects the map knows, only known classes.
  async function checkProjectClass(given) {
    if (!isObject(given) || !Object.keys(given).length) return { error: 'bad-project-class' };
    const known = new Set((await roots().catch(() => [])).filter((r) => typeof r === 'string' && r).map(normalizePath));
    const change = Object.create(null);
    for (const [root, cls] of Object.entries(given)) {
      if (cls !== null && !PROJECT_CLASSES.includes(cls)) return { error: 'bad-project-class' };
      const key = root.trim() ? normalizePath(root) : '';
      if (!known.has(key)) return { error: 'unknown-project' };
      change[key] = cls;
    }
    return { change };
  }

  // patch: {provider, key} saves a key; {provider, on} switches one AI on or off (on also gives a paused one another
  // chance); {dailyUSD} is the one cap for all; {enabled} switches every outside AI on or off at once;
  // {projectClass: {root: 'client'|'internal'|'public'|null}} sets how private each known project is (null: back to the
  // default, client). All or nothing: one unknown root or class refuses the whole request.
  async function save(patch) {
    if (!isObject(patch)) return fail(400, 'bad-helpers');
    const { key, on, enabled, dailyUSD, projectClass } = patch;
    if (key === undefined && on === undefined && enabled === undefined && dailyUSD === undefined && projectClass === undefined) return fail(400, 'bad-helpers');
    if (key !== undefined && (typeof key !== 'string' || !providerOf(patch.provider))) return fail(400, providerOf(patch.provider) ? 'invalid-key' : 'unknown-provider');
    if (on !== undefined) {
      if (!providerOf(patch.provider)) return fail(400, 'unknown-provider');
      if (typeof on !== 'boolean') return fail(400, 'bad-helpers');
    }
    if (enabled !== undefined && typeof enabled !== 'boolean') return fail(400, 'bad-helpers');
    if (dailyUSD !== undefined && !(typeof dailyUSD === 'number' && Number.isFinite(dailyUSD) && dailyUSD >= 0 && dailyUSD <= DAILY_MAX_USD)) return fail(400, 'bad-helpers');

    let classChange;
    if (projectClass !== undefined) {
      const checked = await checkProjectClass(projectClass);
      if (checked.error) return fail(400, checked.error);
      classChange = checked.change;
    }
    const config = readConfig(smDir);
    if (!config) return fail(409, 'config-unreadable');
    if (on === true && !keyIds().includes(patch.provider) && key === undefined) return fail(409, 'no-key');
    if (key !== undefined) {
      const saved = await setKey(smDir, patch.provider, key, lockOpt);
      if (!saved.ok) return fail(saved.error === 'encrypt-failed' ? 500 : 400, saved.error);
    }
    let resume = null;
    if (on !== undefined || enabled !== undefined || dailyUSD !== undefined || classChange) {
      const before = othersSettings(config.ai, keyIds());
      const change = {};
      if (enabled !== undefined) change.enabled = enabled;
      if (dailyUSD !== undefined) change.dailyUSD = dailyUSD;
      if (classChange) change.projectClass = mergeProjectClasses(config.ai, classChange);
      if (on !== undefined) {
        const rest = before.off.filter((p) => p !== patch.provider);
        change.off = on ? rest : [...rest, patch.provider];
        if (on) {
          // Switching one on is a choice to use the others, even if the old dialog had them all off.
          if (enabled === undefined) change.enabled = true;
          // A switch the owner flips on, or presses again while the AI is paused, starts it clean.
          const paused = life().queue.status().others?.providers.find((p) => p.id === patch.provider)?.paused;
          if (before.off.includes(patch.provider) || paused) resume = patch.provider;
        }
      }
      writeAtomic(join(smDir, CONFIG_FILE), `${JSON.stringify({ ...config, ai: othersConfig(config.ai, keyIds(), change) }, null, 2)}\n`);
    }
    if (resume) life().queue.resumeHelper(resume);
    return { status: 200, body: view() };
  }

  // The key goes; the switch stays as the owner left it. Without a key the AI is simply left out of the choosing.
  function remove(provider) {
    if (!providerOf(provider)) return fail(400, 'unknown-provider');
    if (!readConfig(smDir)) return fail(409, 'config-unreadable');
    removeKey(smDir, provider);
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
    // A test is a real paid call: it is held against the one daily cap like the bulk work, so it can never pass it.
    const settings = othersSettings((readConfig(smDir) ?? {}).ai, keyIds());
    const model = bulkModelOf(provider, settings.models);
    const { queue } = life();
    const ticket = queue.reserveOutside(provider, estimateCostUSD(provider, model, TEST_PROMPT, TEST_MAX_TOKENS), settings.dailyUSD);
    if (!ticket) return fail(429, 'cap-reached');
    let r = null;
    try {
      r = await apiRun(TEST_PROMPT, { provider, key, model, timeoutMs: TEST_TIMEOUT_MS, maxTokens: TEST_MAX_TOKENS });
    } finally {
      ticket.settle(Number(r?.costUSD));
    }
    // Only the verdict leaves: never the key, the model's words or an error body.
    if (r?.ok) return { status: 200, body: { ok: true, costUSD: Number.isFinite(r.costUSD) ? r.costUSD : 0 } };
    // 502: the provider, not this page, said no. The status keeps the page's generic client from reading it as a success.
    return fail(502, typeof r?.error === 'string' ? r.error.slice(0, 30) : 'failed');
  }

  return { view, save, remove, test };
}
