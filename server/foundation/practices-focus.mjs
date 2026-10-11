import { readFd } from './store.mjs';
import { loadLibrary, localKnowledgeDir, sharedKnowledgeDir, textIn } from './library.mjs';
import { log } from '../log.mjs';

// fd boas-praticas: the few open practices that matter to the point of the map a chat is opened on, as a short block of
// text for the chat's first request. Exact, no AI: it only picks from practices.json (states) and the packages (texts).
// A practice is offered only when it is failing or unchecked, and only for the part's own stacks plus the fronts asked.

export const FOCUS_BYTES = 700;
export const FOCUS_LIMIT = 4;
export const FOCUS_KINDS = ['part', 'group', 'item'];
const DEFAULT_FRONTS = ['quality', 'security'];
const WHAT_CHARS = 140;
const STATE_ORDER = { fail: 0, unverified: 1 };
const SEVERITY_ORDER = { E: 0, R: 1, A: 2 };

const WORDS = {
  en: {
    head: 'Good practices still open for this point (bring one up only when it fits what is being asked; never the whole list):',
    unverified: 'not checked',
  },
  'pt-BR': {
    head: 'Boas práticas ainda em aberto neste ponto (traga uma só quando couber no pedido; nunca a lista toda):',
    unverified: 'não verificado',
  },
};

// The transcript reader counts tokens of this shape as item codes and places the chat by them: none may go in.
const hasCode = (text) => /(?<![\w-])[a-z]{1,4}(?:-[a-z]{1,4})?\d{1,4}(?![\w-])/i.test(text);
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lowerName = (v) => String(isObj(v) ? v.name : v ?? '').trim().toLowerCase();

const langOf = (lang) => (String(lang ?? '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en');

function cleanPath(p) {
  let s = String(p ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
  const glob = s.search(/[*?[{]/);
  if (glob >= 0) s = s.slice(0, glob).replace(/[^/]*$/, '');
  return s.replace(/\/+$/, '');
}

// A manifest at the root serves every part; one deeper serves the paths below it (and a part wholly inside it).
function stacksOfPart(profile, part) {
  const detected = isObj(profile?.detected) ? profile.detected : profile;
  const paths = list(part?.codePaths).map(cleanPath).filter(Boolean);
  const out = new Set();
  for (const s of list(detected?.stacks)) {
    const name = lowerName(s);
    if (!name) continue;
    const file = String(s.file ?? '').replaceAll('\\', '/');
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    if (!dir || paths.some((p) => p === dir || p.startsWith(`${dir}/`) || dir.startsWith(`${p}/`))) out.add(name);
  }
  return out;
}

function byteSafe(text, max) {
  if (bytes(text) <= max) return text;
  const chars = Array.from(text);
  while (chars.length && bytes(`${chars.join('')}…`) > max) chars.pop();
  return chars.length ? `${chars.join('').trimEnd()}…` : '';
}

function shorten(text, max) {
  const chars = Array.from(String(text).replace(/\s+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : chars.join('');
}

// input: { practices: practices.json, packages: library packages, profile: profile.json (stored or flat), part: {codePaths},
//   lang: 'pt' | 'pt-BR' | 'en', limit = 4, fronts = ['quality', 'security'] } → text, or '' when there is nothing to say.
export function practicesFocus({ practices, packages, profile, part, lang = 'en', limit = FOCUS_LIMIT, fronts = DEFAULT_FRONTS } = {}) {
  if (!part || !isObj(practices) || !Array.isArray(practices.items)) return '';
  const tongue = langOf(lang);
  const words = WORDS[tongue];
  const stacks = stacksOfPart(profile, part);
  const wantedFronts = new Set(list(fronts));
  const byPkg = new Map(list(packages).filter((p) => isObj(p) && typeof p.id === 'string').map((p) => [p.id, p]));
  const picked = [];
  for (const row of practices.items) {
    if (!isObj(row) || !(row.state in STATE_ORDER)) continue;
    const pkg = byPkg.get(row.pkg);
    const item = list(pkg?.items).find((i) => i?.id === row.id);
    const title = shorten(textIn(item?.title, tongue), 120);
    if (!title) continue;
    const ofStack = pkg.kind === 'stack';
    if (ofStack ? !list(pkg.applies?.stacks).some((s) => stacks.has(lowerName(s))) : !wantedFronts.has(row.front)) continue;
    picked.push({ row, title, what: shorten(textIn(item.what, tongue), WHAT_CHARS) });
  }
  picked.sort((a, b) => STATE_ORDER[a.row.state] - STATE_ORDER[b.row.state]
    || (SEVERITY_ORDER[a.row.severity] ?? 9) - (SEVERITY_ORDER[b.row.severity] ?? 9)
    || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));

  const max = Math.max(0, Math.min(Number.isInteger(limit) ? limit : FOCUS_LIMIT, FOCUS_LIMIT));
  const lines = [];
  let used = bytes(words.head);
  for (const { row, title, what } of picked) {
    if (lines.length >= max) break;
    const tag = row.state === 'unverified' ? ` [${words.unverified}]` : '';
    const room = FOCUS_BYTES - used - 1;
    const candidates = [what && `- ${title}: ${what}${tag}`, `- ${title}${tag}`].filter(Boolean);
    const line = candidates.find((c) => !hasCode(c) && bytes(c) <= room)
      ?? (hasCode(candidates.at(-1)) ? null : byteSafe(candidates.at(-1), room));
    if (!line) continue;
    lines.push(line);
    used += 1 + bytes(line);
  }
  return lines.length ? [words.head, ...lines].join('\n') : '';
}

// What the hub reads once when a conversation starts: null (so nothing changes) unless practices.json exists.
export function focusInputs(smDir, projectId, { sharedDir, localDir } = {}) {
  try {
    const practices = readFd(smDir, projectId, 'practices.json', null);
    if (!isObj(practices) || !Array.isArray(practices.items) || !practices.items.length) return null;
    const { packages } = loadLibrary({ sharedDir: sharedDir ?? sharedKnowledgeDir(), localDir: localDir ?? localKnowledgeDir(smDir) });
    return { practices, packages, profile: readFd(smDir, projectId, 'profile.json', null) };
  } catch (err) {
    log('warn', 'practices-focus.inputs', { error: err.message });
    return null;
  }
}
