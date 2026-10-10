import { execFile } from 'node:child_process';

// Project profile, part 2: the signals (personal-data payments login uploads location), the team and where it is published.
// Exact by rule: package names, column names, route words and file names. Every signal carries evidence (file + line that
// exist). Nothing here keeps an author name or an e-mail: git is asked for counts and the names stop at the parser.

export const SIGNAL_KINDS = ['personal-data', 'payments', 'login', 'uploads', 'location'];
const MAX_EVIDENCE = 10;
const GIT_TIMEOUT_MS = 10_000;

const anyOf = (names) => new RegExp(`^(?:${names.join('|')})$`);

// ponytail: convention. One closed table per signal: dependency names (also the package of an integration fact), column-name
// words, path words of a route and, for a few, the host of an integration. A word must match whole ("emailer" is not "email").
const RULES = {
  'personal-data': {
    columns: new Set(['email', 'phone', 'telephone', 'cellphone', 'telefone', 'celular', 'cpf', 'rg', 'ssn', 'dob', 'birthdate', 'birthday', 'birth',
      'nascimento', 'passport', 'address', 'endereco', 'street', 'zip', 'zipcode', 'cep', 'postcode', 'firstname', 'lastname', 'fullname', 'surname', 'sobrenome']),
    namePair: new Set(['first', 'last', 'full', 'middle', 'given', 'family', 'sur']),
  },
  payments: {
    deps: anyOf(['stripe', '@stripe/.+', 'mercadopago', '@mercadopago/.+', 'mercadopago/dx-php', 'paypal', '@paypal/.+', 'paypal-rest-sdk', 'pagarme', 'pagar\\.me', '@pagarme/.+',
      'pagseguro[\\w.-]*', 'asaas', '@adyen/.+', 'adyen-api-library', 'braintree', 'razorpay', '@paddle/.+', '@lemonsqueezy/.+', 'laravel/cashier', 'stripe/stripe-php', 'flutter_stripe',
      'in_app_purchase', 'purchases_flutter']),
    hosts: /(?:^|\.)(?:stripe\.com|paypal\.com|mercadopago\.com|pagar\.me|pagseguro\.uol\.com\.br|asaas\.com|adyen\.com|braintreegateway\.com|razorpay\.com|paddle\.com|lemonsqueezy\.com)$/,
    routes: new Set(['checkout', 'payment', 'payments', 'billing', 'subscription', 'subscriptions', 'invoice', 'invoices']),
  },
  login: {
    deps: anyOf(['next-auth', '@auth/.+', 'passport', 'passport-[\\w-]+', '@fastify/passport', '@fastify/jwt', '@fastify/session', 'express-session', '@clerk/.+', '@supabase/ssr',
      '@supabase/auth-js', '@supabase/auth-helpers-[\\w-]+', 'firebase_auth', 'google_sign_in', 'sign_in_with_apple', 'laravel/sanctum', 'laravel/passport', 'laravel/breeze',
      'laravel/jetstream', 'laravel/fortify', 'laravel/socialite', 'auth0', '@auth0/.+', 'lucia', 'better-auth', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'argon2']),
    columns: new Set(['password', 'passwd', 'senha', 'passwordhash']),
    routes: new Set(['login', 'signin', 'signup', 'register', 'logout', 'auth', 'oauth']),
  },
  uploads: {
    deps: anyOf(['multer', '@fastify/multipart', 'formidable', 'busboy', 'express-fileupload', 'uploadthing', '@uploadthing/.+', '@aws-sdk/client-s3', 'cloudinary', '@vercel/blob',
      'react-dropzone', 'image_picker', 'file_picker', 'spatie/laravel-medialibrary', 'league/flysystem[\\w-]*']),
    routes: new Set(['upload', 'uploads', 'attachment', 'attachments', 'avatar', 'avatars']),
  },
  location: {
    deps: anyOf(['geolocator', 'geocoding', 'location', 'google_maps_flutter', 'flutter_map', 'expo-location', 'react-native-geolocation-service', '@react-native-community/geolocation',
      'leaflet', 'react-leaflet', 'mapbox-gl', 'maplibre-gl', '@googlemaps/.+', '@react-google-maps/api', 'geoip-lite', 'geopy']),
    hosts: /(?:^|\.)(?:maps\.googleapis\.com|api\.mapbox\.com|nominatim\.openstreetmap\.org)$/,
    columns: new Set(['latitude', 'longitude', 'lat', 'lng', 'lon', 'gps', 'geolocation']),
  },
};

const wordsOf = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// A column is personal data when one whole word of its name is on the list, or when "name" comes right after first/last/full...
// A bare "name" is not.
function personalColumn(name) {
  const words = wordsOf(name);
  const { columns, namePair } = RULES['personal-data'];
  return words.some((w, i) => columns.has(w) || (w === 'name' && i > 0 && namePair.has(words[i - 1])));
}
const columnHas = (kind, name) => (kind === 'personal-data' ? personalColumn(name) : wordsOf(name).some((w) => RULES[kind].columns.has(w)));

function routeHas(kind, path) {
  const words = RULES[kind].routes;
  if (!words || typeof path !== 'string') return false;
  return path.toLowerCase().split('/').some((seg) => {
    const parts = seg.split(/[-_]/);
    return parts.some((p) => words.has(p)) || words.has(parts.join(''));
  });
}

