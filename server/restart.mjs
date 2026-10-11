// The agreed restart (sv13): a conversation that needs a fresh session-map asks for it (POST /api/restart, the arsenal's
// restart_session_map) instead of killing the process, which would cut off every page chat mid-turn. At most one restart
// waits: it goes when no page chat the hub drives is in the middle of a turn, or at the deadline, and new turns are held
// meanwhile. The chats are written down first and the new process resumes them. The clock, the check, spawn and exit
// are injected: tests never start or stop a real server.
import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.mjs';
import { maskSecrets } from './sources/claude-conversation.mjs';
import { writeAtomic } from './store.mjs';

export const RESUME_FILE = 'restart-resume.json';
const CHECK_MS = 2000;
const WAIT_MS = 10 * 60_000;
// A resume file older than this belongs to a restart that never came back: its chats moved on without it.
const RESUME_MAX_AGE_MS = 15 * 60_000;
// The new process may find the port still held a moment by the old one.
export const LISTEN_RETRY_MS = 10_000;
const LISTEN_STEP_MS = 500;
const REASON_MAX = 300;
const REASONS_MAX = 5;
const CHATS_KEPT = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[0-9a-f]{32}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// -> 'none' (nothing asked), 'wait' (a chat is mid-turn) or 'now'.
export function decideRestart({ pending, turning, now }) {
  if (!pending) return 'none';
  return turning === 0 || now >= pending.deadline ? 'now' : 'wait';
}

// A request joins the restart already waiting (its deadline stays), or starts one. keys: the page chats that asked.
export function joinRequest(pending, { reason, chatKey = null, now, waitMs = WAIT_MS }) {
  const keys = (list) => (chatKey && !list.includes(chatKey) ? [...list, chatKey] : list);
  if (pending) return { pending: { ...pending, reasons: [...pending.reasons, reason].slice(-REASONS_MAX), keys: keys(pending.keys) }, already: true };
  return { pending: { reasons: [reason], keys: keys([]), at: now, deadline: now + waitMs }, already: false };
}

// One line, no secret, short: it goes into a file, an alert and the note a resumed chat reads.
const cleanReason = (reason) => maskSecrets(String(reason ?? '')).replace(/\s+/g, ' ').trim().slice(0, REASON_MAX) || 'no reason given';

export function resumeNote(reasons, { asked }) {
  const who = asked ? 'at your request' : 'at the request of another conversation';
  return `[session-map restarted ${who} (${reasons.join('; ')}). Continue where you left off; if you were in the middle of a step, check its result first.]`;
}

// hub: turning() (chats mid-turn), hold(on) (no new turn starts), restartList() and close(); closeServer(): closes the
// HTTP server. now, every/stopEvery (the check), spawn and exit: replaceable for tests.
export function createRestarter({
  hub, smDir, closeServer, now = Date.now, every = setInterval, stopEvery = clearInterval, spawn = nodeSpawn,
  exit = (code) => process.exit(code), execPath = process.execPath, argv = process.argv.slice(1), env = process.env,
  checkMs = CHECK_MS, waitMs = WAIT_MS,
}) {
  let pending = null;
  let timer = null;
  let going = null;

  function request({ reason, chatKey } = {}) {
    if (going) return { scheduled: true, already: true };
    const joined = joinRequest(pending, { reason: cleanReason(reason), chatKey: KEY_RE.test(String(chatKey)) ? chatKey : null, now: now(), waitMs });
    pending = joined.pending;
    hub.hold(true);
    if (!timer) {
      timer = every(check, checkMs);
      timer?.unref?.();
    }
    log('info', 'restart-requested', { joined: joined.already, reason: pending.reasons.at(-1) });
    if (joined.already) return { scheduled: true, already: true };
    return { scheduled: true, waitingFor: hub.turning(), deadline: new Date(pending.deadline).toISOString() };
  }

  function check() {
    if (going || decideRestart({ pending, turning: hub.turning(), now: now() }) !== 'now') return going;
    stopEvery(timer);
    timer = null;
    going = restartNow();
    return going;
  }

  // The chats on disk first, so a failure further on still leaves them to resume; then the port and the claude
  // processes are let go, and only then the copy starts, so it never drives a chat the old hub still holds.
  async function restartNow() {
    const keys = new Set(pending.keys);
    const chats = hub.restartList().slice(0, CHATS_KEPT).map((c) => ({
      sessionId: c.sessionId, key: c.key, projectId: c.projectId, run: c.run, running: Boolean(c.running), held: Boolean(c.held), asked: keys.has(c.key),
    }));
    try {
      writeAtomic(join(smDir, RESUME_FILE), `${JSON.stringify({ version: 1, at: new Date(now()).toISOString(), reasons: pending.reasons, chats }, null, 2)}\n`);
    } catch (err) { log('warn', 'restart-resume-write-failed', { error: err.message }); }
    log('info', 'restarting', { chats: chats.length, midTurn: chats.filter((c) => c.running).length });
    for (const step of [closeServer, () => hub.close()]) {
      try { await step(); } catch (err) { log('warn', 'restart-close-failed', { error: err.message }); }
    }
    try {
      const child = spawn(execPath, argv, { detached: true, stdio: 'ignore', windowsHide: true, env: { ...env, SM_RESTARTED: '1' } });
      // EPERM or ENOENT come as an 'error' after spawn() returns: the copy is known to run only on 'spawn'.
      await new Promise((started, failed) => { child.once('spawn', started); child.once('error', failed); });
      child.unref();
    } catch (err) {
      log('error', 'restart-spawn-failed', { error: err.message });
      return exit(1);
    }
    return exit(0);
  }

  return { request, check, pending: () => pending };
}

