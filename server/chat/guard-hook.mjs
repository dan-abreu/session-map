// The PreToolUse hook claude runs before each shell step of a page chat (guard.mjs): the step as JSON on stdin, the answer
// (a denial, or nothing) on stdout. --snapshot: the Autonomous way, which snapshots before a destructive step.
import { guardStep } from './guard.mjs';

// --user: the copy from the plugin or the user settings. A page chat already has these hooks through --settings (and
// SESSION_MAP_PAGE_CHAT=1 in its env), so the second copy does nothing there.
if (process.argv.includes('--user') && process.env.SESSION_MAP_PAGE_CHAT === '1') process.exit(0);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', async () => {
  let input = null;
  try { input = JSON.parse(raw); } catch { /* not a step: nothing to say */ }
  const answer = await guardStep(input, { snapshotOn: process.argv.includes('--snapshot'), mapEdit: !process.argv.includes('--user') }).catch(() => null);
  // A snapshot given up on still has git running: the step must not wait for it, so the hook exits once it has answered.
  if (answer) process.stdout.write(JSON.stringify(answer), () => process.exit(0));
  else process.exit(0);
});
