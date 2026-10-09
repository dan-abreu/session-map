// How an alert leaves the server (watcher-and-alerts wa03, wa04): a native desktop toast with no extra dependency, and
// the phone through ntfy only when the person turned it on. The alert's text always travels by environment or as a
// plain argument, never pasted into a script, so a conversation title cannot become a command.
import { execFile } from 'node:child_process';
import { log } from '../log.mjs';
import { alertText, groupAlerts, wantsAlert } from '../web/alerts.js';
import { pickLang, translator } from '../web/i18n.js';

const TOAST_TIMEOUT_MS = 15_000;
const NTFY_TIMEOUT_MS = 10_000;
const NTFY_URL = 'https://ntfy.sh/';
// Windows only shows toasts of a registered app: PowerShell's own id is on every Windows 10 and 11.
const WINDOWS_APP = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
  '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
  '$xml.LoadXml($env:SM_TOAST_XML)',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:SM_TOAST_APP).Show([Windows.UI.Notifications.ToastNotification]::new($xml))',
].join('; ');
const MAC_SCRIPT = 'display notification (system attribute "SM_BODY") with title (system attribute "SM_TITLE")';

const XML_CHARS = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => XML_CHARS[c]);

// words: {title, body, action, url}. → {file, args, env} for execFile, or null where the system has no toast to call.
// A click opens the link in the browser on Windows; macOS and Linux show the text only.
export function toastCommand(platform, { title, body, action, url }) {
  if (platform === 'win32') {
    const link = xml(url);
    const toast = `<toast activationType="protocol" launch="${link}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual>`
      + `<actions><action content="${xml(action)}" activationType="protocol" arguments="${link}"/></actions></toast>`;
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', WINDOWS_SCRIPT],
      env: { SM_TOAST_XML: toast, SM_TOAST_APP: WINDOWS_APP },
    };
  }
  if (platform === 'darwin') return { file: 'osascript', args: ['-e', MAC_SCRIPT], env: { SM_TITLE: title, SM_BODY: body } };
  if (platform === 'linux') return { file: 'notify-send', args: ['--app-name=session-map', title, body], env: {} };
  return null;
}

// words: {title, body}, already without content (alertText with content false).
export function ntfyRequest(topic, { title, body }) {
  return { url: NTFY_URL, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic, title, message: body }) } };
}

// A single alert opens its conversation; a group or a clash opens the project.
function linkOf(baseUrl, group) {
  const params = new URLSearchParams({ project: group.projectId });
  const [only] = group.alerts;
  if (group.alerts.length === 1 && only.sessionId) params.set('conv', only.sessionId);
  return `${baseUrl}/?${params}`;
}

const systemLang = () => pickLang(null, Intl.DateTimeFormat().resolvedOptions().locale);

// → deliver(alerts, prefs): one toast per group of alerts the person wants, and the same on the phone when it is on.
export function createDelivery({ platform = process.platform, exec = execFile, fetchFn = globalThis.fetch, baseUrl }) {
  const toast = (cmd) => new Promise((resolve) => {
    exec(cmd.file, cmd.args, { env: { ...process.env, ...cmd.env }, windowsHide: true, timeout: TOAST_TIMEOUT_MS }, (err) => {
      if (err) log('warn', 'toast-failed', { code: err.code ?? null });
      resolve();
    });
  });
  const phone = async (topic, words) => {
    const req = ntfyRequest(topic, words);
    try {
      const res = await fetchFn(req.url, { ...req.init, signal: AbortSignal.timeout(NTFY_TIMEOUT_MS) });
      if (res && res.ok === false) log('warn', 'ntfy-failed', { status: res.status ?? null });
    } catch (err) {
      log('warn', 'ntfy-failed', { error: err.message });
    }
  };
  return async function deliver(alerts, prefs) {
    const t = translator(prefs.lang ?? systemLang());
    const jobs = [];
    for (const group of groupAlerts(alerts.filter((a) => wantsAlert(prefs, a)))) {
      const cmd = prefs.desktop ? toastCommand(platform, { ...alertText(t, group), url: linkOf(baseUrl, group) }) : null;
      if (cmd) jobs.push(toast(cmd));
      if (prefs.ntfy?.enabled && prefs.ntfy.topic) jobs.push(phone(prefs.ntfy.topic, alertText(t, group, { content: false })));
    }
    await Promise.all(jobs);
  };
}
