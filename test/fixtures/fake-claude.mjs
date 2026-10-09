// Stand-in for the `claude` CLI: logs how it was called to FAKE_LOG and prints FAKE_REPLY (or sleeps FAKE_SLEEP_MS).
import { writeFileSync } from 'node:fs';

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  if (process.env.FAKE_LOG) {
    writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), envKeys: Object.keys(process.env), stdin }));
  }
  const reply = () => process.stdout.write(process.env.FAKE_REPLY ?? '');
  if (process.env.FAKE_SLEEP_MS) setTimeout(reply, Number(process.env.FAKE_SLEEP_MS));
  else reply();
});
