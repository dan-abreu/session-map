import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { archiveTranscript, refFromPath } from '../server/archive.mjs';
import { claudeDir } from '../server/sources/claude.mjs';

const smDir = join(claudeDir(), 'session-map');

function note(result, extra = {}) {
  try {
    mkdirSync(smDir, { recursive: true });
    appendFileSync(join(smDir, 'actions.log'), `${JSON.stringify({ ts: new Date().toISOString(), action: 'archive', via: 'SessionEnd', result, ...extra })}\n`);
  } catch { /* nothing left to report to */ }
}

// Whatever happens, the Claude session must end cleanly.
try {
  const { transcript_path: path } = JSON.parse(readFileSync(0, 'utf8'));
  note(archiveTranscript(refFromPath(path, statSync(path).mtimeMs), smDir));
} catch (err) {
  note('error', { code: err.code ?? err.name });
}
process.exit(0);
