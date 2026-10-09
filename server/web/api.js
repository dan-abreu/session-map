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
  nucleus: (projectId, unitId) => call('GET', `/api/nucleus/${seg(projectId)}/${seg(unitId)}`),
  saveNucleus: (projectId, unitId, nucleus) => call('PUT', `/api/nucleus/${seg(projectId)}/${seg(unitId)}`, nucleus),
  editUnits: (projectId, op) => call('PUT', `/api/units/${seg(projectId)}`, op),
  override: (projectId, sessionId, unitId) => call('POST', '/api/override', { projectId, sessionId, unitId }),
  action: (body) => call('POST', '/api/action', body),
  chatStart: (body) => call('POST', '/api/chat/start', body),
  chatSend: (key, text) => call('POST', `/api/chat/${seg(key)}/send`, { text }),
  chatPermission: (key, requestId, allow, always) => call('POST', `/api/chat/${seg(key)}/permission`, { requestId, allow, always }),
  chatStop: (key) => call('POST', `/api/chat/${seg(key)}/stop`, {}),
  chatEvents: (key) => new EventSource(`/api/chat/${seg(key)}/events`),
};
