// Laravel / PHP reader (fd02): routes (with their prefixes and resources), Blade views as screens, migrations as tables,
// Eloquent relations, queued jobs and their queues, env() names, Http:: integrations, and the dispatch calls the index joins
// to the jobs. It is exact, not clever: the patterns run on the text with comments, strings and heredocs blanked by lex(),
// literal values come back from the real text at the same offsets, and whatever cannot be known for sure (a path in a
// variable, a queue named by an expression, a renamed resource parameter) stays AMBIGUOUS with the written expression,
// never guessed. Pure: the index hands the text in; nothing here touches the disk, a process or the network.
import { lex, literalAt } from '../lex.mjs';

export const VERSION = 'php@1';
export const TYPES = ['php', 'blade'];

const ROUTE_START_RE = /(?<![\w$])Route\s*::/g;
const HTTP_START_RE = /(?<![\w$])Http\s*::/g;
const SCHEMA_CREATE_RE = /(?<![\w$])Schema\s*::\s*(?:connection\s*\([^()]*\)\s*->\s*)?create\s*\(/g;
const CLASS_RE = /(?<![\w$:>])(?:(?:abstract|final|readonly)\s+)*class\s+([A-Za-z_]\w*)\s*(?:extends\s+([\\\w]+))?\s*(?:implements\s+([^{;]*?))?\s*\{/g;
const FUNCTION_RE = /(?<![\w$])function\s+&?\s*([A-Za-z_]\w*)\s*\(/g;
const RELATION_CALL_RE = /\$this\s*->\s*(hasMany|hasOne|belongsTo|belongsToMany|hasManyThrough|hasOneThrough|morphMany|morphOne|morphToMany|morphedByMany)\s*\(/;
const ENV_RE = /(?<![\w$>:])env\s*\(\s*(['"])/g;
const DISPATCH_STATIC_RE = /(?<![\w$>])(\\?(?:[A-Za-z_]\w*\\)*[A-Za-z_]\w*)\s*::\s*dispatch(?:Sync|Now|AfterResponse|If|Unless)?\s*\(/g;
const DISPATCH_NEW_RE = /(?:(?<![\w$>:])(?:Bus\s*::\s*)?|\$this\s*->\s*)dispatch(?:Sync|Now|_sync)?\s*\(\s*new\s+(\\?(?:[A-Za-z_]\w*\\)*[A-Za-z_]\w*)/g;

const ROUTE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'any']);
const REDIRECTS = new Set(['redirect', 'permanentRedirect']);
const TERMINALS = new Set([...ROUTE_VERBS, ...REDIRECTS, 'match', 'view', 'resource', 'apiResource', 'resources', 'apiResources', 'group']);
const ACTIONS = {
  index: ['GET', ''], create: ['GET', '/create'], store: ['POST', ''], show: ['GET', '/{p}'],
  edit: ['GET', '/{p}/edit'], update: ['PUT', '/{p}'], destroy: ['DELETE', '/{p}'],
};
const API_ACTIONS = ['index', 'store', 'show', 'update', 'destroy'];
const ALL_ACTIONS = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];
// Str::singular is doctrine/inflector (English rules), copied whole from 2.1, the version Laravel ^2.0.5 installs:
// the irregular pairs (singular plural), the uninflected patterns of the singular side and the singular rules, in order.
const IRREGULAR_PAIRS = [
  'abuse abuses', 'alga algae', 'atlas atlases', 'avalanche avalanches', 'axis axes', 'axe axes', 'beef beefs',
  'blouse blouses', 'brother brothers', 'brownie brownies', 'cache caches', 'cafe cafes', 'canvas canvases',
  'cave caves', 'chateau chateaux', 'child children', 'cookie cookies', 'corpus corpuses', 'cow cows',
  'criterion criteria', 'curriculum curricula', 'curve curves', 'demo demos', 'die dice', 'domino dominoes',
  'echo echoes', 'emphasis emphases', 'epoch epochs', 'foe foes', 'foot feet', 'fungus fungi', 'ganglion ganglions',
  'gas gases', 'genie genies', 'genus genera', 'goose geese', 'graffito graffiti', 'grave graves',
  'hippopotamus hippopotami', 'hoax hoaxes', 'hoof hoofs', 'human humans', 'iris irises', 'larva larvae',
  'leaf leaves', 'lens lenses', 'loaf loaves', 'man men', 'medium media', 'memorandum memoranda', 'money monies',
  'mongoose mongooses', 'motto mottoes', 'move moves', 'mythos mythoi', 'neurosis neuroses', 'niche niches',
  'niveau niveaux', 'nucleus nuclei', 'numen numina', 'nursery nurseries', 'oasis oases', 'occiput occiputs',
  'octopus octopuses', 'opus opuses', 'ox oxen', 'passerby passersby', 'penis penises', 'person people',
  'plateau plateaux', 'runner-up runners-up', 'safe safes', 'save saves', 'sex sexes', 'sieve sieves',
  'soliloquy soliloquies', 'son-in-law sons-in-law', 'stadium stadiums', 'syllabus syllabi', 'testis testes',
  'thief thieves', 'tooth teeth', 'tornado tornadoes', 'trilby trilbys', 'turf turfs', 'valve valves',
  'volcano volcanoes', 'wave waves', 'zombie zombies',
];
const UNINFLECTED = [
  '\\w+media', 'advice', 'aircraft', 'amoyese', 'art', 'audio', 'baggage', 'bison', 'borghese', 'bream', 'breeches',
  'britches', 'buffalo', 'butter', 'cantus', 'carp', 'cattle', 'chassis', 'clippers', 'clothing', 'coal', 'cod',
  'coitus', 'compensation', 'congoese', 'contretemps', 'coreopsis', 'corps', 'cotton', 'data', 'debris', 'deer',
  'diabetes', 'djinn', 'education', 'eland', 'elk', 'emoji', 'equipment', 'evidence', 'faroese', 'feedback', 'fish',
  'flounder', 'flour', 'foochowese', 'food', 'furniture', 'gallows', 'genevese', 'genoese', 'gilbertese', 'gold',
  'headquarters', 'herpes', 'hijinks', 'homework', 'hottentotese', 'impatience', 'information', 'innings',
  'jackanapes', 'jeans', 'jedi', 'kin', 'kiplingese', 'knowledge', 'kongoese', 'leather', 'love', 'lucchese',
  'luggage', 'mackerel', 'Maltese', 'management', 'metadata', 'mews', 'money', 'moose', 'mumps', 'music',
  'nankingese', 'news', 'nexus', 'niasese', 'nutrition', 'offspring', 'oil', 'patience', 'pekingese', 'piedmontese',
  'pincers', 'pistoiese', 'plankton', 'pliers', 'pokemon', 'police', 'polish', 'portuguese', 'proceedings',
  'progress', 'rabies', 'rain', 'research', 'rhinoceros', 'rice', 'salmon', 'sand', 'sarawakese', 'scissors',
  'sea[- ]bass', 'series', 'shavese', 'shears', 'sheep', 'siemens', 'silk', 'sms', 'soap', 'social media', 'spam',
  'species', 'staff', 'sugar', 'swine', 'talent', 'toothpaste', 'traffic', 'travel', 'trousers', 'trout', 'tuna',
  'us', 'vermontese', 'vinegar', 'weather', 'wenchowese', 'wheat', 'whiting', 'wildebeest', 'wood', 'wool',
  'yengeese', '.*ss', 'clothes', 'data', 'fascia', 'fuchsia', 'galleria', 'mafia', 'militia', 'pants', 'petunia',
  'sepia', 'trivia', 'utopia',
];
const SINGULAR_RULES = [
  [/(s)tatuses$/i, '$1tatus'], [/(s)tatus$/i, '$1tatus'], [/(c)ampus$/i, '$1ampus'], [/^(.*)(menu)s$/i, '$1$2'],
  [/(quiz)zes$/i, '$1'], [/(matr)ices$/i, '$1ix'], [/(vert|ind)ices$/i, '$1ex'], [/^(ox)en/i, '$1'],
  [/(alias)(es)*$/i, '$1'], [/(buffal|her|potat|tomat|volcan)oes$/i, '$1o'],
  [/(alumn|bacill|cact|foc|fung|nucle|radi|stimul|syllab|termin|viri?)i$/i, '$1us'], [/([ftw]ax)es/i, '$1'],
  [/(analys|ax|cris|test|thes)es$/i, '$1is'], [/(shoe|slave)s$/i, '$1'], [/(o)es$/i, '$1'], [/ouses$/i, 'ouse'],
  [/([^a])uses$/i, '$1us'], [/([m|l])ice$/i, '$1ouse'], [/(x|ch|ss|sh)es$/i, '$1'], [/(m)ovies$/i, '$1ovie'],
  [/(s)eries$/i, '$1eries'], [/([^aeiouy]|qu)ies$/i, '$1y'], [/([lr])ves$/i, '$1f'], [/(tive)s$/i, '$1'],
  [/(hive)s$/i, '$1'], [/(drive)s$/i, '$1'], [/(dive)s$/i, '$1'], [/(olive)s$/i, '$1'], [/([^fo])ves$/i, '$1fe'],
  [/(^analy)ses$/i, '$1sis'], [/(analy|diagno|^ba|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$/i, '$1$2sis'],
  [/(tax)a$/i, '$1on'], [/(c)riteria$/i, '$1riterion'], [/([ti])a(?<!regatta)$/i, '$1um'], [/(p)eople$/i, '$1erson'],
  [/(m)en$/i, '$1an'], [/(c)hildren$/i, '$1hild'], [/(f)eet$/i, '$1oot'], [/(n)ews$/i, '$1ews'], [/eaus$/i, 'eau'],
  [/^tights$/i, 'tights'], [/^shorts$/i, 'shorts'], [/s$/i, ''],
];
// plural -> singular; a plural listed twice keeps the later pair, as Doctrine's flipped table does (axes -> axe)
const IRREGULAR = new Map(IRREGULAR_PAIRS.map((p) => p.split(' ').reverse()));
const UNINFLECTED_RE = new RegExp(`^(?:${UNINFLECTED.join('|')})$`, 'i');
const MODEL_BASES = new Set(['Model', 'Pivot', 'Authenticatable']);
const RELATIONS = {
  hasMany: '1-n', belongsTo: '1-n', hasManyThrough: '1-n', morphMany: '1-n',
  hasOne: '1-1', hasOneThrough: '1-1', morphOne: '1-1',
  belongsToMany: 'n-n', morphToMany: 'n-n', morphedByMany: 'n-n',
};
const MORPHS = new Set(['morphs', 'nullableMorphs', 'uuidMorphs', 'nullableUuidMorphs', 'ulidMorphs', 'nullableUlidMorphs']);
const TIMESTAMPS = new Set(['timestamps', 'timestampsTz', 'nullableTimestamps']);
// table settings and indexes take a literal first argument that is not a column name; foreignIdFor names its column
// after a class, which the text does not spell
const NOT_A_COLUMN = new Set([
  'index', 'unique', 'primary', 'foreign', 'fullText', 'spatialIndex', 'rawIndex', 'comment', 'foreignIdFor',
  'engine', 'charset', 'collation', 'temporary',
]);
const SKIP_CLASSES = new Set(['self', 'static', 'parent', 'Bus', 'Event', 'Queue', 'Notification', 'Mail']);

// ---------- text helpers (the same small kit the JS reader uses) ----------

function lineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

// Index of the bracket that closes the one at `open` (masked text: brackets in strings and comments are gone), or -1.
function closeOf(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// The pieces between the commas at the top level of the bracket at `open`: [{ start, end }] (offsets into the text).
function splitTop(masked, open) {
  const close = closeOf(masked, open);
  if (close < 0) return [];
  const parts = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push({ start, end: i }); start = i + 1; }
  }
  parts.push({ start, end: close });
  return parts.filter((p) => masked.slice(p.start, p.end).trim() !== '');
}

function makeCtx(path, text, masked, workspace) {
  const ctx = { path, text, masked, lineOf: lineIndex(text), workspace: workspace ?? { dir: '', name: '' } };
  ctx.firstAt = (start, end) => {
    for (let i = start; i < end; i++) if (!/\s/.test(masked[i])) return i;
    return -1;
  };
  // The value of a string literal that fills the whole range; null for anything else (a name, a concatenation, an
  // interpolated string).
  ctx.literal = (start, end) => {
    const at = ctx.firstAt(start, end);
    if (at < 0 || !/['"]/.test(masked[at])) return null;
    const lit = literalAt(text, at, 'php');
    return lit && masked.slice(lit.end, end).trim() === '' ? lit.value : null;
  };
  ctx.expr = (start, end) => text.slice(start, end).trim().replace(/\s+/g, ' ');
  // The strings of an array literal `[...]` or `array(...)` filling the range (null for a non-literal entry), or null
  // when the range is not an array.
  ctx.list = (start, end) => {
    const open = ctx.arrayOpen(start, end);
    return open < 0 ? null : splitTop(masked, open).map((p) => ctx.literal(p.start, p.end));
  };
  // Where the bracket of an array literal `[...]` or `array(...)` starting the range opens, or -1.
  ctx.arrayOpen = (start, end) => {
    const at = ctx.firstAt(start, end);
    if (at < 0) return -1;
    if (masked[at] === '[') return at;
    return /^array\s*\(/.test(masked.slice(at, at + 12)) ? masked.indexOf('(', at) : -1;
  };
  // A name or a list of names written as literals: 'a' or ['a', 'b']; null when any of it is not literal.
  ctx.names = (part) => {
    if (!part) return null;
    const one = ctx.literal(part.start, part.end);
    const names = one !== null ? [one] : ctx.list(part.start, part.end);
    return names && !names.includes(null) ? names : null;
  };
  // `'key' => value` pairs of the array that opens at `open`: key -> { start, end } of the value.
  ctx.pairs = (open) => {
    const out = new Map();
    for (const part of splitTop(masked, open)) {
      const m = /^\s*(['"])([\w.-]+)\1\s*=>\s*/.exec(text.slice(part.start, part.end));
      if (m) out.set(m[2], { start: part.start + m[0].length, end: part.end });
    }
    return out;
  };
  return ctx;
}

function mk(ctx, kind, id, offset, attrs, origin = 'EXTRACTED') {
  return {
    id, kind, name: id.slice(id.indexOf(':') + 1), file: ctx.path, line: ctx.lineOf(offset), origin,
    extractor: VERSION, attrs, refs: [], _at: offset,
  };
}

// One fact per id for the kinds where the same name in many places is still one thing; the later places go to refs.
function dedupe(facts, kinds) {
  const first = new Map();
  const out = [];
  for (const f of facts) {
    if (!kinds.has(f.kind)) { out.push(f); continue; }
    const prev = first.get(f.id);
    if (!prev) { first.set(f.id, f); out.push(f); } else if (f.line !== prev.line) prev.refs.push({ file: f.file, line: f.line });
  }
  return out;
}

function relativeTo(path, dir) {
  const d = (dir ?? '').replace(/^\.\/?/, '').replace(/\/$/, '');
  if (!d) return path;
  return path.startsWith(`${d}/`) ? path.slice(d.length + 1) : path;
}

function appNameOf(workspace) {
  const dir = (workspace.dir ?? '').replace(/\/$/, '');
  const base = dir ? dir.split('/').pop() : String(workspace.name ?? '').split('/').pop();
  return base || 'app';
}

// ---------- method chains: Route::prefix('v1')->middleware('x')->group(...) ----------

// The calls of a chain that starts right after `::` at `from`: [{ name, open, close, args }].
function chainOf(masked, from) {
  const segs = [];
  let pos = from;
  for (;;) {
    const ident = /\s*([A-Za-z_]\w*)\s*/y;
    ident.lastIndex = pos;
    const r = ident.exec(masked);
    if (!r) break;
    const open = pos + r[0].length;
    if (masked[open] !== '(') break;
    const close = closeOf(masked, open);
    if (close < 0) break;
    segs.push({ name: r[1], open, close, args: splitTop(masked, open) });
    pos = close + 1;
    const arrow = /\s*\??->/y;
    arrow.lastIndex = pos;
    const a = arrow.exec(masked);
    if (!a) break;
    pos += a[0].length;
  }
  return segs;
}

// ---------- routes ----------

// Laravel names the parameter with Str::singular: Doctrine's RulesetInflector (uninflected word -> itself, then the
// irregular table, then the first rule that matches, replaced everywhere like preg_replace), then Pluralizer::matchCase.
// The odd answers are kept on purpose (Doctrine gives them, so Laravel's path has them too).
function singular(word) {
  if (word === '') return word;
  let out = word;
  const lower = word.toLowerCase();
  if (UNINFLECTED_RE.test(word)) out = word;
  else if (IRREGULAR.has(lower)) {
    const to = IRREGULAR.get(lower);
    out = lower[0] !== word[0] ? to[0].toUpperCase() + to.slice(1) : to;
  } else {
    const rule = SINGULAR_RULES.find(([re]) => re.test(word));
    if (rule) out = word.replace(new RegExp(rule[0].source, 'gi'), rule[1]);
  }
  return matchCase(out, word);
}

const ucfirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ucwords = (s) => s.replace(/(^|[ \t\r\n\f\v])(\S)/g, (_, a, b) => a + b.toUpperCase());

function matchCase(value, comparison) {
  for (const fn of [(s) => s.toLowerCase(), (s) => s.toUpperCase(), ucfirst, ucwords]) {
    if (fn(comparison) === comparison) return fn(value);
  }
  return value;
}

const joinPath = (pieces) => `/${pieces.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;

function prefixOf(ctx, part) {
  if (!part) return null;
  const lit = ctx.literal(part.start, part.end);
  return lit !== null ? { lit } : { expr: ctx.expr(part.start, part.end) };
}

function routeFacts(ctx, rel, facts) {
  const { masked } = ctx;
  const fileIsApi = rel === 'routes/api.php';
  const chains = [];
  for (const m of masked.matchAll(ROUTE_START_RE)) {
    const segs = chainOf(masked, m.index + m[0].length);
    if (!segs.length) continue;
    const ti = segs.findIndex((s) => TERMINALS.has(s.name));
    if (ti < 0) continue;
    const before = segs.slice(0, ti);
    const prefixSeg = [...before].reverse().find((s) => s.name === 'prefix');
    chains.push({ at: m.index, term: segs[ti], after: segs.slice(ti + 1), prefix: prefixOf(ctx, prefixSeg?.args[0]) });
  }

  // a group's prefix covers every chain that starts inside the call's parentheses
  const groups = [];
  for (const c of chains) {
    if (c.term.name !== 'group') continue;
    let prefix = c.prefix;
    const first = c.term.args[0];
    if (!prefix && first && masked[ctx.firstAt(first.start, first.end)] === '[') {
      const value = ctx.pairs(ctx.firstAt(first.start, first.end)).get('prefix');
      if (value) prefix = prefixOf(ctx, value);
    }
    groups.push({ start: c.term.open + 1, end: c.term.close, prefix });
  }

  for (const c of chains) {
    if (c.term.name === 'group') continue;
    const pieces = [];
    if (fileIsApi) pieces.push({ lit: 'api' });
    for (const g of groups) if (g.prefix && g.start <= c.at && c.at < g.end) pieces.push(g.prefix);
    if (c.prefix) pieces.push(c.prefix);
    const prefixed = pieces.length > 0;
    const dynamicPrefix = pieces.some((p) => p.expr !== undefined);
    const pieceText = pieces.map((p) => p.lit ?? p.expr);
    const emit = (method, uriLit, uriExpr, extra, force) => {
      const resolved = uriLit !== null && !dynamicPrefix && !force;
      const path = resolved ? joinPath([...pieceText, uriLit]) : null;
      const written = [...pieceText, uriLit ?? uriExpr].join('/');
      const attrs = { method, path, framework: 'laravel', ...extra };
      const id = `route:${method} ${resolved ? path : `?${force ?? written}`}`;
      facts.push(mk(ctx, 'route', id, c.at, attrs, resolved ? (prefixed || extra.action ? 'INFERRED' : 'EXTRACTED') : 'AMBIGUOUS'));
    };
    const { term } = c;
    const arg = (i) => term.args[i];
    if (ROUTE_VERBS.has(term.name)) {
      if (!arg(0)) continue;
      emit(term.name === 'any' ? 'ANY' : term.name.toUpperCase(), ctx.literal(arg(0).start, arg(0).end), ctx.expr(arg(0).start, arg(0).end), {});
    } else if (REDIRECTS.has(term.name)) {
      // Router::redirect registers the path with any()
      if (!arg(0)) continue;
      emit('ANY', ctx.literal(arg(0).start, arg(0).end), ctx.expr(arg(0).start, arg(0).end), {});
    } else if (term.name === 'view') {
      if (!arg(0)) continue;
      emit('GET', ctx.literal(arg(0).start, arg(0).end), ctx.expr(arg(0).start, arg(0).end), {});
    } else if (term.name === 'match') {
      if (!arg(0) || !arg(1)) continue;
      const verbs = ctx.list(arg(0).start, arg(0).end);
      const known = verbs && verbs.length > 0 && verbs.every((v) => v !== null && /^[A-Za-z]+$/.test(v));
      const uriLit = ctx.literal(arg(1).start, arg(1).end);
      const uriExpr = ctx.expr(arg(1).start, arg(1).end);
      if (known) for (const v of verbs) emit(v.toUpperCase(), uriLit, uriExpr, {});
      else emit('ANY', null, uriExpr, {});
    } else {
      resourceFacts(ctx, c, dynamicPrefix, emit);
    }
  }
}

// The resource names of resources([...]) / apiResources([...]): the keys of a literal array, or [null] when the array is
// not literal, a key is not a plain string, or an options argument may rename or trim what the text does not show.
function resourceNames(ctx, term) {
  const first = term.args[0];
  const at = ctx.firstAt(first.start, first.end);
  if (at < 0 || ctx.masked[at] !== '[' || term.args.length > 1) return [null];
  const parts = splitTop(ctx.masked, at);
  const pairs = ctx.pairs(at);
  return parts.length > 0 && pairs.size === parts.length ? [...pairs.keys()] : [null];
}

// resource / apiResource: one route per action (resources / apiResources: the same for each entry of the array).
// `only`/`except` trim them; a renamed parameter (`parameters`, `shallow`) or a trim that is not literal changes the
// paths in a way the text does not say, so the facts stay AMBIGUOUS.
function resourceFacts(ctx, c, dynamicPrefix, emit) {
  const { term } = c;
  if (!term.args[0]) return;
  if (term.name === 'resources' || term.name === 'apiResources') {
    const single = term.name === 'apiResources' ? 'apiResource' : 'resource';
    for (const name of resourceNames(ctx, term)) resourceRoutes(ctx, c, single, name, dynamicPrefix, emit);
    return;
  }
  resourceRoutes(ctx, c, term.name, ctx.literal(term.args[0].start, term.args[0].end), dynamicPrefix, emit);
}

// Option keys that leave the paths alone; any other key (parameters, shallow, scoped...) renames or nests the paths in a
// way the text does not show.
const PATH_NEUTRAL = new Set(['only', 'except', 'names', 'as', 'middleware', 'excluded_middleware', 'where', 'missing', 'trashed']);
const PATH_CHANGERS = new Set(['parameters', 'parameter', 'shallow', 'scoped']);

// Laravel's own steps: apiResource passes only = its five minus except, merged under the options array; ->only() and
// ->except() replace those keys; ResourceRegistrar keeps the defaults that are in only, then drops the except ones.
function resourceRoutes(ctx, c, kind, resource, dynamicPrefix, emit) {
  const { term } = c;
  const written = ctx.expr(term.open + 1, term.close);
  let unsure = resource === null || dynamicPrefix;
  const options = {};
  const optionsArg = term.name === kind ? term.args[2] : undefined;
  if (optionsArg) {
    const open = ctx.arrayOpen(optionsArg.start, optionsArg.end);
    const pairs = open < 0 ? new Map() : ctx.pairs(open);
    if (open < 0 || pairs.size !== splitTop(ctx.masked, open).length) unsure = true;
    for (const [key, value] of pairs) {
      if (!PATH_NEUTRAL.has(key)) { unsure = true; continue; }
      if (key !== 'only' && key !== 'except') continue;
      options[key] = ctx.names(value);
      if (!options[key]) unsure = true;
    }
  }
  if (kind === 'apiResource' && !('only' in options)) {
    options.only = API_ACTIONS.filter((x) => !(options.except ?? []).includes(x));
  }
  for (const m of c.after) {
    if (PATH_CHANGERS.has(m.name)) unsure = true;
    if (m.name !== 'only' && m.name !== 'except') continue;
    // PendingResourceRegistration takes an array, or else every argument as a name
    const first = m.args[0];
    const names = first && ctx.arrayOpen(first.start, first.end) >= 0 ? ctx.names(first) : m.args.map((a) => ctx.literal(a.start, a.end));
    options[m.name] = names && names.length > 0 && !names.includes(null) ? names : null;
    if (!options[m.name]) unsure = true;
  }
  const actions = ALL_ACTIONS.filter((x) => (!options.only || options.only.includes(x)) && !(options.except ?? []).includes(x));
  for (const action of actions) {
    const [method, tail] = ACTIONS[action];
    if (unsure) { emit(method, null, null, { action }, `${term.name}(${written})${resource === null || term.name === kind ? '' : `:${resource}`}#${action}`); continue; }
    const segs = resource.split('.');
    const param = (s) => `{${singular(s).replace(/-/g, '_')}}`;
    const base = segs.map((s, i) => (i < segs.length - 1 ? `${s}/${param(s)}` : s)).join('/');
    emit(method, `${base}${tail.replace('{p}', param(segs[segs.length - 1]))}`, null, { action });
  }
}

// ---------- migrations ----------

function tableFacts(ctx, facts) {
  const { masked } = ctx;
  for (const m of masked.matchAll(SCHEMA_CREATE_RE)) {
    const open = m.index + m[0].length - 1;
    const args = splitTop(masked, open);
    if (!args.length) continue;
    const name = ctx.literal(args[0].start, args[0].end);
    const columns = [];
    const body = args[1];
    if (body) {
      const sig = /^\s*(?:static\s+)?(?:function|fn)\s*\(\s*(?:[\w\\?]+\s+)?\$(\w+)/.exec(masked.slice(body.start, body.end));
      const v = (sig?.[1] ?? 'table').replace(/\$/g, '\\$');
      const callRe = new RegExp(`(?<![\\w$>])\\$${v}\\s*->\\s*([A-Za-z_]\\w*)\\s*\\(`, 'g');
      const slice = masked.slice(body.start, body.end);
      for (const c of slice.matchAll(callRe)) {
        const at = body.start + c.index;
        const parts = splitTop(masked, body.start + c.index + c[0].length - 1);
        const arg0 = parts[0] ? ctx.literal(parts[0].start, parts[0].end) : null;
        const line = ctx.lineOf(at);
        const method = c[1];
        const add = (n) => columns.push({ name: n, type: method, line });
        if (MORPHS.has(method)) { if (arg0) { add(`${arg0}_id`); add(`${arg0}_type`); } continue; }
        if (TIMESTAMPS.has(method)) { add('created_at'); add('updated_at'); continue; }
        if (method === 'softDeletes' || method === 'softDeletesTz') { add(arg0 ?? 'deleted_at'); continue; }
        if (method === 'rememberToken') { add('remember_token'); continue; }
        if (!parts.length && (method === 'id' || method === 'uuid' || method === 'ulid')) { add(method); continue; }
        if (NOT_A_COLUMN.has(method) || /^(?:drop|rename)/.test(method)) continue;
        if (arg0 !== null) add(arg0);
      }
    }
    const written = ctx.expr(args[0].start, args[0].end);
    facts.push(mk(ctx, 'table', `table:${name ?? `?${written}`}`, m.index, { source: 'laravel-migration', columns }, name === null ? 'AMBIGUOUS' : 'EXTRACTED'));
  }
}

// ---------- classes: Eloquent models and queued jobs ----------

function classesOf(ctx) {
  const { masked } = ctx;
  const out = [];
  for (const m of masked.matchAll(CLASS_RE)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(masked, open);
    const parent = m[2] ? m[2].split('\\').pop() : null;
    out.push({ name: m[1], at: m.index + m[0].lastIndexOf('class'), parent, implementsList: m[3] ?? '', open, close: close < 0 ? masked.length : close });
  }
  return out;
}

function targetOf(ctx, cls, part) {
  if (!part) return null;
  const lit = ctx.literal(part.start, part.end);
  const last = lit !== null ? lit.split('\\').pop() : null;
  const c = /^\\?(?:[\w]+\\)*(\w+)\s*::\s*class$/.exec(ctx.masked.slice(part.start, part.end).trim());
  const name = c ? c[1] : last;
  if (name === 'self' || name === 'static') return cls;
  return name && /^[A-Za-z_]\w*$/.test(name) ? name : null;
}

function modelFacts(ctx, cls, facts) {
  const { masked } = ctx;
  if (!cls.parent || !MODEL_BASES.has(cls.parent)) return;
  const body = masked.slice(cls.open, cls.close);
  for (const f of body.matchAll(FUNCTION_RE)) {
    const fnAt = cls.open + f.index;
    const paren = fnAt + f[0].length - 1;
    const pclose = closeOf(masked, paren);
    if (pclose < 0) continue;
    const brace = /\s*(?::\s*[\w\\?|]+\s*)?\{/y;
    brace.lastIndex = pclose + 1;
    const b = brace.exec(masked);
    if (!b) continue;
    const bopen = pclose + 1 + b[0].length - 1;
    const bclose = closeOf(masked, bopen);
    const fnBody = masked.slice(bopen, bclose < 0 ? masked.length : bclose);
    const rm = RELATION_CALL_RE.exec(fnBody);
    if (!rm) continue;
    const parts = splitTop(masked, bopen + rm.index + rm[0].length - 1);
    const target = targetOf(ctx, cls.name, parts[0]);
    const field = f[1];
    const attrs = { from: cls.name, to: target, field, cardinality: RELATIONS[rm[1]], source: 'eloquent' };
    const key = target ?? `?${parts[0] ? ctx.expr(parts[0].start, parts[0].end) : ''}`;
    facts.push(mk(ctx, 'relation', `relation:${cls.name}.${field}->${key}`, fnAt, attrs, target === null ? 'AMBIGUOUS' : 'EXTRACTED'));
  }
}

function jobFacts(ctx, cls, facts) {
  const { masked } = ctx;
  if (!/(?<![\w$])ShouldQueue\w*/.test(cls.implementsList)) return;
  const body = masked.slice(cls.open, cls.close);
  let found = null;
  for (const m of body.matchAll(/(?<![\w$])onQueue\s*\(/g)) {
    const at = cls.open + m.index;
    const part = splitTop(masked, at + m[0].length - 1)[0];
    if (part) { found = { at, part }; break; }
  }
  for (const m of body.matchAll(/(?:(?:public|protected|private|var)\s+(?:[\w?\\]+\s+)?\$queue|\$this\s*->\s*queue)\s*=(?![=>])/g)) {
    const at = cls.open + m.index;
    if (found && found.at < at) break;
    const start = at + m[0].length;
    const semi = masked.indexOf(';', start);
    found = { at, part: { start, end: semi < 0 ? cls.close : semi } };
    break;
  }
  let key;
  let origin = 'EXTRACTED';
  let queueAt = found ? found.at : cls.at;
  let queueAttrs = { lib: 'laravel' };
  let queueName = null;
  if (!found) {
    key = 'default';
    origin = 'INFERRED';
  } else {
    queueName = ctx.literal(found.part.start, found.part.end);
    if (queueName === null) {
      key = `?${ctx.expr(found.part.start, found.part.end)}`;
      origin = 'AMBIGUOUS';
      queueAttrs = { lib: 'laravel', name: null };
    } else {
      key = queueName;
    }
  }
  if (!found) queueAt = cls.at;
  facts.push(mk(ctx, 'queue', `queue:${key}`, queueAt, queueAttrs, origin));
  facts.push(mk(ctx, 'job', `job:${key}/${cls.name}`, cls.at, { queue: key.startsWith('?') ? null : key, lib: 'laravel', role: 'consumer' }, origin));
}

// ---------- dispatch hints ----------

function namespaceOf(masked) {
  const m = /(?<![\w$])namespace\s+([\w\\]+)\s*[;{]/.exec(masked);
  return m ? m[1] : '';
}

// local name -> full class name, from the `use` lines that come before the first class
function useMap(masked) {
  const head = masked.slice(0, (/(?<![\w$:>])(?:class|interface|trait|enum)\s+[A-Za-z_]/.exec(masked)?.index) ?? masked.length);
  const map = new Map();
  for (const m of head.matchAll(/(?<![\w$])use\s+(?!function\b|const\b)\\?([\w\\]+?)\\\s*\{([^}]*)\}\s*;/g)) {
    for (const item of m[2].split(',')) {
      const i = /^\s*([\w\\]+)(?:\s+as\s+(\w+))?\s*$/.exec(item);
      if (i) map.set(i[2] ?? i[1].split('\\').pop(), `${m[1]}\\${i[1]}`);
    }
  }
  for (const m of head.matchAll(/(?<![\w$])use\s+(?!function\b|const\b)\\?([\w\\]+)(?:\s+as\s+(\w+))?\s*;/g)) {
    map.set(m[2] ?? m[1].split('\\').pop(), m[1]);
  }
  return map;
}

function dispatchHints(ctx) {
  const { masked } = ctx;
  const ns = namespaceOf(masked);
  const uses = useMap(masked);
  const resolve = (written) => {
    if (written.startsWith('\\')) return written.slice(1);
    const [head, ...rest] = written.split('\\');
    if (uses.has(head)) return [uses.get(head), ...rest].join('\\');
    return ns ? `${ns}\\${written}` : written;
  };
  const hints = [];
  const push = (written, offset) => {
    const fqcn = resolve(written);
    hints.push({ kind: 'job-dispatch', class: fqcn.split('\\').pop(), fqcn, line: ctx.lineOf(offset), _at: offset });
  };
  for (const m of masked.matchAll(DISPATCH_STATIC_RE)) {
    if (!SKIP_CLASSES.has(m[1])) push(m[1], m.index);
  }
  for (const m of masked.matchAll(DISPATCH_NEW_RE)) push(m[1], m.index);
  hints.sort((a, b) => a._at - b._at);
  for (const h of hints) delete h._at;
  return hints;
}

// ---------- env ----------

function envFacts(ctx, rel, facts) {
  const source = rel.startsWith('config/') ? 'config' : 'code';
  for (const m of ctx.masked.matchAll(ENV_RE)) {
    const lit = literalAt(ctx.text, m.index + m[0].length - 1, 'php');
    if (!lit || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(lit.value) || !/^\s*[,)]/.test(ctx.masked.slice(lit.end, lit.end + 20))) continue;
    facts.push(mk(ctx, 'env', `env:${lit.value}`, m.index, { source }));
  }
}

// ---------- integrations ----------

const isLocalHost = (host) => {
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.startsWith('[')) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

// The host of a URL whose beginning is written literally. `complete` = the whole URL is the literal; otherwise the host
// must be closed by a / ? # or : inside the literal part, or it could still be growing ('https://api-' . $env . '.x.com').
function hostOf(value, complete) {
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)([/?#:]|$)/i.exec(value);
  if (!m || (!m[2] && !complete)) return null;
  const host = m[1].toLowerCase();
  return isLocalHost(host) ? null : host;
}

function urlOf(ctx, part) {
  if (!part) return null;
  const { masked, text } = ctx;
  const at = ctx.firstAt(part.start, part.end);
  if (at < 0 || !/['"]/.test(masked[at])) return null;
  const lit = literalAt(text, at, 'php');
  if (lit) return hostOf(lit.value, masked.slice(lit.end, part.end).trim() === '');
  if (masked[at] === '"') {
    const dollar = text.slice(at + 1, part.end).search(/\$|\{\$/);
    if (dollar >= 0) return hostOf(text.slice(at + 1, at + 1 + dollar), false);
  }
  return null;
}

const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);

function integrationFacts(ctx, facts) {
  for (const m of ctx.masked.matchAll(HTTP_START_RE)) {
    for (const seg of chainOf(ctx.masked, m.index + m[0].length)) {
      let part = null;
      if (seg.name === 'baseUrl' || HTTP_VERBS.has(seg.name)) part = seg.args[0];
      else if (seg.name === 'send') part = seg.args[1];
      const host = urlOf(ctx, part);
      if (host) facts.push(mk(ctx, 'integration', `integration:${host}`, m.index, { via: 'url', host }));
    }
  }
}

// ---------- entry ----------

export function extract({ path, type, text, masked, workspace }) {
  const isBlade = type === 'blade' || path.endsWith('.blade.php');
  const rel = relativeTo(path, workspace?.dir);
  const facts = [];

  if (isBlade) {
    const m = /^resources\/views\/(.+)\.blade\.php$/.exec(rel);
    if (m && m[1].split('/')[0] !== 'components') {
      const view = m[1].split('/').join('.');
      const ctx = makeCtx(path, text, text, workspace);
      facts.push(mk(ctx, 'screen', `screen:${appNameOf(ctx.workspace)}:${view}`, 0, { framework: 'blade', route: view, widget: view }));
    }
    for (const f of facts) delete f._at;
    return { facts, hints: [] };
  }

  const body = masked ?? lex(text, 'php').masked;
  const ctx = makeCtx(path, text, body, workspace);
  if (/^routes\/[^/]+\.php$/.test(rel)) routeFacts(ctx, rel, facts);
  if (/^database\/migrations\/(?:.+\/)?[^/]+\.php$/.test(rel)) tableFacts(ctx, facts);
  for (const cls of classesOf(ctx)) {
    modelFacts(ctx, cls, facts);
    jobFacts(ctx, cls, facts);
  }
  envFacts(ctx, rel, facts);
  integrationFacts(ctx, facts);
  facts.sort((a, b) => a._at - b._at);
  const merged = dedupe(facts, new Set(['env', 'integration']));
  for (const f of merged) delete f._at;
  return { facts: merged, hints: dispatchHints(ctx) };
}
