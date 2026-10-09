import { join } from 'node:path';
import { readIndex, searchIndex } from '../server/archive.mjs';
import { claudeDir } from '../server/sources/claude.mjs';

const args = process.argv.slice(2);
const flag = args.indexOf('--project');
const project = flag === -1 ? undefined : args.splice(flag, 2)[1];
const query = args.join(' ');

const cut = (s, n = 160) => {
  const flat = s.replace(/\s+/g, ' ');
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
const results = searchIndex(readIndex(join(claudeDir(), 'session-map')), query, { project, limit: 5 });

if (results.length === 0) {
  console.log('No matches in the archived history.');
} else {
  console.log(
    results
      .map((e) =>
        [
          cut(`${e.title} (${String(e.endedAt ?? '').slice(0, 10)}, ${e.projectDir})`),
          `asked: ${cut(e.userPrompts[0] ?? '')}`,
          `last answer: ${cut(e.lastAssistantText)}`,
          `session: ${e.sessionId}`,
        ].join('\n'),
      )
      .join('\n\n'),
  );
}
