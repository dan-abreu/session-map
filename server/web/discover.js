import { emptyState } from './empty.js';

const TYPES = ['skill', 'plugin', 'marketplace', 'mcp', 'agent', 'hook'];
const CATEGORIES = ['design', 'security', 'testing', 'code', 'writing', 'data', 'devops', 'product', 'marketing', 'media', 'workflow', 'education', 'ai', 'other'];
const SORTS = ['stars', 'updated', 'name'];
const DEBOUNCE_MS = 250;

// The Discover tab: a catalog of skills and plugins from GitHub, with a confirmation step before anything is installed,
// and the airplane mode (id136): one switch that turns every installed skill and plugin off for the chats that open
// next — the program's own plugin never falls.
// ctx: h (element helper), t (translator getter), lang, project ({id, name, plugins, skills} or null), toast, api,
// skillsAirplane (the global kill-switch) and skillsOff (the per-skill list).
export function createDiscover({ root, h, t, lang, project, toast, icon, api, skillsAirplane = () => false, skillsOff = () => [] }) {
  const q = (sel) => root.querySelector(sel);
  const dialog = q('#installDialog');
  let loaded = false;
  let timer = 0;
  let lastResponse = null;

  const option = (value, label) => h('option', { value }, label);
  const fill = (select, values, labelOf, allLabel) => {
    const keep = select.value;
    select.replaceChildren(...[allLabel && option('', allLabel), ...values.map((v) => option(v, labelOf(v)))].filter(Boolean));
    if (keep) select.value = keep;
  };

  function relabel() {
    q('#discoverSearch').placeholder = t()('discover.search');
    fill(q('#discoverSort'), SORTS, (v) => t()(`discover.sort.${v}`));
    fill(q('#discoverType'), TYPES, (v) => t()(`type.${v}`), t()('discover.type.all'));
    fill(q('#discoverCategory'), CATEGORIES, (v) => t()(`category.${v}`), t()('discover.category.all'));
    drawInstalled();
    if (lastResponse) render(lastResponse);
  }

  // The installed panel (id136/id138): the kill-switch on top, then the installed skills and the installed plugins,
  // each group with its professional name. The catalog sits below, under its own heading.
  function drawInstalled() {
    const tt = t();
    const box = q('#discoverAirplane');
    if (!box) return; // the panel's element is not there: nothing to draw
    const off = skillsAirplane();
    const proj = project();
    const skills = proj?.skills ?? [];
    const plugs = (proj?.plugins ?? []).filter((p) => p?.id && p?.name);
    const offList = new Set((skillsOff() ?? []).map((x) => String(x).toLowerCase()));
    const flipBtn = h('button', { type: 'button', class: `btn${off ? ' is-off' : ''}` }, tt(off ? 'discover.airplaneOff' : 'discover.airplaneOn'));
    flipBtn.addEventListener('click', async () => {
      flipBtn.disabled = true;
      const res = await api.setSkillsAirplane(!off);
      flipBtn.disabled = false;
      if (res && !res.error) drawInstalled();
      else toast(t()('discover.airplaneFailed'));
    });
    const skillRows = skills.length
      ? skills.map((s) => {
          const isOff = offList.has(String(s.name).toLowerCase()) || offList.has(String(s.command).toLowerCase());
          return h('li', { class: 'dv-row' },
            h('span', { class: 'dv-name' }, s.name),
            h('span', { class: 'dv-meta' }, s.command),
            h('span', { class: `pill ${isOff ? 'tone-idle' : 'tone-active'}` }, tt(isOff ? 'discover.off' : 'discover.on')),
            h('button', { type: 'button', class: 'btn small-btn', onclick: async () => { await api.setSkill(s.command, isOff); drawInstalled(); } },
              tt(isOff ? 'plugins.turnOn' : 'plugins.turnOff')));
        })
      : [h('li', { class: 'empty' }, tt('discover.noneInstalled'))];
    const plugRows = plugs.length
      ? plugs.map((p) => h('li', { class: 'dv-row' },
          h('span', { class: 'dv-name' }, p.name),
          h('span', { class: `pill ${p.enabled ? 'tone-active' : 'tone-idle'}` }, tt(p.enabled ? 'discover.on' : 'discover.off')),
          h('button', { type: 'button', class: 'btn small-btn', onclick: async () => { await api.setPlugin(p.id, !p.enabled); drawInstalled(); } },
            tt(p.enabled ? 'plugins.turnOff' : 'plugins.turnOn'))))
      : [h('li', { class: 'empty' }, tt('discover.noneInstalled'))];
    box.replaceChildren(
      h('div', { class: 'dv-card' },
        h('div', { class: 'dv-head' },
          h('span', { class: 'dv-name' }, tt('discover.airplane')),
          h('span', { class: `pill ${off ? 'tone-waiting' : 'tone-active'}` }, tt(off ? 'discover.on' : 'discover.off')),
          flipBtn),
        h('p', { class: 'dv-desc' }, tt('discover.airplaneHint'))),
      h('div', { class: 'dv-card' },
        h('h3', { class: 'dv-lede' }, tt('discover.installedSkills')),
        h('ul', { class: 'dv-list' }, ...skillRows)),
      h('div', { class: 'dv-card' },
        h('h3', { class: 'dv-lede' }, tt('discover.installedPlugins')),
        h('ul', { class: 'dv-list' }, ...plugRows)));
  }

  const stamp = (iso) => new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'short', year: 'numeric' }).format(Date.parse(iso));
  const safeUrl = (item) => (String(item.url).startsWith('https://github.com/') ? item.url : `https://github.com/${item.repo}`);
  const commandOf = (item) => (item.hasMarketplace || item.type === 'plugin' || item.type === 'marketplace'
    ? `/plugin marketplace add ${item.repo}`
    : `git clone https://github.com/${item.repo}.git`);

  async function copy(item) {
    const command = commandOf(item);
    try {
      await navigator.clipboard.writeText(command);
      toast(t()('discover.copied'));
    } catch {
      toast(command);
    }
  }

  function card(item) {
    const tt = t();
    return h('li', { class: 'dv-card' },
      h('div', { class: 'dv-head' },
        h('a', { class: 'dv-name', href: safeUrl(item), target: '_blank', rel: 'noopener noreferrer' }, item.name),
        h('span', { class: 'dv-owner' }, item.owner),
        h('span', { class: 'dv-stars num' }, tt('discover.stars', { n: item.stars.toLocaleString(lang()) }))),
      h('p', { class: 'dv-desc' }, item.description || tt('discover.noDescription')),
      h('div', { class: 'dv-meta' },
        h('span', { class: 'pill tone-idle' }, tt(`type.${item.type}`)),
        h('span', { class: 'pill tone-idle' }, tt(`category.${item.category}`)),
        item.installed && h('span', { class: 'pill tone-active' }, tt('discover.installed')),
        item.archived && h('span', { class: 'pill tone-waiting' }, tt('discover.archived')),
        h('span', { class: 'dv-fact' }, item.license ?? tt('discover.noLicense')),
        item.updatedAt && h('span', { class: 'dv-fact' }, tt('discover.updated', { when: stamp(item.updatedAt) }))),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => copy(item) }, tt('discover.copy')),
        item.hasMarketplace && h('button', { type: 'button', class: 'btn primary', onclick: () => confirmInstall(item) }, tt('discover.install'))));
  }

  function render(res) {
    lastResponse = res;
    const tt = t();
    const { items } = res;
    const notes = [];
    if (res.limited) notes.push(tt('discover.limited'));
    else if (res.error === 'network') notes.push(tt('discover.offline'));
    else if (res.error === 'github') notes.push(tt('discover.githubError'));
    if (res.fetchedAt) notes.push(tt('discover.fetched', { when: stamp(res.fetchedAt) }));
    q('#discoverStatus').textContent = notes.join(' · ');
    q('#discoverStatus').classList.toggle('is-error', Boolean(res.limited || res.error));
    const list = q('#discoverList');
    list.replaceChildren(...(items.length ? items.map(card) : [h('li', { class: 'empty' }, emptyState({ h, icon }, res.total ? { art: 'search', title: tt('discover.noMatch'), text: tt('discover.noMatchText') } : { art: 'compass', title: tt('discover.emptyTitle'), text: tt('discover.empty') }))]));
  }

  async function load({ refresh = false } = {}) {
    const params = new URLSearchParams();
    for (const [key, sel] of [['q', '#discoverSearch'], ['sort', '#discoverSort'], ['type', '#discoverType'], ['category', '#discoverCategory']]) {
      const value = q(sel).value.trim();
      if (value) params.set(key, value);
    }
    if (refresh) params.set('refresh', '1');
    q('#discoverStatus').textContent = t()('discover.loading');
    try {
      const res = await fetch(`/api/catalog?${params}`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      render(await res.json());
      loaded = true;
    } catch {
      q('#discoverStatus').textContent = t()('discover.failed');
    }
  }

  // The second step (choose a plugin) comes after the marketplace was added with `chosen` ({scope, projectId}), so it stays locked there.
  function confirmInstall(item, plugins = null, chosen = null) {
    const tt = t();
    const proj = project();
    const scope = h('select', { id: 'installScope' },
      option('user', tt('discover.scope.user')),
      proj && option('project', tt('discover.scope.project', { name: proj.name })));
    if (chosen) {
      scope.value = chosen.scope;
      scope.disabled = true;
    }
    const plugin = plugins && h('select', { id: 'installPlugin', 'aria-label': tt('discover.choose') }, plugins.map((p) => option(p, p)));
    const go = h('button', { type: 'button', class: 'btn primary' }, tt('discover.confirm.go'));
    go.addEventListener('click', async () => {
      go.disabled = true;
      const where = chosen ?? { scope: scope.value, ...(scope.value === 'project' ? { projectId: proj.id } : {}) };
      const res = await post({ action: 'install', repo: item.repo, ...where, ...(plugin ? { plugin: plugin.value } : {}) });
      go.disabled = false;
      if (res.error === 'choose-plugin') return confirmInstall(item, res.plugins, where);
      dialog.close();
      toast(res.ok ? tt('discover.done', { id: res.installed }) : errorText(res.error));
      if (res.ok) load();
    });
    dialog.replaceChildren(h('div', {},
      h('h2', {}, tt('discover.confirm.title', { name: item.repo })),
      h('p', { class: 'dv-desc' }, item.description),
      h('p', { class: 'dv-meta' },
        h('span', { class: 'dv-fact num' }, tt('discover.stars', { n: item.stars.toLocaleString(lang()) })),
        item.updatedAt && h('span', { class: 'dv-fact' }, tt('discover.updated', { when: stamp(item.updatedAt) })),
        h('span', { class: 'dv-fact' }, item.license ?? tt('discover.noLicense')),
        item.archived && h('span', { class: 'pill tone-waiting' }, tt('discover.archived'))),
      h('p', { class: 'dv-warning', role: 'note' }, tt('discover.confirm.warning')),
      h('label', { class: 'dv-field' }, h('span', {}, tt('discover.scope')), scope),
      plugin && h('label', { class: 'dv-field' }, h('span', {}, tt('discover.choose')), plugin),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, tt('discover.cancel')), go)));
    if (!dialog.open) dialog.showModal();
  }

  function errorText(code) {
    const key = `discover.err.${code}`;
    return t()(key) === key ? t()('discover.err.generic') : t()(key);
  }

  async function post(body) {
    try {
      const res = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-map': '1' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      return res.status === 401 ? { ok: false, error: 'token-required' } : { ...data, ok: res.ok };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  for (const sel of ['#discoverSort', '#discoverType', '#discoverCategory']) q(sel).addEventListener('change', () => load());
  q('#discoverSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(), DEBOUNCE_MS); });
  q('#discoverRefresh').addEventListener('click', () => load({ refresh: true }));
  relabel();

  return { relabel, show() { root.hidden = false; if (!loaded) load(); } };
}
