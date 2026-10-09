// Pure helpers for the body model (desenho-2 § 27–28): no DOM, no d3, so node:test can load them.

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function unitTree(units) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const parentOf = (u) => (u.parentId && byId.has(u.parentId) && u.parentId !== u.id ? byId.get(u.parentId) : null);
  const kids = new Map(units.map((u) => [u.id, []]));
  const roots = [];
  for (const u of units) {
    const p = parentOf(u);
    if (p) kids.get(p.id).push(u);
    else roots.push(u);
  }
  const ancestors = (id) => {
    const out = [];
    let u = byId.get(id);
    while (u && (u = parentOf(u)) && !out.includes(u)) out.push(u);
    return out;
  };
  const descendants = (id) => (kids.get(id) || []).flatMap((k) => [k, ...descendants(k.id)]);
  return {
    byId,
    roots,
    children: (id) => kids.get(id) || [],
    parent: (id) => (byId.has(id) ? parentOf(byId.get(id)) : null),
    ancestors,
    descendants,
    rootOf: (id) => ancestors(id).at(-1) || byId.get(id) || null,
  };
}

// Greedy packing: each circle, biggest first, takes the free tangent spot closest to the centre.
// ponytail: O(n³) over a container's children; fine for the dozen units a container holds.
export function packCircles(items, pad) {
  if (!items.length) return { items: [], r: 0 };
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  const placed = [];
  const fits = (x, y, r) => placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + pad - 1e-9);
  for (const c of order) {
    if (!placed.length) {
      placed.push({ ...c, x: 0, y: 0 });
      continue;
    }
    let best = null;
    for (const p of placed) {
      const d = p.r + c.r + pad;
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2 + hash(c.id || String(c.i)) * 0.4;
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        const score = Math.hypot(x, y) + c.r;
        if ((!best || score < best.score - 1e-9) && fits(x, y, c.r)) best = { x, y, score };
      }
    }
    placed.push({ ...c, x: best.x, y: best.y });
  }
  const x0 = Math.min(...placed.map((p) => p.x - p.r)), x1 = Math.max(...placed.map((p) => p.x + p.r));
  const y0 = Math.min(...placed.map((p) => p.y - p.r)), y1 = Math.max(...placed.map((p) => p.y + p.r));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const out = placed.sort((a, b) => a.i - b.i).map(({ i, ...p }) => ({ ...p, x: p.x - cx, y: p.y - cy }));
  return { items: out, r: Math.max(...out.map((p) => Math.hypot(p.x, p.y) + p.r)) };
}

export const ownerHue = (email) => Math.floor(hash(String(email).trim().toLowerCase()) * 360);

