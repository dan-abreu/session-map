// The watcher (watcher-and-alerts wa01): looks at the whole state every few seconds, whether a page is open or not, turns
// the changes into alerts, hands them to delivery (desktop, phone) and keeps the newest for the page to fetch.
import { randomBytes } from 'node:crypto';
import { log } from '../log.mjs';
import { wantsAlert } from '../web/alerts.js';
import { snapshotOf, transitionsOf } from './watch.mjs';

const FEED_MAX = 100;

// readState() → the state; deliver(alerts, prefs); prefs() → notifyPrefs; skip() → the sessionIds the page drives (it
// pushes their changes itself); startup(state) → alerts the first look brings (chats a restart cut off).
export function createWatcher({ readState, deliver, prefs, skip, startup = () => [] }) {
  // A new boot numbers from 1 again: the page tells by the boot id that its last id means nothing here.
  const boot = randomBytes(6).toString('hex');
  const feed = [];
  let lastId = 0;
  let last = null;
  let looking = null;
  let timer = null;

  function push(events) {
    if (!events.length) return;
    const ts = new Date().toISOString();
    const alerts = events.map((e) => ({ ...e, id: ++lastId, ts }));
    feed.push(...alerts);
    feed.splice(0, Math.max(0, feed.length - FEED_MAX));
    Promise.resolve(deliver(alerts, prefs())).catch((err) => log('warn', 'alert-delivery-failed', { error: err.message }));
  }

  async function look() {
    let state;
    try {
      state = await readState();
    } catch (err) {
      log('warn', 'watch-failed', { error: err.message });
      return;
    }
    const next = snapshotOf(state);
    const events = last ? transitionsOf(last, next, { skip: skip() }) : startup(state);
    last = next;
    push(events);
  }

  function tick() {
    looking ??= look().finally(() => { looking = null; });
    return looking;
  }

  // The page's feed: the alerts after its last id that the project wants, and the id to ask from next time.
  function since(afterId) {
    const wanted = prefs();
    return { boot, lastId, alerts: feed.filter((a) => a.id > afterId && wantsAlert(wanted, a)) };
  }

  return {
    tick, push, since,
    start(intervalMs) {
      timer ??= setInterval(tick, intervalMs);
      timer.unref?.();
      tick();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
