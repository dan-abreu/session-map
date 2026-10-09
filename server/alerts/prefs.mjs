// What the person wants to be told and how (watcher-and-alerts wa05): `notify` in session-map's own config.json.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../store.mjs';
import { LANGS } from '../web/i18n.js';

const CONFIG_FILE = 'config.json';
const KINDS = ['finished', 'waiting', 'error', 'clash'];
const TOPIC_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PROJECT_RE = /^[a-z0-9][a-z0-9._-]{0,120}$/i;
const PROJECTS_MAX = 500;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const flag = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

function cleanProjects(raw) {
  const out = {};
  for (const [id, kinds] of Object.entries(isObject(raw) ? raw : {}).slice(0, PROJECTS_MAX)) {
    if (!PROJECT_RE.test(id) || !isObject(kinds)) continue;
    const picked = Object.fromEntries(KINDS.filter((k) => typeof kinds[k] === 'boolean').map((k) => [k, kinds[k]]));
    if (Object.keys(picked).length) out[id] = picked;
  }
  return out;
}

// A hand-written file may hold anything: each field falls back on its own. The phone stays off without a valid topic.
export function notifyPrefs(userConfig) {
  const n = isObject(userConfig?.notify) ? userConfig.notify : {};
  const ntfy = isObject(n.ntfy) ? n.ntfy : {};
  const topic = typeof ntfy.topic === 'string' && TOPIC_RE.test(ntfy.topic) ? ntfy.topic : null;
  return {
    browser: flag(n.browser, true),
    desktop: flag(n.desktop, true),
    sound: flag(n.sound, false),
    ntfy: { enabled: Boolean(topic) && ntfy.enabled === true, topic },
    perProject: cleanProjects(n.perProject),
    lang: typeof n.lang === 'string' && LANGS[n.lang] ? n.lang : null,
  };
}

function validPatch(p) {
  if (!isObject(p)) return false;
  if (['browser', 'desktop', 'sound'].some((k) => p[k] !== undefined && typeof p[k] !== 'boolean')) return false;
  if (p.lang !== undefined && !(typeof p.lang === 'string' && LANGS[p.lang])) return false;
  if (p.ntfy !== undefined && !(isObject(p.ntfy) && typeof p.ntfy.enabled === 'boolean')) return false;
  if (p.perProject === undefined) return true;
  if (!isObject(p.perProject) || Object.keys(p.perProject).length > PROJECTS_MAX) return false;
  return Object.entries(p.perProject).every(([id, kinds]) => PROJECT_RE.test(id) && isObject(kinds)
    && Object.entries(kinds).every(([k, v]) => KINDS.includes(k) && typeof v === 'boolean'));
}

// patch: any of {browser, desktop, sound, lang, ntfy: {enabled}, perProject: {id: {kind: bool}}}; the rest of config.json
// stays as the person wrote it. Turning the phone on the first time draws a random topic, which only they know.
export function setNotifyPrefs(smDir, patch) {
  if (!validPatch(patch)) return { ok: false, error: 'bad-notify' };
  const file = join(smDir, CONFIG_FILE);
  let config = {};
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: 'config-unreadable' };
  }
  if (!isObject(config)) return { ok: false, error: 'config-unreadable' };
  const now = notifyPrefs(config);
  const projects = { ...now.perProject };
  for (const [id, kinds] of Object.entries(patch.perProject ?? {})) projects[id] = { ...projects[id], ...kinds };
  const topic = now.ntfy.topic ?? (patch.ntfy?.enabled ? `sm-${randomBytes(12).toString('hex')}` : null);
  const notify = {
    ...now,
    ...Object.fromEntries(['browser', 'desktop', 'sound', 'lang'].filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]])),
    ntfy: { enabled: patch.ntfy ? patch.ntfy.enabled : now.ntfy.enabled, topic },
    perProject: projects,
  };
  writeAtomic(file, `${JSON.stringify({ ...config, notify }, null, 2)}\n`);
  return { ok: true, notify };
}
