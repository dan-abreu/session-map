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