const evidenceOf = (file, line, sha, factId) => ({ file, line, ...(sha ? { sha } : {}), ...(factId ? { factId } : {}) });
const byPlace = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);

// signalsOf({ facts, deps }) -> [{ kind, evidence: [{ file, line, sha?, factId? }] }] in the contract order, once each.
// `deps` comes from depsOf (profile-stacks.mjs); `facts` is the `facts` list of facts.json.
export function signalsOf({ facts = [], deps = [] } = {}) {
  const found = new Map(SIGNAL_KINDS.map((k) => [k, []]));
  const add = (kind, ev) => found.get(kind).push(ev);
  for (const d of deps) {
    for (const kind of SIGNAL_KINDS) if (RULES[kind].deps?.test(d.name)) add(kind, evidenceOf(d.file, d.line, d.sha));
  }
  for (const f of facts) {
    if (f.kind === 'table') {
      for (const c of f.attrs?.columns ?? []) {
        for (const kind of SIGNAL_KINDS) if (RULES[kind].columns) {
          if (columnHas(kind, c.name)) add(kind, evidenceOf(f.file, c.line, f.sha, f.id));
        }
      }
    } else if (f.kind === 'route') {
      for (const kind of SIGNAL_KINDS) if (routeHas(kind, f.attrs?.path)) add(kind, evidenceOf(f.file, f.line, f.sha, f.id));
    } else if (f.kind === 'integration') {
      const pkg = f.attrs?.package;
      const host = f.attrs?.host;
      for (const kind of SIGNAL_KINDS) {
        const r = RULES[kind];
        if ((pkg && r.deps?.test(pkg)) || (host && r.hosts?.test(host))) add(kind, evidenceOf(f.file, f.line, f.sha, f.id));
      }
    }
  }
  return SIGNAL_KINDS.filter((k) => found.get(k).length).map((kind) => {
    const seen = new Set();
    const evidence = found.get(kind).sort(byPlace).filter((e) => {
      const key = `${e.file}:${e.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, MAX_EVIDENCE);
    return { kind, evidence };
  });
}

// ---------- team ----------

const BOT = /\[bot\]$|^(?:dependabot|renovate|github-actions)$/i;
const isBot = (a) => (typeof a === 'string' ? BOT.test(a.trim()) : !!a && (a.bot === true || (typeof a.name === 'string' && BOT.test(a.name.trim()))));

// teamOf(authors) -> { kind, authors }. `authors` is what gitAuthors returns ({ commits, bot }) or a list of names or of
// { name, commits }; bots never count. Only the number of humans leaves: solo (1) or team (2+); nobody = kind null.
export function teamOf(authors) {
  const humans = (Array.isArray(authors) ? authors : []).filter((a) => a != null && !isBot(a)).length;
  return { kind: humans === 0 ? null : humans === 1 ? 'solo' : 'team', authors: humans };
}

// The only I/O of this file: `git shortlog -sn HEAD`, 10 s. Answers [{ commits, bot }] with no name and no e-mail. The same
// name in different letter case is one author. Not a repository, no commits, no git, timeout = [].
export function gitAuthors(root) {
  return new Promise((resolve) => {
    execFile('git', ['shortlog', '-sn', 'HEAD'], { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      if (err) { resolve([]); return; }
      const byName = new Map();
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
        if (!m) continue;
        const key = m[2].toLowerCase();
        const prev = byName.get(key) ?? { commits: 0, bot: BOT.test(m[2]) };
        prev.commits += Number(m[1]);
        byName.set(key, prev);
      }
      resolve([...byName.values()].sort((a, b) => b.commits - a.commits));
    });
  });
}

// ---------- where it is published ----------

// ponytail: convention. The files that say where a project runs, by base name. Only included files count; the evidence is the
// file itself (line 1), because the file existing is the whole fact.
const DEPLOY = [
  ['railway', /^railway\.(?:json|toml)$/i],
  ['docker', /^(?:dockerfile(?:\..+)?|.+\.dockerfile|docker-compose(?:\..+)?\.ya?ml|compose(?:\..+)?\.ya?ml)$/i],
  ['codemagic', /^codemagic\.ya?ml$/i],
  ['vercel', /^vercel\.json$/i],
  ['fly', /^fly\.toml$/i],
  ['netlify', /^netlify\.toml$/i],
  ['render', /^render\.ya?ml$/i],
  ['heroku', /^(?:procfile|heroku\.ya?ml)$/i],
  ['firebase', /^(?:firebase\.json|\.firebaserc)$/i],
  ['eas', /^eas\.json$/i],
  ['cloudflare', /^wrangler\.(?:toml|jsonc?)$/i],
];

// deployOf({ census }) -> [{ name, evidence: [{ file, line: 1, sha }] }] sorted by name, up to 5 files each.
export function deployOf({ census } = {}) {
  const files = (census?.files ?? []).filter((f) => f && f.included && typeof f.path === 'string').sort((a, b) => (a.path < b.path ? -1 : 1));
  const out = [];
  for (const [name, re] of DEPLOY) {
    const hits = files.filter((f) => re.test(f.path.split('/').pop())).slice(0, 5);
    if (hits.length) out.push({ name, evidence: hits.map((f) => evidenceOf(f.path, 1, f.sha)) });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}