// -> the saved restart, or null. Read once: the file is removed whatever it holds.
function takeResume(smDir, at) {
  const file = join(smDir, RESUME_FILE);
  let saved;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    saved = null;
  }
  try { rmSync(file, { force: true }); } catch (err) {
    log('warn', 'restart-resume-remove-failed', { error: err.message });
    return null;
  }
  const when = Date.parse(saved?.at);
  if (!isObject(saved) || !Number.isFinite(when) || at - when > RESUME_MAX_AGE_MS || when - at > 60_000) return null;
  const reasons = (Array.isArray(saved.reasons) ? saved.reasons : []).filter((r) => typeof r === 'string').map(cleanReason).slice(0, REASONS_MAX);
  const chats = (Array.isArray(saved.chats) ? saved.chats : [])
    .filter((c) => isObject(c) && UUID_RE.test(String(c.sessionId)) && typeof c.projectId === 'string')
    .slice(0, CHATS_KEPT);
  return { reasons: reasons.length ? reasons : [cleanReason('')], chats };
}

// A chat cut mid-turn, one whose automatic answer was held, and one that asked go on with the note; an idle one is driven
// again without a message, after them, so the chats with work under way get the hub's places first.
const wantsNote = (c) => c.running === true || c.held === true || c.asked === true;
const bodyOf = (c, reasons) => ({
  projectId: c.projectId, sessionId: c.sessionId, ...(c.running === true ? { cut: true } : {}), ...(isObject(c.run) ? { run: c.run } : {}),
  ...(wantsNote(c) ? { text: resumeNote(reasons, { asked: c.asked === true }) } : { idle: true }),
});

// The new process, once its hub exists: resumes what the old one listed, one chat at a time within the hub's limit,
// then tells the owner. resuming gets the chats to resume at once (the watcher's first look must not call them cut
// off); after: the new server listens. -> {resumed, left} or null when there was no restart to resume.
export function resumeAfterRestart({ smDir, hub, readState, onAlert = () => {}, now = Date.now, resuming = new Set(), after = Promise.resolve() }) {
  const saved = takeResume(smDir, now());
  if (!saved) return Promise.resolve(null);
  const todo = [...saved.chats.filter(wantsNote), ...saved.chats.filter((c) => !wantsNote(c))];
  for (const c of todo) resuming.add(c.sessionId);
  return (async () => {
    await after;
    const state = await readState();
    let resumed = 0;
    let i = 0;
    for (; i < todo.length; i++) {
      const c = todo[i];
      let res;
      // The note is session-map's: an orchestrator's count of turns in a row and a stop by the person stay as they are.
      try { res = await hub.start(bodyOf(c, saved.reasons), state, { restart: true }); } catch (err) { res = { status: 500, body: { error: err.message } }; }
      if (res.status === 429) break;
      if (res.status === 200) resumed += 1;
      else log('warn', 'restart-resume-failed', { sessionId: c.sessionId, error: res.body?.error ?? res.status });
    }
    const left = todo.length - i;
    if (left) log('warn', 'restart-resume-limit', { left });
    onAlert(restartAlert(saved, state, resumed));
    return { resumed, left };
  })();
}

// Who asked: the page chat that did, by its project and title; otherwise a conversation outside the page.
function restartAlert(saved, state, resumed) {
  const by = saved.chats.find((c) => c.asked === true);
  const project = by ? (state?.projects ?? []).find((p) => p.id === by.projectId) : null;
  const row = project ? [...(project.conversations ?? []), ...(project.chats ?? [])].find((c) => c.sessionId === by.sessionId) : null;
  const who = project
    ? { projectId: project.id, projectName: project.name, sessionId: by.sessionId, title: row?.title ?? '', origin: 'map' }
    : { projectId: 'session-map', projectName: 'session-map', sessionId: null, title: '' };
  return { kind: 'finished', reason: 'restarted', ...who, resumed, because: saved.reasons.join('; ') };
}

// Listens, and while retryMs lasts tries again on a port still in use. fail(err): past the window, as an unhandled
// listen error always did (it throws).
export function listenWithRetry(server, { port, host, retryMs = 0, stepMs = LISTEN_STEP_MS, now = Date.now, later = setTimeout, fail = (err) => { throw err; } }) {
  const until = now() + retryMs;
  const onError = (err) => {
    if (err?.code === 'EADDRINUSE' && now() < until) return later(() => server.listen(port, host), stepMs);
    server.off('error', onError);
    return fail(err);
  };
  server.on('error', onError);
  server.once('listening', () => server.off('error', onError));
  server.listen(port, host);
}
