// What a poll changed, cheaply (mm44): the open project's signature drives the map and the panel, the rest's drives the lists
// that span every project. The minute is in both, so relative times and working marks still age when nothing else moves.
export const minuteOf = (iso) => Math.floor((Date.parse(iso) || 0) / 60_000);

// A cost's rolling 7- and 30-day sums ({today, d7, d30}) drop by themselves as old messages leave the window: alone they
// are not news, so neither the server's tag nor these signatures count them; they come along with the next real change.
const sliding = (holder, key) => (key === 'd7' || key === 'd30') && holder !== null && typeof holder === 'object' && 'today' in holder && 'd30' in holder;

// What the server tags a state by (sv09): its content without the time it was collected and without the sliding costs.
export const versionText = (s) => JSON.stringify(s, function versionPart(key, value) {
  return (this === s && key === 'generatedAt') || sliding(this, key) ? undefined : value;
});

// The open project's times move on every collect (a running agent's activeAt, its step's ts): to the minute is enough,
// since the minute term redraws anyway.
const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
function drawnPart(key, value) {
  if (sliding(this, key)) return undefined;
  return typeof value === 'string' && value.length <= 30 && value[10] === 'T' && ISO_RE.test(value) ? value.slice(0, 16) : value;
}
const drawnText = (value) => JSON.stringify(value, drawnPart);

export function stateSigs(state, projectId) {
  const { projects = [], generatedAt, ...top } = state;
  const minute = minuteOf(generatedAt);
  let open = '';
  const others = [];
  for (const p of projects) {
    if (p.id === projectId) open = drawnText(p);
    else others.push(p);
  }
  return {
    project: `${minute}|${top.refreshing ? 1 : 0}|${projectId}|${open}`,
    global: `${minute}|${drawnText(top)}|${drawnText(others)}`,
  };
}
