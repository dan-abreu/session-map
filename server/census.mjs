// The program's own census (id130/mm57): reads the page's screens from the code — the areas of nav.js, each area's
// view files, their headings, buttons and dialogs, with every label kept as its i18n key so the page resolves it in
// the person's language. One source of truth: the Flow tab's "The program" level (server/censusroute.mjs).
// A label counts only when it is a real key of the page's own texts: a string that merely looks like a call to the
// translator (a tag name, a "\n", a storage key) is not a text the person sees, so it never reaches the drawing.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS } from './web/i18n.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const isKey = (key) => key in LANGS.en || key in LANGS['pt-BR'];

// Each area's view files, next to the code that ties them (server/web/areas.js).
export const AREA_FILES = {
  home: ['server/web/homeview.js', 'server/web/home.js'],
  route: ['server/web/compassview.js'],
  map: ['server/web/mindmap.js'],
  flow: ['server/web/flowview.js', 'server/web/flowlevel.js', 'server/web/flowgrid.js', 'server/web/flowexport.js', 'server/web/flow.js', 'server/web/programview.js'],
  requests: ['server/web/requestsview.js', 'server/web/requests.js'],
  convs: ['server/web/convlist.js', 'server/web/chat.js', 'server/web/chatfold.js', 'server/web/transcript.js'],
  changes: ['server/web/changes.js'],
  health: ['server/web/healthview.js', 'server/web/findingsview.js', 'server/web/careview.js'],
  ideas: ['server/web/ideasview.js'],
  costs: ['server/web/statementview.js', 'server/web/costwhy.js', 'server/web/budgetview.js'],
  brain: ['server/web/brainview.js'],
  library: ['server/web/libraryview.js', 'server/web/practicesview.js', 'server/web/profileview.js', 'server/web/uptodateview.js'],
  discover: ['server/web/discover.js'],
  logs: ['server/web/logsview.js', 'server/web/logs.js'],
};

// The part of index.html that is an area's own markup (its buttons and headings are written there, not drawn by code).
export const AREA_HTML = { map: 'view-map', flow: 'view-flow', discover: 'view-discover' };

// Everything on the page that no area claims — the bar, the map and its side panels, the alerts, the tour, the help —
// is one more room, found by walking server/web, so a new file never falls outside the drawing.
export const SHARED = 'shared';

// A text that only shows when something is empty, loading or wrong is a message of the screen, not one of its parts.
const MESSAGE_KEY = /(^|\.)(err|error|errors)([.A-Z-]|$)|\.(empty|none|noMatch|loading|building|failed|unavailable)([.A-Z]|$)/;
// How far after a heading, button, summary or dialog its own label may sit.
const NEAR = 180;

