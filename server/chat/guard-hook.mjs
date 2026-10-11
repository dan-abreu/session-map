// The PreToolUse hook claude runs before each shell step of a page chat (guard.mjs): the step as JSON on stdin, the answer
// (a denial, or nothing) on stdout. --snapshot: the Autonomous way, which snapshots before a destructive step.
import { guardStep } from './guard.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', async () => {
  let input = null;
  try { input = JSON.parse(raw); } catch { /* not a step: nothing to say */ }
  const answer = await guardStep(input, { snapshotOn: process.argv.includes('--snapshot') }).catch(() => null);
  // A snapshot given up on still has git running: the step must not wait for it, so the hook exits once it has answered.
  if (answer) process.stdout.write(JSON.stringify(answer), () => process.exit(0));
  else process.exit(0);
});
