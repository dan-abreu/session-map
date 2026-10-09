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

export const api = {
  state: () => call('GET', '/api/state'),
  history: (q, project) => call('GET', `/api/history?${new URLSearchParams({ q, ...(project ? { project } : {}) })}`),
  conversation: (id) => call('GET', `/api/conversation/${seg(id)}`),
  deleteConversation: (id) => call('DELETE', `/api/conversation/${seg(id)}`),
  placeConversation: (id, body) => call('POST', `/api/conversation/${seg(id)}/place`, body),
  files: (projectId, scope) => call('GET', `/api/files/${seg(projectId)}?${new URLSearchParams(scope)}`),
  file: (projectId, path, workCell) => call('GET', `/api/file/${seg(projectId)}?${new URLSearchParams({ path, ...(workCell ? { workCell } : {}) })}`),
  action: (body) => call('POST', '/api/action', body),
  chatStart: (body) => call('POST', '/api/chat/start', body),
  chatSend: (key, text) => call('POST', `/api/chat/${seg(key)}/send`, { text }),
  chatPermission: (key, requestId, allow, always) => call('POST', `/api/chat/${seg(key)}/permission`, { requestId, allow, always }),
  chatStop: (key) => call('POST', `/api/chat/${seg(key)}/stop`, {}),
  chatMode: (key, mode) => call('POST', `/api/chat/${seg(key)}/mode`, { mode }),
  chatRun: (key, run) => call('POST', `/api/chat/${seg(key)}/run`, { run }),
  reinforcedLimit: () => call('GET', '/api/settings/reinforced-limit'),
  setReinforcedLimit: (usd) => call('POST', '/api/settings/reinforced-limit', { usd }),
  chatList: (query) => call('GET', `/api/chat/list?${new URLSearchParams(query)}`),
  chatHistory: (sessionId) => call('GET', `/api/chat/history/${seg(sessionId)}`),
  settingsMode: () => call('GET', '/api/settings/permission-mode'),
  setSettingsMode: (mode) => call('POST', '/api/settings/permission-mode', { mode }),
  undoSettingsMode: () => call('DELETE', '/api/settings/permission-mode'),
  flowExport: (projectId) => call('GET', `/api/arch/${seg(projectId)}/mermaid`),
  flowPreview: (projectId, text) => call('POST', `/api/arch/${seg(projectId)}/mermaid/preview`, { text }),
  flowApply: (projectId, text, skip) => call('POST', `/api/arch/${seg(projectId)}/mermaid/apply`, { text, skip }),
  flowDraft: (projectId) => call('GET', `/api/arch/${seg(projectId)}/draft`),
  flowSaveDraft: (projectId, text) => call('PUT', `/api/arch/${seg(projectId)}/draft`, { text }),
  flowDiscard: (projectId) => call('DELETE', `/api/arch/${seg(projectId)}/draft`),
  alerts: (since) => call('GET', `/api/alerts?since=${Number(since) || 0}`),
  notifyPrefs: () => call('GET', '/api/settings/notify'),
  setNotify: (patch) => call('POST', '/api/settings/notify', patch),
  notifyTest: () => call('POST', '/api/settings/notify/test', {}),
  chatEvents: (key) => new EventSource(`/api/chat/${seg(key)}/events`),
};