// The page calls the translator three ways — t('key'), tt('key') and t()('key') — and the census reads all three, but
// never a longer name that merely ends in a "t" (split('x'), text('x')).
const CALL = /(?<![\w$])(?:t\(\)|tt|t)\(\s*'([^']+)'\s*\)/g;
const JS_PART = /h\('(h[1-4])'|h\('button'|h\('summary'|h\('dialog'/g;
const HTML_TAG = /<(h[1-4]|button|summary|dialog|[a-z][a-z0-9]*)\b([^>]*)>/g;
const PART_TYPE = (tag) => (/^h[1-4]$/.test(tag) ? 'heading' : ['button', 'summary', 'dialog'].includes(tag) ? tag : null);

// The events of a script: the parts it draws and every text it asks the translator for.
function eventsOfScript(text) {
  const events = [];
  for (const m of text.matchAll(JS_PART)) events.push({ type: m[1] ? 'heading' : m[0].slice(3, -1), pos: m.index });
  for (const m of text.matchAll(CALL)) if (isKey(m[1])) events.push({ type: 'label', pos: m.index, key: m[1] });
  return events;
}

// The events of markup (a part's words are settled here, so a neighbour's never name it): a part may carry its own key (data-i18n, or the aria/title of an icon-only button), or be
// named by a tag inside it (a button holding a <span data-i18n>); a text is any other tag that names one. A word that
// sits after the part's closing tag is a neighbour's, never the part's own.
function eventsOfMarkup(html) {
  const events = [];
  const inside = new Set();
  for (const m of html.matchAll(HTML_TAG)) {
    const type = PART_TYPE(m[1]);
    if (!type) continue;
    const attr = (name) => new RegExp(`\\sdata-i18n${name}="([^"]+)"`).exec(m[2])?.[1];
    let key = attr('') ?? attr('-aria') ?? attr('-title');
    if (!key && type !== 'dialog') {
      const from = m.index + m[0].length;
      const close = html.indexOf(`</${m[1]}>`, from);
      const named = close < 0 ? null : /<[a-z][^>]*\sdata-i18n="([^"]+)"/.exec(html.slice(from, close));
      if (named) { key = named[1]; inside.add(from + named.index); }
    }
    events.push({ type, pos: m.index, resolved: true, ...(key && isKey(key) ? { key } : {}) });
  }
  for (const m of html.matchAll(HTML_TAG)) {
    const own = new RegExp('\\sdata-i18n="([^"]+)"').exec(m[2])?.[1];
    if (!PART_TYPE(m[1]) && own && isKey(own) && !inside.has(m.index)) events.push({ type: 'label', pos: m.index, key: own });
  }
  return events;
}

// Events in file order become sections: a named heading opens one, and in it every button, dialog, expandable block
// and text appears once. A part with no label of its own (its words come from data) is counted as "unnamed", never named.
function assemble(events, file) {
  events.sort((a, b) => a.pos - b.pos);
  const sections = [{ key: null, file, items: [] }];
  let unnamed = 0;
  let owner = null;
  const add = (type, key) => {
    const items = sections[sections.length - 1].items;
    if (!items.some((i) => i.type === type && i.key === key)) items.push({ type, key });
  };
  const place = (part) => {
    if (part.type === 'heading') { if (part.key) sections.push({ key: part.key, file, items: [] }); return; }
    if (part.key) add(part.type, part.key);
    else unnamed += 1;
  };
  const settle = () => { if (owner) place(owner); owner = null; };
  for (const e of events) {
    if (e.type !== 'label') { settle(); owner = e; continue; }
    if (owner && owner.key === undefined && !owner.resolved && e.pos - owner.pos < NEAR) { owner.key = e.key; settle(); continue; }
    add(MESSAGE_KEY.test(e.key) ? 'message' : 'text', e.key);
  }
  settle();
  return { sections: sections.filter((s) => s.key !== null || s.items.length), unnamed };
}

export const censusOfText = (text, file = '') => assemble(eventsOfScript(text), file);
export const censusOfMarkup = (html, file = '') => assemble(eventsOfMarkup(html), file);

const ITEM_COUNT = { button: 'buttons', dialog: 'dialogs', summary: 'blocks', text: 'texts', message: 'messages' };

export function countsOf(sections, unnamed = 0) {
  const counts = { sections: sections.filter((s) => s.key !== null).length, buttons: 0, dialogs: 0, blocks: 0, texts: 0, messages: 0, unnamed };
  for (const s of sections) for (const i of s.items) counts[ITEM_COUNT[i.type]] += 1;
  return counts;
}

const sum = (list, key) => list.reduce((s, c) => s + c[key], 0);

// The markup of one area inside index.html: from its element to the next view's.
function markupOf(html, id) {
  const from = html.indexOf(`id="${id}"`);
  if (from < 0) return '';
  const rest = html.slice(from + 1);
  const next = /\sid="view-[a-z]+"/.exec(rest);
  return next ? html.slice(from, from + 1 + next.index) : html.slice(from);
}

// The page's own script files: every .js of server/web, but the vendored libraries and the translation tables.
function pageFiles() {
  const out = [];
  const walk = (dir) => {
    for (const f of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${f.name}`;
      if (f.isDirectory()) { if (f.name !== 'vendor' && !f.name.startsWith('i18n')) walk(rel); } else if (f.name.endsWith('.js') && !f.name.startsWith('i18n')) out.push(rel);
    }
  };
  walk('server/web');
  return out.sort();
}

function areaOf(id, files, html) {
  const parts = files.map((f) => censusOfText(read(join(root, f)), f));
  if (AREA_HTML[id]) parts.unshift(censusOfMarkup(markupOf(html, AREA_HTML[id]), 'server/web/index.html'));
  const sections = parts.flatMap((p) => p.sections);
  const counts = countsOf(sections, sum(parts, 'unnamed'));
  return { id, label: `tab.${id}`, files: AREA_HTML[id] ? ['server/web/index.html', ...files] : files, sections, counts, items: counts.buttons + counts.dialogs + counts.blocks + counts.texts + counts.messages };
}

export function uiTree() {
  const navText = read(join(root, 'server', 'web', 'nav.js'));
  const html = read(join(root, 'server', 'web', 'index.html'));
  const ids = [...navText.matchAll(/\{ id: '([a-z]+)',/g)].map((m) => m[1]);
  const claimed = new Set(Object.values(AREA_FILES).flat());
  const areas = ids.map((id) => areaOf(id, AREA_FILES[id] ?? [], html));
  const rest = pageFiles().filter((f) => !claimed.has(f) && censusOfText(read(join(root, f)), f).sections.length);
  areas.push({ ...areaOf(SHARED, rest, html), label: 'program.shared' });
  const counts = Object.fromEntries(Object.keys(areas[0].counts).map((k) => [k, sum(areas.map((a) => a.counts), k)]));
  return { generatedAt: new Date().toISOString(), counts: { areas: areas.length, ...counts }, areas };
}
