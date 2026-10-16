// Every call the page makes to the session-map server. Writes carry the header the server demands with the Origin.
const WRITE_HEADERS = { 'content-type': 'application/json', 'x-session-map': '1' };

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? { accept: 'application/json', ...(method === 'GET' ? {} : WRITE_HEADERS) } : WRITE_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) return { ok: false, status: 401, error: 'token-required' };
  return { ...data, ok: res.ok, status: res.status, error: res.ok ? undefined : data.error ?? `http-${res.status}` };
}

// The state poll sends back the tag of the state it has: when nothing changed the server answers 304 and no body (sv09).
let stateTag = null;
async function stateCall() {
  let res;
  try {
    res = await fetch('/api/state', { method: 'GET', headers: { accept: 'application/json', ...(stateTag ? { 'if-none-match': stateTag } : {}) } });
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
  // Opened with the look-only link (sv04): the server marks every answer, and the page hides the chat and the buttons.
  const look = res.headers.get('x-look-only') === '1' ? { look: true } : {};
  if (res.status === 304) return { ok: true, status: 304, same: true, generatedAt: res.headers.get('x-generated-at') ?? undefined, ...look };
  const data = await res.json().catch(() => null);
  if (res.status === 401) return { ok: false, status: 401, error: 'token-required' };
  if (!res.ok) return { ...data, ok: false, status: res.status, error: data?.error ?? `http-${res.status}` };
  // A cut body (a dropped connection) is a failed ask: keeping its tag would turn every later poll into a 304 on nothing.
  if (!data || !Array.isArray(data.projects)) {
    stateTag = null;
    return { ok: false, status: res.status, error: 'bad-state' };
  }
  // An answer with no tag (the disk copy while the server starts) is never kept as current.
  stateTag = res.headers.get('etag');
  return { ...data, ok: true, status: res.status, error: undefined, ...look };
}

const seg = encodeURIComponent;

// The foundation answers bare JSON (null before a file exists, arrays for logs), so it comes back as data, never spread.
async function fdCall(method, path, body) {
  let res;
  try {
    res = await fetch(path, method === 'GET'
      ? { method, headers: { accept: 'application/json' } }
      : { method, headers: WRITE_HEADERS, body: JSON.stringify(body ?? {}) });
  } catch {
    return { ok: false, status: 0, data: null, error: 'network' };
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) return { ok: false, status: 401, data: null, error: 'token-required' };
  if (!res.ok) return { ok: false, status: res.status, data: null, error: data?.error ?? `http-${res.status}` };
  return { ok: true, status: res.status, data };
}

// what: 'census', 'census/log', 'op/<id>/undo'... A null project reaches a route outside any project: fd(null, 'library').
function fdPath(projectId, what, params) {
  const query = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
  const where = String(what).split('/').map(seg).join('/');
  return `/api/${projectId == null ? '' : `foundation/${seg(projectId)}/`}${where}${query ? `?${query}` : ''}`;
}

export const api = {
  state: () => stateCall(),
  history: (q, project, range) => call('GET', `/api/history?${new URLSearchParams({ q, ...(project ? { project } : {}), ...(range ? { from: String(range.from), to: String(range.to) } : {}) })}`),
  conversation: (id) => call('GET', `/api/conversation/${seg(id)}`),
  deleteConversation: (id) => call('DELETE', `/api/conversation/${seg(id)}`),
  placeConversation: (id, body) => call('POST', `/api/conversation/${seg(id)}/place`, body),
  newProjectPlace: () => call('GET', '/api/projects/new'),
  createProject: (body) => call('POST', '/api/projects/new', body),
  // The cards the owner makes by hand in the Board (mm14), kept in session-map's own folder.
  cards: () => call('GET', '/api/cards'),
  addCard: (body) => call('POST', '/api/cards', body),
  moveCard: (id, body) => call('POST', `/api/cards/${seg(id)}/move`, body),
  deleteCard: (id) => call('DELETE', `/api/cards/${seg(id)}`),
  files: (projectId, scope) => call('GET', `/api/files/${seg(projectId)}?${new URLSearchParams(scope)}`),
  file: (projectId, path, workCell, links) => call('GET', `/api/file/${seg(projectId)}?${new URLSearchParams({ path, ...(workCell ? { workCell } : {}), ...(links ? { links: '1' } : {}) })}`),
  changes: (projectId) => call('GET', `/api/changes/${projectId === '*' ? '*' : seg(projectId)}`),
  change: (projectId, id) => call('GET', `/api/change/${seg(projectId)}?${new URLSearchParams({ id })}`),
  action: (body) => call('POST', '/api/action', body),
  chatStart: (body) => call('POST', '/api/chat/start', body),
  chatSend: (key, text, images) => call('POST', `/api/chat/${seg(key)}/send`, images?.length ? { text, images } : { text }),
  chatPermission: (key, requestId, allow, always) => call('POST', `/api/chat/${seg(key)}/permission`, { requestId, allow, always }),
  chatStop: (key) => call('POST', `/api/chat/${seg(key)}/stop`, {}),
  chatMode: (key, mode) => call('POST', `/api/chat/${seg(key)}/mode`, { mode }),
  reinforcedLimit: () => call('GET', '/api/settings/reinforced-limit'),
  setReinforcedLimit: (usd) => call('POST', '/api/settings/reinforced-limit', { usd }),
  setProjectBackground: (projectId, always) => call('POST', '/api/settings/project-background', { projectId, always }),
  // The project's orchestrator (or01): open it, resuming its one conversation (text starts it with a first message), and the
  // switch "Organizar sozinho" (or18).
  orchestratorOpen: (body) => call('POST', '/api/chat/orchestrator', body),
  // The person's priority for one item of the orchestrator's line (or08): urgent, important, normal, polish, or 'drop'.
  orchestratorPriority: (projectId, code, priority) => call('POST', '/api/chat/orchestrator', { projectId, code, priority }),
  setProjectTidy: (projectId, tidy) => call('POST', '/api/settings/project-tidy', { projectId, tidy }),
  // The project's monthly budget (or07): usd null removes it; continue lifts the pause until the month ends.
  setProjectBudget: (projectId, usd) => call('POST', '/api/settings/project-budget', { projectId, usd }),
  continueProjectBudget: (projectId) => call('POST', '/api/settings/project-budget', { projectId, continue: true }),
  chatList: (query) => call('GET', `/api/chat/list?${new URLSearchParams(query)}`),
  // cursor (pc15): {before} for the page older than the shown one, {from} for what follows the items the page holds.
  chatHistory: (sessionId, since, cursor = {}) => {
    const query = new URLSearchParams([...(since ? [['since', since]] : []), ...Object.entries(cursor).filter(([, n]) => Number.isInteger(n)).map(([k, n]) => [k, String(n)])]).toString();
    return call('GET', `/api/chat/history/${seg(sessionId)}${query ? `?${query}` : ''}`);
  },
  chatBook: (sessionId) => call('GET', `/api/chat/book/${seg(sessionId)}`),
  chatBookChapter: (sessionId, n) => call('GET', `/api/chat/book/${seg(sessionId)}/${seg(n)}`),
  chatHelper: (sessionId, agentId) => call('GET', `/api/chat/helper/${seg(sessionId)}/${seg(agentId)}`),
  settingsMode: () => call('GET', '/api/settings/permission-mode'),
  setSettingsMode: (mode) => call('POST', '/api/settings/permission-mode', { mode }),
  undoSettingsMode: () => call('DELETE', '/api/settings/permission-mode'),
  setPlugin: (id, enabled) => call('POST', '/api/settings/plugin', { id, enabled }),
  // The skills' airplane mode (id136): one switch; it reaches the chats opened after it.
  setSkillsAirplane: (on) => call('PATCH', '/api/settings/skills-airplane', { on }),
  // One skill's switch (id139): the name or command the owner turned on or off.
  setSkill: (skill, on) => call('PATCH', '/api/settings/skill', { skill, on }),
  flowExport: (projectId) => call('GET', `/api/arch/${seg(projectId)}/mermaid`),
  flowModel: (projectId) => call('GET', `/api/arch/${seg(projectId)}/model`),
  flowPart: (projectId, partId, onlyLive = false) => call('GET', `/api/arch/${seg(projectId)}/model/part/${seg(partId)}${onlyLive ? '?only=live' : ''}`),
  flowPreview: (projectId, text) => call('POST', `/api/arch/${seg(projectId)}/mermaid/preview`, { text }),
  flowApply: (projectId, text, skip) => call('POST', `/api/arch/${seg(projectId)}/mermaid/apply`, { text, skip }),
  flowDraft: (projectId) => call('GET', `/api/arch/${seg(projectId)}/draft`),
  flowSaveDraft: (projectId, text) => call('PUT', `/api/arch/${seg(projectId)}/draft`, { text }),
  flowDiscard: (projectId) => call('DELETE', `/api/arch/${seg(projectId)}/draft`),
  alerts: (since) => call('GET', `/api/alerts?since=${Number(since) || 0}`),
  notifyPrefs: () => call('GET', '/api/settings/notify'),
  setNotify: (patch) => call('POST', '/api/settings/notify', patch),
  notifyTest: () => call('POST', '/api/settings/notify/test', {}),
  // The other AIs (sb07). The key goes out once, in setAiKey, and never comes back.
  aiHelpers: () => call('GET', '/api/settings/ai-helpers'),
  // What the other AIs did, newest first (server/ai/activity.mjs).
  aiActivity: (limit = 50) => call('GET', `/api/ai/activity?limit=${Number(limit) || 50}`),
  // The other AIs measured by real use: spend, share accepted by Claude, bench score (server/ai/usage.mjs).
  aiUsage: () => call('GET', '/api/ai/usage'),
  setAiKey: (provider, key) => call('POST', '/api/settings/ai-helpers', { provider, key }),
  setAiHelper: (body) => call('POST', '/api/settings/ai-helpers', body),
  // The program's own diary (sv19) and a project's record (wa11): newest lines first, behind the key.
  logs: (query) => call('GET', `/api/logs?${new URLSearchParams(Object.entries(query ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))}`),
  projectLog: (projectId, query) => call('GET', `/api/logs/projects/${seg(projectId)}?${new URLSearchParams(Object.entries(query ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))}`),
  brain: () => call('GET', '/api/ai/brain'),
  setBrain: (body) => call('PATCH', '/api/ai/brain', body),
  brainConfig: (body) => call('POST', '/api/ai/brain/configure', body),
  removeAiKey: (provider) => call('DELETE', `/api/settings/ai-helpers?provider=${seg(provider)}`),
  // The look-only link (sv04): the owner reads it, makes a new one or turns it off.
  lookKey: () => call('GET', '/api/settings/look-key'),
  makeLookKey: () => call('POST', '/api/settings/look-key', {}),
  dropLookKey: () => call('DELETE', '/api/settings/look-key'),
  testAiKey: (provider) => call('POST', '/api/settings/ai-helpers/test', { provider }),
  // The foundation, for every block's screens (index § 3): one read, and one write (POST unless told PUT).
  fd: (projectId, what, params) => fdCall('GET', fdPath(projectId, what, params)),
  fdWrite: (projectId, what, body, method = 'POST') => fdCall(method, fdPath(projectId, what), body),
  chatEvents: (key) => new EventSource(`/api/chat/${seg(key)}/events`),
};
