// The agreed restart (sv13): a conversation that needs a fresh session-map asks for it (POST /api/restart, the arsenal's
// restart_session_map) instead of killing the process, which would cut off every page chat mid-turn. At most one restart
// waits: it goes when no page chat the hub drives is in the middle of a turn, or at the deadline, and new turns are held
// meanwhile. The chats are written down first and the new process resumes them. The clock, the check, spawn and exit
// are injected: tests never start or stop a real server.
// sv16: a chat between turns may still run a team in the background (a Workflow, a background Agent) inside its claude
// process, and closing the process kills it. So the restart first waits, up to an hour, while any chat's team is at work,
// without holding the chats (an hour of refused messages would stop the person too); only then are the turns held and
// the usual wait for a chat mid-turn starts. A team cut anyway is named to its chat when it is resumed (chat/teams.mjs).
import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { hasCutTeams } from './chat/teams.mjs';
import { log } from './log.mjs';
import { maskSecrets } from './sources/claude-conversation.mjs';
import { writeAtomic } from './store.mjs';

export const RESUME_FILE = 'restart-resume.json';
const CHECK_MS = 2000;
const WAIT_MS = 10 * 60_000;
// The teams in the background (sv16): waited for this long at most; one whose files did not change for TEAMS_QUIET_MS
// and that has no launch left open counts as done; the look walks folders, so it is taken at most every TEAMS_LOOK_MS.
const TEAMS_WAIT_MS = 60 * 60_000;
const TEAMS_QUIET_MS = 5 * 60_000;
const TEAMS_LOOK_MS = 15_000;
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

// -> 'none' (nothing asked), 'wait' (a team works in the background, or a chat is mid-turn) or 'now'. teams: how many
// chats have a team at work; until pending.teamsUntil they are waited for whatever the turns' deadline says.
export function decideRestart({ pending, turning, teams = 0, now }) {
  if (!pending) return 'none';
  if (teams > 0 && now < (pending.teamsUntil ?? 0)) return 'wait';
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

// hub: turning() (chats mid-turn), teams({now, quietMs}) (the chats whose team works in the background, sv16), hold(on)
// (no new turn starts), restartList() and close(); closeServer(): closes the HTTP server. onAlert: the page hears why a
// restart waits. now, every/stopEvery (the check), spawn and exit: replaceable for tests.
export function createRestarter({
  hub, smDir, closeServer, onAlert = () => {}, now = Date.now, every = setInterval, stopEvery = clearInterval, spawn = nodeSpawn,
  exit = (code) => process.exit(code), execPath = process.execPath, argv = process.argv.slice(1), env = process.env,
  checkMs = CHECK_MS, waitMs = WAIT_MS, teamsWaitMs = TEAMS_WAIT_MS, teamsQuietMs = TEAMS_QUIET_MS, teamsLookMs = TEAMS_LOOK_MS,
}) {
  let pending = null;
  let timer = null;
  let going = null;
  let holding = false;
  let told = false;
  let look = null;

  // fresh: a look of now, not the one kept from up to teamsLookMs ago.
  function lookTeams(fresh) {
    const t = now();
    if (!fresh && look && t - look.at < teamsLookMs) return look.teams;
    let teams = 0;
    try { teams = typeof hub.teams === 'function' ? hub.teams({ now: t, quietMs: teamsQuietMs }).length : 0; } catch (err) {
      log('warn', 'restart-teams-look-failed', { error: err.message });
    }
    look = { at: t, teams };
    return teams;
  }

  const teamsWait = (teams) => teams > 0 && now() < pending.teamsUntil;

  // While a team works the chats are free and the turns' deadline is the latest one; once no team does (or the hour is
  // over) the turns are held and a chat mid-turn gets its usual wait from that moment. -> the teams at work.
  function settle(fresh = false) {
    const teams = lookTeams(fresh);
    if (teamsWait(teams)) {
      if (holding) { holding = false; hub.hold(false); }
      pending = { ...pending, deadline: pending.teamsUntil + waitMs };
      if (!told) {
        told = true;
        try {
          onAlert({ kind: 'finished', reason: 'restart-waits', projectId: 'session-map', projectName: 'session-map', sessionId: null, title: '', origin: 'map', teams, because: pending.reasons.at(-1) });
        } catch (err) { log('warn', 'restart-alert-failed', { error: err.message }); }
      }
    } else if (!holding) {
      holding = true;
      hub.hold(true);
      pending = { ...pending, deadline: Math.min(pending.teamsUntil + waitMs, now() + waitMs) };
    }
    return teams;
  }

  function request({ reason, chatKey } = {}) {
    if (going) return { scheduled: true, already: true };
    const joined = joinRequest(pending, { reason: cleanReason(reason), chatKey: KEY_RE.test(String(chatKey)) ? chatKey : null, now: now(), waitMs });
    pending = joined.already ? joined.pending : { ...joined.pending, teamsUntil: joined.pending.at + teamsWaitMs };
    const teams = settle();
    if (!timer) {
      timer = every(check, checkMs);
      timer?.unref?.();
    }
    log('info', 'restart-requested', { joined: joined.already, reason: pending.reasons.at(-1), teams });
    const why = teamsWait(teams) ? { teams, teamsUntil: new Date(pending.teamsUntil).toISOString() } : {};
    if (joined.already) return { scheduled: true, already: true, ...why };
    return { scheduled: true, waitingFor: hub.turning(), ...why, deadline: new Date(pending.deadline).toISOString() };
  }

  const ready = (teams) => decideRestart({ pending, turning: hub.turning(), teams, now: now() }) === 'now';

  function check() {
    if (going || !pending || !ready(settle())) return going;
    // The kept look may be up to teamsLookMs old: a team that started since is not cut on its word.
    if (look.at !== now() && !ready(settle(true))) return going;
    stopEvery(timer);
    timer = null;
    // From here on no turn starts, whatever a look says.
    holding = true;
    hub.hold(true);
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
// One whose team in the background was cut (sv16) goes on with the note too: the hub adds which team and how to resume it.
const wantsNote = (c) => c.running === true || c.held === true || c.asked === true || Boolean(c.teams);
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
  // Read before any chat is resumed: a resumed claude writes its own "stopped" for the work that died with the old one.
  const teamsOf = (sessionId) => {
    try {
      const teams = typeof hub.cutTeams === 'function' ? hub.cutTeams(sessionId) : null;
      return hasCutTeams(teams) ? teams : null;
    } catch (err) {
      log('warn', 'restart-teams-read-failed', { sessionId, error: err.message });
      return null;
    }
  };
  const chats = saved.chats.map((c) => ({ ...c, teams: teamsOf(c.sessionId) }));
  const todo = [...chats.filter(wantsNote), ...chats.filter((c) => !wantsNote(c))];
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
      try { res = await hub.start(bodyOf(c, saved.reasons), state, { restart: true, ...(c.teams ? { teams: c.teams } : {}) }); } catch (err) { res = { status: 500, body: { error: err.message } }; }
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
