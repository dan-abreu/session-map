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
  state: () => call('GET', '/api/state'),
  history: (q, project, range) => call('GET', `/api/history?${new URLSearchParams({ q, ...(project ? { project } : {}), ...(range ? { from: String(range.from), to: String(range.to) } : {}) })}`),
  conversation: (id) => call('GET', `/api/conversation/${seg(id)}`),
  deleteConversation: (id) => call('DELETE', `/api/conversation/${seg(id)}`),
  placeConversation: (id, body) => call('POST', `/api/conversation/${seg(id)}/place`, body),
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
  chatRun: (key, run) => call('POST', `/api/chat/${seg(key)}/run`, { run }),
  reinforcedLimit: () => call('GET', '/api/settings/reinforced-limit'),
  setReinforcedLimit: (usd) => call('POST', '/api/settings/reinforced-limit', { usd }),
  setProjectBackground: (projectId, always) => call('POST', '/api/settings/project-background', { projectId, always }),
  // The project's orchestrator (or01): open it, resuming its one conversation (text starts it with a first message), and the
  // switch "Organizar sozinho" (or18).
  orchestratorOpen: (body) => call('POST', '/api/chat/orchestrator', body),
  setProjectTidy: (projectId, tidy) => call('POST', '/api/settings/project-tidy', { projectId, tidy }),
  chatList: (query) => call('GET', `/api/chat/list?${new URLSearchParams(query)}`),
  chatHistory: (sessionId, since) => call('GET', `/api/chat/history/${seg(sessionId)}${since ? `?since=${seg(since)}` : ''}`),
  chatHelper: (sessionId, agentId) => call('GET', `/api/chat/helper/${seg(sessionId)}/${seg(agentId)}`),
  settingsMode: () => call('GET', '/api/settings/permission-mode'),
  setSettingsMode: (mode) => call('POST', '/api/settings/permission-mode', { mode }),
  undoSettingsMode: () => call('DELETE', '/api/settings/permission-mode'),
  flowExport: (projectId) => call('GET', `/api/arch/${seg(projectId)}/mermaid`),
  flowModel: (projectId) => call('GET', `/api/arch/${seg(projectId)}/model`),
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
  removeAiKey: (provider) => call('DELETE', `/api/settings/ai-helpers?provider=${seg(provider)}`),
  testAiKey: (provider) => call('POST', '/api/settings/ai-helpers/test', { provider }),
  // The foundation, for every block's screens (index § 3): one read, and one write (POST unless told PUT).
  fd: (projectId, what, params) => fdCall('GET', fdPath(projectId, what, params)),
  fdWrite: (projectId, what, body, method = 'POST') => fdCall(method, fdPath(projectId, what), body),
  chatEvents: (key) => new EventSource(`/api/chat/${seg(key)}/events`),
};
