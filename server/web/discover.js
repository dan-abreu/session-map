const TYPES = ['skill', 'plugin', 'marketplace', 'mcp', 'agent', 'hook'];
const CATEGORIES = ['design', 'security', 'testing', 'writing', 'data', 'devops', 'product', 'ai', 'other'];
const SORTS = ['stars', 'updated', 'name'];
const DEBOUNCE_MS = 250;

// The Discover tab: a catalog of skills and plugins from GitHub, with a confirmation step before anything is installed.
// ctx: h (element helper), t (translator getter), lang, project ({id, name} or null), toast.
export function createDiscover({ root, h, t, lang, project, toast }) {
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
    if (lastResponse) render(lastResponse);
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
    list.replaceChildren(...(items.length ? items.map(card) : [h('li', { class: 'empty' }, res.total ? tt('discover.noMatch') : tt('discover.empty'))]));
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

  function confirmInstall(item, plugins = null) {
    const tt = t();
    const proj = project();
    const scope = h('select', { id: 'installScope' },
      option('user', tt('discover.scope.user')),
      proj && option('project', tt('discover.scope.project', { name: proj.name })));
    const plugin = plugins && h('select', { id: 'installPlugin', 'aria-label': tt('discover.choose') }, plugins.map((p) => option(p, p)));
    const go = h('button', { type: 'button', class: 'btn primary' }, tt('discover.confirm.go'));
    go.addEventListener('click', async () => {
      go.disabled = true;
      const body = { action: 'install', repo: item.repo, scope: scope.value, ...(scope.value === 'project' ? { projectId: proj.id } : {}), ...(plugin ? { plugin: plugin.value } : {}) };
      const res = await post(body);
      go.disabled = false;
      if (res.error === 'choose-plugin') return confirmInstall(item, res.plugins);
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
