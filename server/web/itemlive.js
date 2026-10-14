// The status robot's badge on an item (sb13): "working now · 2" with who on hover, or "built on main, not ticked yet".
export function liveBadge(live, t) {
  if (!live || (live.live !== 'working' && live.live !== 'built')) return null;
  const who = Array.isArray(live.who) ? live.who : [];
  const text = live.live === 'working' ? t('item.live.working', { n: Math.max(1, who.length) }) : t('item.live.built');
  return { kind: live.live, text, title: who.join('\n') };
}