export function initial(name) {
  const first = [...String(name).trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}

export function workCellPhase(wc, t) {
  if (t < Date.parse(wc.bornAt)) return 'unborn';
  if (wc.mergedAt && t >= Date.parse(wc.mergedAt)) return 'fused';
  return 'alive';
}

// A cell the AI fused into another lived from its conversation's start until the fusion event.
export function fusionGhosts(project) {
  const chats = new Map(project.chats.map((c) => [c.sessionId, c]));
  return project.activity
    .filter((a) => a.kind === 'fused-by-meaning' && a.sessionId && chats.has(a.sessionId) && a.unitIds.length)
    .map((a) => ({
      id: `ghost:${a.sessionId}`, unitId: a.unitIds[0], sessionId: a.sessionId,
      from: Date.parse(chats.get(a.sessionId).startedAt), until: Date.parse(a.ts),
    }));
}

export function filesByFolder(files) {
  const groups = new Map();
  for (const f of files) {
    const cut = f.path.lastIndexOf('/');
    const folder = cut < 0 ? '' : f.path.slice(0, cut);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push({ ...f, name: f.path.slice(cut + 1) });
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, list]) => ({ folder, files: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

const DORMANT_DAYS = 14;

// Units with nothing alive in them: no conversation, no branch, no commit in two weeks, and (for a group) no awake
// member. The brain draws them as small dim dots, so what is alive stands out; pinned ones stay as the person set them.
export function dormantUnits(project, now = Date.now(), days = DORMANT_DAYS) {
  const since = now - days * 864e5;
  const committed = new Set(project.activity
    .filter((a) => (a.kind === 'commit' || a.kind === 'merge') && Date.parse(a.ts) >= since)
    .flatMap((a) => a.unitIds ?? []));
  const kids = new Map();
  for (const u of project.units) if (u.parentId) kids.set(u.parentId, [...(kids.get(u.parentId) ?? []), u]);
  const memo = new Map();
  const asleep = (u, seen = new Set()) => {
    if (memo.has(u.id)) return memo.get(u.id);
    if (seen.has(u.id)) return true;
    seen.add(u.id);
    const own = !u.pinned && !u.chatIds.length && !u.workCellIds.length && !committed.has(u.id);
    const result = own && (kids.get(u.id) ?? []).every((k) => asleep(k, seen));
    memo.set(u.id, result);
    return result;
  };
  return new Set(project.units.filter((u) => asleep(u)).map((u) => u.id));
}

export const BOTS_ID = 'bots';
const isBot = (w) => /\[bot\]|(^|[-_])bot$/i.test(w.owner?.name ?? '') || /\[bot\]/i.test(w.owner?.email ?? '') || /^(dependabot|renovate)\//.test(w.branch);

// Dependency bots open a branch per update; on the map they are one cell, "N automatic updates".
export function collapseBots(workCells) {
  const bots = workCells.filter(isBot);
  if (!bots.length) return workCells;
  const ids = new Set(bots.map((w) => w.id));
  const alive = bots.filter((w) => w.status !== 'merged');
  const group = {
    id: BOTS_ID, branch: BOTS_ID, remote: true, path: null, bots,
    owner: { name: 'bots', email: 'bots' }, authors: [], unitId: 'unsorted', touches: [],
    files: bots.flatMap((w) => w.files), commits: bots.reduce((n, w) => n + w.commits, 0), ahead: bots.reduce((n, w) => n + w.ahead, 0),
    status: alive.some((w) => w.status === 'active') ? 'active' : alive.length ? 'idle' : 'merged',
    bornAt: bots.map((w) => w.bornAt).sort()[0], mergedAt: alive.length ? null : bots.map((w) => w.mergedAt).sort().at(-1),
    clashWith: [], chatIds: [], lastCommit: null, nucleus: { doing: null, todo: [] }, openspec: null, estimateUSD: null, costUSD: 0,
  };
  const people = workCells.filter((w) => !ids.has(w.id)).map((w) => (
    w.clashWith.some((id) => ids.has(id)) ? { ...w, clashWith: [...new Set(w.clashWith.map((id) => (ids.has(id) ? BOTS_ID : id)))] } : w
  ));
  group.clashWith = people.filter((w) => w.clashWith.includes(BOTS_ID)).map((w) => w.id);
  return [...people, group];
}

export const ellipsize = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

// A unit's name in at most two lines of about max characters; a longer one ends the second line with "…".
export function wrapLabel(text, max = 18) {
  if (text.length <= max) return [text];
  const lines = [''];
  for (const w of text.split(/\s+/)) {
    const cur = lines[lines.length - 1];
    if (!cur || (cur + ' ' + w).length <= max) lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
    else lines.push(w);
  }
  if (lines.length > 2) {
    lines.length = 2;
    lines[1] = `${lines[1]}…`;
  }
  return lines;
}

// Map-style labelling: candidates come in priority order; each is slid inside the view, then kept only if it
// overlaps none already kept nor any shape in its own avoid list. Returns id → {dx} or null when the label waits
// for a closer zoom.
export function placeBoxes(candidates, { width, pad = 4 }) {
  const kept = [];
  const out = new Map();
  for (const c of candidates) {
    const w = c.x1 - c.x0;
    if (w > width - 2 * pad) { out.set(c.id, null); continue; }
    const dx = c.x0 < pad ? pad - c.x0 : c.x1 > width - pad ? width - pad - c.x1 : 0;
    const b = { x0: c.x0 + dx, x1: c.x1 + dx, y0: c.y0, y1: c.y1 };
    const hits = (k) => k.x0 < b.x1 && b.x0 < k.x1 && k.y0 < b.y1 && b.y0 < k.y1;
    if (kept.some(hits) || (c.avoid ?? []).some(hits)) { out.set(c.id, null); continue; }
    kept.push(b);
    out.set(c.id, { dx });
  }
  return out;
}

// Greedy by weight: a link is drawn by default while both its units have fewer than `max`; the rest wait for a selection.
export function strongestLinks(links, max = 3) {
  const count = new Map();
  const kept = new Set();
  const byWeight = links.map((l, i) => [l, i]).sort((p, q) => q[0].weight - p[0].weight || p[1] - q[1]);
  for (const [l] of byWeight) {
    if ((count.get(l.a) ?? 0) >= max || (count.get(l.b) ?? 0) >= max) continue;
    kept.add(l);
    count.set(l.a, (count.get(l.a) ?? 0) + 1);
    count.set(l.b, (count.get(l.b) ?? 0) + 1);
  }
  return kept;
}
