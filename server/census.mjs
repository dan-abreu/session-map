// The program's own census (id130/mm57): reads the page's screens from the code — the areas of nav.js, each area's
// view files, their headings, buttons and dialogs, with every label kept as its i18n key so the page resolves it in
// the person's language. One source of truth: the Flow tab's "The program" level (server/censusroute.mjs) and the
// offline drawings (.dev/execucao/census-ui.mjs) both read from here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// Each area's view files, next to the code that ties them (server/web/areas.js).
export const AREA_FILES = {
  home: ['server/web/homeview.js', 'server/web/home.js'],
  route: ['server/web/compassview.js'],
  map: ['server/web/mindmap.js'],
  flow: ['server/web/flowview.js', 'server/web/flowlevel.js', 'server/web/flowgrid.js', 'server/web/flowexport.js', 'server/web/flow.js'],
  requests: ['server/web/requestsview.js', 'server/web/requests.js'],
  convs: ['server/web/convlist.js', 'server/web/chat.js', 'server/web/chatfold.js', 'server/web/transcript.js'],
  changes: ['server/web/changes.js'],
  health: ['server/web/healthview.js', 'server/web/findingsview.js', 'server/web/careview.js'],
  ideas: ['server/web/ideasview.js'],
  costs: ['server/web/statementview.js', 'server/web/costwhy.js', 'server/web/budgetview.js'],
  brain: ['server/web/brainview.js'],
  library: ['server/web/libraryview.js', 'server/web/practicesview.js', 'server/web/profileview.js', 'server/web/uptodateview.js'],
  discover: ['server/web/discover.js'],
};

// A screen's parts, in file order: headings, buttons, summaries and dialogs, and the text keys near them. The page
// calls the translator three ways — t('key'), tt('key') and t()('key') — and the census reads all three.
function censusOf(file) {
  const text = read(join(root, file));
  const events = [];
  for (const m of text.matchAll(/h\('(h[1-4])'|h\('button'|h\('summary'|h\('dialog'/g)) {
    if (m[1]) events.push({ type: 'heading', pos: m.index, level: Number(m[1][1]) });
    else events.push({ type: m[0].includes('button') ? 'button' : m[0].includes('dialog') ? 'dialog' : 'summary', pos: m.index });
  }
  for (const m of text.matchAll(/(?:t\(\)|tt|t)\(\s*'([^']+)'\s*\)/g)) {
    events.push({ type: 'label', pos: m.index, key: m[1] });
  }
  events.sort((a, b) => a.pos - b.pos);
  const nodes = [];
  let last = null;
  for (const e of events) {
    if (e.type === 'label') {
      if (last && e.pos - last.pos < 180 && last.type !== 'label') { last.label = e.key; last.key = true; continue; }
      nodes.push({ type: 'label', label: e.key, key: true });
    } else {
      last = e; e.children = []; nodes.push(e);
    }
  }
  const rootNode = { type: 'root', level: 0, children: [] };
  const stack = [rootNode];
  for (const n of nodes) {
    if (n.type === 'heading') {
      while (stack.length > 1 && stack[stack.length - 1].level >= n.level) stack.pop();
      stack[stack.length - 1].children.push(n);
      stack.push(n);
    } else {
      stack[stack.length - 1].children.push(n);
    }
  }
  return rootNode.children;
}

export const countNodes = (ns) => ns.reduce((s, n) => s + 1 + countNodes(n.children ?? []), 0);

export function uiTree() {
  const navText = read(join(root, 'server', 'web', 'nav.js'));
  const ids = [...navText.matchAll(/\{ id: '([a-z]+)',/g)].map((m) => m[1]);
  const areas = ids.map((id) => {
    const nodes = (AREA_FILES[id] ?? []).flatMap(censusOf);
    return { id, label: `tab.${id}`, files: AREA_FILES[id] ?? [], nodes, items: countNodes(nodes) };
  });
  return { generatedAt: new Date().toISOString(), areas };
}
