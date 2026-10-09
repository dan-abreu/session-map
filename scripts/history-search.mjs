import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIndex, searchIndex } from '../server/archive.mjs';
import { claudeDir } from '../server/sources/claude.mjs';

const cut = (s, n = 160) => {
  const flat = s.replace(/\s+/g, ' ');
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

// Plain labels for the person; the conversation number lets Claude open the one they pick.
export function formatResults(results) {
  if (results.length === 0) return 'Nothing found in the saved history. Try other words.';
  return results
    .map((e) =>
      [
        cut(`${e.title} (${String(e.endedAt ?? '').slice(0, 10)}, ${e.projectDir})`),
        `You asked: ${cut(e.userPrompts[0] ?? '')}`,
        `Last answer: ${cut(e.lastAssistantText)}`,
        `Conversation number: ${e.sessionId}`,
      ].join('\n'),
    )
    .join('\n\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--project');
  const project = flag === -1 ? undefined : args.splice(flag, 2)[1];
  console.log(formatResults(searchIndex(readIndex(join(claudeDir(), 'session-map')), args.join(' '), { project, limit: 5 })));
}
