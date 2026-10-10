import { normalizePath } from '../paths.mjs';
import { providerOf } from './providers.mjs';

// The other AIs' settings (or14): the owner only pastes keys and sets ONE daily cap for all of them together; the
// router picks who does what. config.json's ai.others = {enabled?, dailyUSD, off: [providerIds], models?: {provider:
// model}}. Each provider may also spend up to the whole cap (its share is the cap). The old single-helper fields,
// ai.helper = {provider, model?, enabled} and ai.helperDailyUSD (sb07), are still read when ai.others is missing (the
// switch and the cap; not the old model).
//
// Sigilo por projeto: ai.others.projectClass = {[normalized project root]: 'client'|'internal'|'public'} is what the
// map's bulk work (digests of a project's conversations) may reveal. A project not listed is 'client', the strictest;
// the owner switches his own projects to a looser class on the page. The router turns the class into who may see it.

export const OTHERS_DAILY_USD_DEFAULT = 1;
export const PROJECT_CLASSES = Object.freeze(['client', 'internal', 'public']);
export const DEFAULT_PROJECT_CLASS = 'client';
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const validCap = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const providerList = (list) => [...new Set((Array.isArray(list) ? list : []).filter((p) => providerOf(p)))].sort();

function modelMap(models) {
  if (!isObject(models)) return {};
  return Object.fromEntries(Object.entries(models).filter(([p, m]) => providerOf(p) && typeof m === 'string' && MODEL_RE.test(m)));
}

// The valid entries of ai.others.projectClass, keyed by the normalized root: {root: class}. Anything else is dropped.
export function projectClasses(ai) {
  const raw = isObject(ai?.others) && isObject(ai.others.projectClass) ? ai.others.projectClass : {};
  const out = {};
  for (const [root, cls] of Object.entries(raw)) {
    if (typeof root === 'string' && root.trim() && PROJECT_CLASSES.includes(cls)) out[normalizePath(root)] = cls;
  }
  return out;
}

// The class of one project: what the owner chose, else 'client'.
export function projectClassOf(ai, root) {
  if (typeof root !== 'string' || !root.trim()) return DEFAULT_PROJECT_CLASS;
  const found = projectClasses(ai)[normalizePath(root)];
  return found ?? DEFAULT_PROJECT_CLASS;
}

// The class of the project with this id (projectIdOf of its root), for callers that only know the id.
export function projectClassOfId(ai, projectId, idOf) {
  for (const [root, cls] of Object.entries(projectClasses(ai))) if (idOf(root) === projectId) return cls;
  return DEFAULT_PROJECT_CLASS;
}

// The classes now with a change on top: {root: class} sets, {root: null} goes back to the default. The roots in the
// change must already be normalized and checked by the caller.
export function mergeProjectClasses(ai, change) {
  const out = { ...projectClasses(ai) };
  for (const [root, cls] of Object.entries(change)) {
    if (cls === null) delete out[root];
    else out[root] = cls;
  }
  return out;
}

// The explicit choices only, old or new, before defaults: {enabled?, dailyUSD?, off, models}.
function choices(ai) {
  const o = isObject(ai?.others) ? ai.others : null;
  const legacy = isObject(ai?.helper) && providerOf(ai.helper.provider) && typeof ai.helper.enabled === 'boolean' ? ai.helper : null;
  const out = { off: providerList(o?.off), models: modelMap(o?.models) };
  if (typeof o?.enabled === 'boolean') out.enabled = o.enabled;
  else if (legacy) out.enabled = legacy.enabled; // "Claude only" in the old dialog stays a choice
  if (validCap(o?.dailyUSD)) out.dailyUSD = o.dailyUSD;
  else if (validCap(ai?.helperDailyUSD)) out.dailyUSD = ai.helperDailyUSD;
  // The old helper's model is not carried over: it was picked for one job, and the router picks per kind of work now.
  return out;
}

// keyProviders: the providers with a saved key (listKeys). -> {enabled, dailyUSD, off, models, keys}
export function othersSettings(ai, keyProviders = []) {
  const keys = providerList(keyProviders);
  const c = choices(ai);
  return {
    enabled: c.enabled ?? keys.length > 0,
    dailyUSD: c.dailyUSD ?? OTHERS_DAILY_USD_DEFAULT,
    off: c.off,
    models: c.models,
    keys,
  };
}

// The ai part of config.json in the new shape, the old helper fields gone, with the page's patch
// ({enabled?, dailyUSD?, off?, models?}) on top. enabled is written only once someone chose it, so a key added later
// switches the other AIs on by itself.
export function othersConfig(ai, keyProviders = [], patch = {}) {
  const { helper, helperDailyUSD, others, ...rest } = isObject(ai) ? ai : {};
  const c = choices(ai);
  const merged = {
    ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : c.enabled !== undefined ? { enabled: c.enabled } : {}),
    dailyUSD: validCap(patch.dailyUSD) ? patch.dailyUSD : othersSettings(ai, keyProviders).dailyUSD,
    off: patch.off !== undefined ? providerList(patch.off) : c.off,
  };
  const models = patch.models !== undefined ? modelMap(patch.models) : c.models;
  if (Object.keys(models).length) merged.models = models;
  const classes = patch.projectClass !== undefined ? projectClasses({ others: { projectClass: patch.projectClass } }) : projectClasses(ai);
  if (Object.keys(classes).length) merged.projectClass = classes;
  return { ...rest, others: merged };
}
