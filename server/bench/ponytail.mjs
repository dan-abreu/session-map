// The vendored measurements feed the program's bench (id142, or47, task 2): the ponytail benchmark's real numbers,
// read from the vendored results — a measured source, never an opinion. server/ai/brainpanel.mjs shows them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RESULTS = fileURLToPath(new URL('../disciplines/ponytail/benchmarks/results/2026-10-07-agentic.md', import.meta.url));

export function ponytailMeasure({ read = readFileSync } = {}) {
  let text;
  try { text = String(read(RESULTS, 'utf8')); } catch { return null; }
  const pct = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  return {
    date: '2026-10-07',
    codePct: pct(/\| Lines of code \| [^|]+ \| \*\*-(\d+)%/),
    tokensPct: pct(/\| Output tokens \| [^|]+ \| \*\*-(\d+)%/),
    costPct: pct(/\| Cost \| [^|]+ \| \*\*-(\d+)%/),
    testsPct: pct(/\| A test where the logic needs one \| [^|]+ \| [^|]+ \| \*\*(\d+)%/),
    baselineTestsPct: 68,
  };
}
