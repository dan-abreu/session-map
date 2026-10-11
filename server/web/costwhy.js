// Why a project can show money with no chat on the map (sb06): the lines to say, as {key, n} for the page to translate.
// Nothing when the cost is zero, a chat is on the map, or the server counted no one off it.
export function costWhyNote(p) {
  if (!(p?.cost?.d30 > 0) || p.chats?.length || !p.costWhy) return null;
  const lines = [];
  if (p.costWhy.older > 0) lines.push({ key: 'project.costWhy.older', n: p.costWhy.older });
  if (p.costWhy.removed > 0) lines.push({ key: 'project.costWhy.removed', n: p.costWhy.removed });
  return lines.length ? lines : null;
}
