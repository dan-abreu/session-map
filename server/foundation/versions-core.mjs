// The pure side of "versions always in sight" (fd09): semver, the floor of a range, code against tag, the kind of a
// commit, the next number to publish and the warning a piece earns from the sources that answered. Nothing here reads a
// disk, a git repository or the network: the readers (versions.mjs) and the online sources (versions-online.mjs) hand
// text and answers in, and the AI never takes part (exact is the program's).

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// Pure semver only: `1.2` or `v0.10.1k` are not versions, so nothing is ever guessed from them.
export function parseSemver(text) {
  if (typeof text !== 'string') return null;
  const m = SEMVER.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

const parsedOf = (v) => (v && typeof v === 'object' ? v : parseSemver(v));

// Identifiers of a pre-release: numbers by value and below words; a longer list wins when the shorter is its prefix.
function comparePre(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const xs = a.split('.');
  const ys = b.split('.');
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const xn = /^\d+$/.test(xs[i]);
    const yn = /^\d+$/.test(ys[i]);
    if (xn && yn) {
      const d = Number(xs[i]) - Number(ys[i]);
      if (d) return d < 0 ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (xs[i] !== ys[i]) {
      return xs[i] < ys[i] ? -1 : 1;
    }
  }
  if (xs.length === ys.length) return 0;
  return xs.length < ys.length ? -1 : 1;
}

// -1 | 0 | 1, or null when a side is not semver (build metadata is ignored, as semver says).
export function compareSemver(a, b) {
  const x = parsedOf(a);
  const y = parsedOf(b);
  if (!x || !y) return null;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return comparePre(x.pre, y.pre);
}

const textOf = (p) => `${p.major}.${p.minor}.${p.patch}${p.pre ? `-${p.pre}` : ''}`;

// ---------- the floor of a range ----------
const BOUND = /^(\^|~>?|>=|>|=)?v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const part = (s) => (s === undefined || !/^\d+$/.test(s) ? 0 : Number(s));

// `^16.0.1` -> 16.0.1, `~1.2` -> 1.2.0, `>=20` -> 20.0.0, `>=18 <22` -> 18.0.0, `^1 || ^2` -> 1.0.0. The lowest version the
// range allows, always as x.y.z. No lower bound (`*`, `<5`, `latest`, a workspace or git target) = null.
export function floorOfRange(range) {
  if (typeof range !== 'string') return null;
  let best = null;
  for (const alt of range.split('||')) {
    const tokens = alt.trim().replace(/(>=|>|<=|<|=|\^|~>|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const m = BOUND.exec(token);
      if (!m) continue;
      const found = { major: Number(m[2]), minor: part(m[3]), patch: part(m[4]), pre: m[5] ?? null };
      if (best === null || compareSemver(found, best) < 0) best = found;
      break; // the first bound of an alternative is its floor (`>=18 <22`, `1.2.3 - 2.3.4`)
    }
  }
  return best ? textOf(best) : null;
}

// ---------- code against tag ----------
// Both read as semver; anything else is `unknown`, which is not a mismatch (we cannot tell).
export function relationOf(code, tag) {
  const c = compareSemver(code, tag);
  if (c === null) return 'unknown';
  return c === 0 ? 'equal' : c > 0 ? 'ahead' : 'behind';
}

export const mismatchOf = (relation) => relation === 'ahead' || relation === 'behind';

// ---------- the kind of a commit ----------
const TYPES = new Set(['feat', 'fix', 'perf', 'docs', 'chore', 'style', 'test', 'ci', 'build', 'refactor', 'revert']);
const BUMP_OF = { feat: 'minor', fix: 'patch', perf: 'patch' };
const HEAD = /^([A-Za-z]+)(?:\(([^)]*)\))?(!)?:\s/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

export function classifyCommit(subject, body = '') {
  const head = typeof subject === 'string' ? subject.trim().split('\n')[0] : '';
  const m = HEAD.exec(`${head} `);
  const type = m && TYPES.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
  if (!type) return { type: null, scope: null, breaking: false, bump: null };
  const breaking = Boolean(m[3]) || BREAKING_FOOTER.test(typeof body === 'string' ? body : '');
  return { type, scope: m[2] || null, breaking, bump: breaking ? 'major' : BUMP_OF[type] ?? null };
}

// ---------- the next number ----------
const LEVELS = ['patch', 'minor', 'major'];

// base = the last tag (the code version when there is no tag). commits = what came after it: { hash, subject, body }.
// Highest change wins: breaking > feat > fix. A 0.x project never jumps to 1.0.0 by itself: breaking is a minor bump there.
// null = nothing to publish. A base that is not pure semver (`v0.10.1k`, a pre-release) only says the kind: version null.
export function nextVersion(base, commits, codeVersion) {
  let top = null;
  const byLevel = { breaking: [], feat: [], fix: [] };
  for (const raw of Array.isArray(commits) ? commits : []) {
    const commit = typeof raw === 'string' ? { subject: raw } : raw ?? {};
    const { type, breaking, bump } = classifyCommit(commit.subject, commit.body);
    if (!bump) continue;
    const because = breaking ? 'breaking' : type === 'feat' ? 'feat' : 'fix';
    if (typeof commit.hash === 'string' && commit.hash) byLevel[because].push(commit.hash);
    const rank = breaking ? 2 : bump === 'minor' ? 1 : 0;
    if (top === null || rank > top) top = rank;
  }
  if (top === null) return null;
  const because = ['fix', 'feat', 'breaking'][top];
  const commitsOf = byLevel[because];

  const hasTag = typeof base === 'string' && base.trim() !== '';
  const from = parseSemver(hasTag ? base : codeVersion);
  if (!from || from.pre !== null) {
    return hasTag ? { version: null, because, commits: commitsOf, alreadyInCode: false, nonSemver: true } : null;
  }
  let level = LEVELS[top];
  if (level === 'major' && from.major === 0) level = 'minor';
  const next = level === 'major'
    ? { major: from.major + 1, minor: 0, patch: 0, pre: null }
    : level === 'minor'
      ? { major: from.major, minor: from.minor + 1, patch: 0, pre: null }
      : { major: from.major, minor: from.minor, patch: from.patch + 1, pre: null };
  const version = textOf(next);
  const inCode = compareSemver(codeVersion, version);
  return { version, because, commits: commitsOf, alreadyInCode: inCode !== null && inCode >= 0, nonSemver: false };
}

// ---------- the warning of a piece ----------
// The main pieces (contract § 5 of the block): where each one is looked up. `runtime` = the language or platform itself.
export const MAIN_PIECES = Object.freeze([
  ['node', 'runtime'], ['php', 'runtime'], ['dart', 'runtime'], ['flutter', 'runtime'],
  ['next', 'npm'], ['react', 'npm'], ['fastify', 'npm'], ['express', 'npm'], ['@nestjs/core', 'npm'], ['vue', 'npm'],
  ['nuxt', 'npm'], ['svelte', 'npm'], ['astro', 'npm'], ['vite', 'npm'], ['prisma', 'npm'], ['typescript', 'npm'],
  ['laravel/framework', 'packagist'], ['symfony/framework-bundle', 'packagist'],
].map(([name, ecosystem]) => Object.freeze({ name, ecosystem })));

// The key both sides agree on: `vulns` is keyed by `ecosystem:name@version`, `latest` by `ecosystem:name`.
export const pieceKey = (piece) => `${piece.ecosystem}:${piece.name}@${piece.version}`;

const idOf = (v) => (typeof v === 'string' ? v : v && typeof v.id === 'string' ? v.id : null);

function eolCycle(cycles, v) {
  if (!Array.isArray(cycles)) return null;
  const find = (c) => cycles.find((x) => String(x?.cycle) === c) ?? null;
  return find(`${v.major}.${v.minor}`) ?? find(String(v.major));
}

function eolWarning(cycle, now) {
  if (cycle.eol === true) return { kind: 'eol', ids: [], detail: 'ended' };
  if (typeof cycle.eol !== 'string') return null;
  const ends = Date.parse(cycle.eol);
  return Number.isNaN(ends) || ends > now ? null : { kind: 'eol', ids: [], detail: `ended ${cycle.eol}` };
}

// sources = { vulns: { [pieceKey]: [id | {id}] }, eol: { [name]: [{ cycle, eol }] }, latest: { 'ecosystem:name': '1.2.3' },
// now, reason }. A source only counts for a piece it answered about (a key that is there, even with an empty list);
// `verified` is true only then, so a piece nobody asked about is never shown as clean. Order: vulnerable > eol > behind;
// behind = at least one whole major version below the latest.
export function warningOf(piece, sources) {
  const none = (reason) => ({ warning: null, verified: false, reason, latest: null });
  const v = parsedOf(floorOfRange(piece?.version));
  if (!v) return none('no-version');
  const own = { ...piece, version: textOf(v) };
  const now = sources?.now ? new Date(sources.now).getTime() : Date.now();
  let verified = false;
  let warning = null;

  const vulns = sources?.vulns;
  if (vulns && Object.hasOwn(vulns, pieceKey(own))) {
    verified = true;
    const ids = [...new Set((vulns[pieceKey(own)] ?? []).map(idOf).filter(Boolean))];
    if (ids.length) warning = { kind: 'vulnerable', ids, detail: ids.length === 1 ? '1 advisory' : `${ids.length} advisories` };
  }

  const cycle = eolCycle(sources?.eol?.[piece.name], v);
  if (cycle) {
    verified = true;
    warning ??= eolWarning(cycle, now);
  }

  const latest = parseSemver(sources?.latest?.[`${piece.ecosystem}:${piece.name}`]);
  if (latest) {
    verified = true;
    if (latest.major > v.major) warning ??= { kind: 'behind', ids: [], detail: `latest ${textOf(latest)}` };
  }

  if (!verified) return none(sources?.reason ?? 'no-source');
  return { warning, verified: true, reason: null, latest: latest ? textOf(latest) : null };
}
