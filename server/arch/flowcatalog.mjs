// What the Flow's general view (flow.md fl08) knows about the world outside a project: the outside services a program
// reaches and the people (or programs) who use it, each with the plain signals in the code that show it. Data and two
// lookups only: nothing here reads a file or runs anything. Names and arrow labels are i18n keys, so one model serves
// every language; `name` is the English fallback.

export const CATALOG_VERSION = 'flowcat@3';

// where: 'internet' (an outside service) or 'this-pc' (a program or folder on the same computer). dir: 'out' draws the
// arrow part → service, 'in' service → part. packages: npm, pub and composer names; scopes: npm scopes; hosts: exact
// hosts or '.suffix'; commands: program names a file runs; tags: a command that means two things counts only in a file
// whose code is about that (a toast or a terminal window); literals: the literal kinds flowscan reports; files: a
// hosting file at any depth.
const S = (id, where, key, name, labelKey, more = {}) => ({ id, where, nameKey: `flow.l1.svc.${key}`, name, labelKey: `flow.l1.lbl.${labelKey}`, dir: 'out', packages: [], scopes: [], hosts: [], commands: [], literals: [], envs: [], files: [], aliases: [], ...more });

export const SERVICES = [
  S('svc:claude', 'internet', 'claude', 'Claude (AI)', 'ai', { packages: ['@anthropic-ai/sdk', '@anthropic-ai/claude-code', '@anthropic-ai/claude-agent-sdk', 'anthropic'], hosts: ['api.anthropic.com'], commands: ['claude'], literals: ['claude-cli'], aliases: ['claude', 'anthropic', 'claude ai', 'claude cli'] }),
  S('svc:openai', 'internet', 'openai', 'OpenAI', 'ai', { packages: ['openai', 'openai_dart', 'openai-php/client'], hosts: ['api.openai.com'], aliases: ['openai', 'chatgpt', 'gpt'] }),
  S('svc:gemini', 'internet', 'gemini', 'Gemini (AI)', 'ai', { packages: ['@google/generative-ai', '@google/genai', 'google_generative_ai'], hosts: ['generativelanguage.googleapis.com'], aliases: ['gemini'] }),
  S('svc:github', 'internet', 'github', 'GitHub', 'github', { packages: ['@octokit/rest', 'octokit'], hosts: ['api.github.com'], commands: ['gh'], aliases: ['github'] }),
  S('svc:ntfy', 'internet', 'ntfy', 'ntfy (phone alerts)', 'ntfy', { hosts: ['ntfy.sh'], aliases: ['ntfy'] }),
  S('svc:stripe', 'internet', 'stripe', 'Stripe (payments)', 'pay', { packages: ['stripe', '@stripe/stripe-js', 'stripe/stripe-php', 'flutter_stripe'], hosts: ['api.stripe.com'], aliases: ['stripe'] }),
  S('svc:mercadopago', 'internet', 'mercadopago', 'Mercado Pago (payments)', 'pay', { packages: ['mercadopago', 'mercadopago/dx-php'], hosts: ['api.mercadopago.com'], aliases: ['mercado pago', 'mercadopago'] }),
  S('svc:asaas', 'internet', 'asaas', 'Asaas (payments)', 'pay', { packages: ['asaas'], hosts: ['api.asaas.com', 'sandbox.asaas.com'], aliases: ['asaas'] }),
  S('svc:pagarme', 'internet', 'pagarme', 'Pagar.me (payments)', 'pay', { packages: ['pagarme', '@pagarme/pagarme-js', 'pagarme/pagarme-php'], hosts: ['api.pagar.me'], aliases: ['pagarme', 'pagar.me'] }),
  S('svc:twilio', 'internet', 'twilio', 'Twilio (SMS and calls)', 'message', { packages: ['twilio', 'twilio/sdk'], hosts: ['api.twilio.com'], aliases: ['twilio'] }),
  S('svc:whatsapp', 'internet', 'whatsapp', 'WhatsApp', 'message', { packages: ['whatsapp-web.js', '@whiskeysockets/baileys'], hosts: ['graph.facebook.com'], aliases: ['whatsapp', 'zap'] }),
  S('svc:email', 'internet', 'email', 'E-mail sending', 'email', { packages: ['resend', 'nodemailer', '@sendgrid/mail', 'postmark', 'mailgun.js', '@aws-sdk/client-ses', 'resend/resend-php', 'symfony/mailer'], hosts: ['api.resend.com', 'api.sendgrid.com', 'api.postmarkapp.com'], aliases: ['email', 'e-mail', 'mail', 'resend', 'sendgrid'] }),
  S('svc:firebase', 'internet', 'firebase', 'Firebase', 'data', { packages: ['firebase-admin', 'firebase', 'firebase_core', 'cloud_firestore', 'firebase_auth', 'firebase_messaging', 'kreait/firebase-php'], hosts: ['.firebaseio.com', 'firestore.googleapis.com'], aliases: ['firebase', 'firestore'] }),
  S('svc:supabase', 'internet', 'supabase', 'Supabase', 'data', { packages: ['@supabase/supabase-js', 'supabase_flutter', 'supabase'], hosts: ['.supabase.co'], aliases: ['supabase'] }),
  S('svc:database', 'internet', 'database', 'Database', 'data', { packages: ['pg', 'postgres', 'mysql', 'mysql2', 'mongodb', 'mongoose', '@prisma/client', 'prisma', 'sequelize', 'typeorm', 'drizzle-orm', 'knex', 'better-sqlite3', 'sqlite3', 'sqflite', 'doctrine/dbal'], aliases: ['database', 'db', 'banco de dados', 'banco', 'postgres', 'postgresql', 'mysql', 'mongodb'] }),
  S('svc:redis', 'internet', 'redis', 'Redis (queues and cache)', 'queue', { packages: ['ioredis', 'redis', 'bullmq', 'bull', 'predis/predis'], aliases: ['redis', 'fila', 'queue'] }),
  S('svc:aws', 'internet', 'aws', 'Amazon Web Services', 'storage', { packages: ['aws-sdk', 'aws/aws-sdk-php'], scopes: ['@aws-sdk/'], hosts: ['.amazonaws.com'], aliases: ['aws', 'amazon', 's3'] }),
  S('svc:sentry', 'internet', 'sentry', 'Sentry (error tracking)', 'errors', { packages: ['sentry_flutter', 'sentry/sentry-laravel', 'sentry/sentry'], scopes: ['@sentry/'], hosts: ['.ingest.sentry.io'], aliases: ['sentry'] }),
  S('svc:vercel', 'internet', 'vercel', 'Vercel (hosting)', 'hosting', { files: ['vercel.json'], aliases: ['vercel'] }),
  S('svc:netlify', 'internet', 'netlify', 'Netlify (hosting)', 'hosting', { files: ['netlify.toml'], aliases: ['netlify'] }),
  S('svc:fly', 'internet', 'fly', 'Fly.io (hosting)', 'hosting', { files: ['fly.toml'], aliases: ['fly', 'fly.io'] }),
  S('svc:render', 'internet', 'render', 'Render (hosting)', 'hosting', { files: ['render.yaml'], aliases: ['render'] }),
  S('svc:git', 'this-pc', 'git', 'Version history', 'git', { commands: ['git'], aliases: ['git'] }),
  S('svc:claude-files', 'this-pc', 'claudeFiles', 'Claude Code\'s files (~/.claude)', 'claudeFiles', { dir: 'in', literals: ['claude-home'], envs: ['CLAUDE_CONFIG_DIR'], aliases: ['claude files', '.claude', '~/.claude', 'arquivos do claude'] }),
  S('svc:vscode', 'this-pc', 'vscode', 'VS Code', 'vscode', { literals: ['vscode-url'], commands: ['code'], aliases: ['vscode', 'vs code', 'visual studio code'] }),
  S('svc:toast', 'this-pc', 'toast', 'Desktop notifications', 'toast', { commands: ['powershell', 'osascript', 'notify-send'], tags: 'toast', aliases: ['notifications', 'notificacoes', 'toast'] }),
  S('svc:terminal', 'this-pc', 'terminal', 'Terminal windows', 'terminal', { commands: ['wt', 'powershell', 'osascript', 'x-terminal-emulator', 'gnome-terminal', 'cmd'], tags: 'terminal', aliases: ['terminal'] }),
];

// Who uses a program. The detection rules live in flowmodel (detectedFacts); here are names, labels and the words that
// say, from an app's folder or a screen's route, who its screens are for.
const A = (key, name, labelKey, aliases = []) => ({ nameKey: `flow.l1.actor.${key}`, name, labelKey: `flow.l1.lbl.${labelKey}`, aliases });
export const ACTORS = {
  'actor:browser': A('browser', 'You, in the browser', 'browser', ['browser', 'navegador', 'you in the browser', 'voce no navegador']),
  'actor:lan': A('lan', 'Your phone, when sharing on the network is on', 'lan', ['phone', 'celular', 'mobile']),
  'actor:terminal': A('terminal', 'You, in the terminal', 'cli', ['terminal', 'cli', 'you in the terminal']),
  'actor:claude-code': A('claudeCode', 'Claude Code (its automatic steps and plugin)', 'claudeCode', ['claude code']),
  'actor:admin': A('admin', 'The team, in the admin panel', 'screens', ['admin', 'painel', 'panel', 'owner', 'dono', 'equipe', 'team', 'gestor']),
  'actor:customer': A('customer', 'Customers', 'screens', ['customer', 'customers', 'cliente', 'clientes', 'client']),
  'actor:pro': A('pro', 'Professionals', 'screens', ['professional', 'professionals', 'profissional', 'profissionais', 'driver', 'entregador', 'parceiro', 'partner']),
  'actor:user': A('user', 'People using the app', 'screens', ['user', 'users', 'usuario', 'usuarios', 'people', 'pessoas']),
};

const ADMIN_WORDS = ['admin', 'painel', 'panel', 'dashboard', 'backoffice', 'back-office', 'gestao', 'manager', 'cms', 'console'];
const CUSTOMER_WORDS = ['customer', 'customers', 'cliente', 'clientes', 'client', 'consumer', 'loja', 'store', 'storefront', 'shop'];
const PRO_WORDS = ['pro', 'profissional', 'professional', 'partner', 'parceiro', 'driver', 'motorista', 'entregador', 'courier', 'seller', 'vendedor', 'merchant', 'lojista'];

const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s) => plain(s).split(/[^a-z0-9-]+/).filter(Boolean);

// The actor whose screens an app shows: a route under /admin or /painel is the team's whatever the app; then the app's
// folder name; anyone else is "people using the app".
export function actorOfApp(app, route) {
  const first = words(route)[0] ?? '';
  if (ADMIN_WORDS.includes(first)) return 'actor:admin';
  const name = words(app);
  if (name.some((w) => ADMIN_WORDS.includes(w))) return 'actor:admin';
  if (name.some((w) => CUSTOMER_WORDS.includes(w))) return 'actor:customer';
  if (name.some((w) => PRO_WORDS.includes(w))) return 'actor:pro';
  return 'actor:user';
}

// Hosts that name a standard, never a call: an SVG namespace is not a service.
const NAMESPACE_HOSTS = new Set(['www.w3.org', 'w3.org', 'schema.org', 'json-schema.org', 'www.schema.org', 'purl.org', 'xmlns.com', 'ns.adobe.com']);

// Same rule as the js extractor's: a host on this machine or this network is not an outside service.
export function isLocalHost(host) {
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.startsWith('[')) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const hostMatch = (list, host) => list.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
const packageMatch = (svc, name) => svc.packages.includes(name) || svc.scopes.some((s) => name.startsWith(s) && name.length > s.length);

const generic = (host) => ({ id: `svc:host:${host}`, where: 'internet', nameKey: null, name: host, labelKey: 'flow.l1.lbl.http', dir: 'out', generic: true });

// The service a signal shows, or null. signal: { type: 'sdk'|'dep'|'host'|'command'|'literal'|'env'|'file', value, tags? }.
export function serviceOf(signal) {
  const value = String(signal?.value ?? '');
  if (!value) return null;
  switch (signal.type) {
    case 'sdk':
    case 'dep':
      return SERVICES.find((s) => packageMatch(s, value)) ?? null;
    case 'host': {
      const host = value.toLowerCase();
      if (isLocalHost(host) || NAMESPACE_HOSTS.has(host)) return null;
      return SERVICES.find((s) => hostMatch(s.hosts, host)) ?? generic(host);
    }
    case 'command': {
      const tags = signal.tags ?? [];
      return SERVICES.find((s) => s.commands.includes(value) && (!s.tags || tags.includes(s.tags))) ?? null;
    }
    case 'literal':
      return SERVICES.find((s) => s.literals.includes(value)) ?? null;
    case 'env':
      return SERVICES.find((s) => s.envs.includes(value)) ?? null;
    case 'file':
      return SERVICES.find((s) => s.files.includes(value.split('/').pop().toLowerCase())) ?? null;
    default:
      return null;
  }
}

export const serviceById = (id) => SERVICES.find((s) => s.id === id) ?? (id.startsWith('svc:host:') ? generic(id.slice(9)) : null);

const key = (s) => plain(s).replace(/[^a-z0-9]/g, '');

// A box someone drew in the README, read by its name: the catalog entry it stands for, or null.
export function catalogOfLabel(label) {
  const k = key(label);
  if (!k) return null;
  for (const s of SERVICES) {
    if ([s.name, s.id.slice(4), ...s.aliases].some((a) => key(a) === k)) return { kind: 'service', id: s.id };
  }
  for (const [id, a] of Object.entries(ACTORS)) {
    if ([a.name, id.slice(6), ...a.aliases].some((x) => key(x) === k)) return { kind: 'actor', id };
  }
  return null;
}

// ---- the words on an arrow between two parts the README left without any (flow.md fl08) --------------------------
// A part is read by the words of its id and name: what it is says what it hands on. Data only, first match wins, so
// the more specific roles come first ("Page chat" is a chat, "Mind map page" a page). `whole` matches only a name that
// is exactly that word: a part called "Flow" is the drawing, a "Checkout flow" is not.
const R = (role, words, whole = []) => ({ role, words, whole });
export const ROLES = [
  R('chat', ['chat', 'chats', 'conversa', 'conversas']),
  R('plugin', ['plugin', 'plugins', 'cli', 'terminal', 'hook', 'hooks', 'extension', 'extensao', 'comandos', 'commands']),
  R('page', ['page', 'pages', 'pagina', 'paginas', 'web', 'ui', 'frontend', 'front', 'screen', 'screens', 'tela', 'telas', 'site', 'dashboard', 'painel']),
  R('server', ['server', 'servidor', 'api', 'backend', 'gateway']),
  R('reader', ['reader', 'readers', 'leitor', 'leitores', 'leitura', 'sources', 'fontes', 'ingest', 'importer', 'scanner', 'collector', 'coleta']),
  R('foundation', ['foundation', 'fundacao', 'fundamentos', 'facts', 'fatos', 'census']),
  R('archmap', ['architecture', 'arquitetura']),
  R('state', ['state', 'estado', 'store', 'builder']),
  R('diagram', ['diagram', 'diagrams', 'diagrama', 'diagramas', 'desenho'], ['flow', 'flows', 'fluxo', 'fluxos']),
  R('orchestration', ['orchestration', 'orchestrator', 'orquestracao', 'orquestrador', 'conductor', 'maestro', 'scheduler', 'agendador']),
  R('alerts', ['alert', 'alerts', 'alerta', 'alertas', 'avisos', 'watcher', 'notifications', 'notificacoes', 'monitor', 'monitoring']),
  R('bootstrap', ['bootstrap', 'inspection', 'inspecao', 'onboarding']),
  R('ideas', ['ideas', 'ideias', 'requests', 'pedidos', 'backlog', 'roadmap']),
  R('auth', ['auth', 'login', 'authentication', 'autenticacao', 'accounts', 'contas']),
  R('payments', ['payment', 'payments', 'pagamento', 'pagamentos', 'billing', 'cobranca', 'cobrancas', 'checkout']),
  R('db', ['database', 'databases', 'db', 'banco', 'storage', 'armazenamento', 'repository', 'repositorio']),
  R('queue', ['worker', 'workers', 'queue', 'queues', 'fila', 'filas', 'jobs', 'cron']),
];

// The table an arrow's words come from: a pair of roles with words of its own first (a part that hands on to several
// others says what each one gets, so its arrows can be told apart), then a target that says what it takes, then what
// the source hands on.
const ROLE_KEY = (role) => `flow.l1.lbl.role.${role}`;
const PAIRS = [
  ['state', 'diagram'], ['state', 'alerts'], ['state', 'orchestration'],
  ['foundation', 'archmap'], ['foundation', 'diagram'], ['foundation', 'bootstrap'],
  ['bootstrap', 'archmap'], ['bootstrap', 'diagram'], ['bootstrap', 'chat'],
  ['reader', 'alerts'],
];
export const LINK_RULES = [
  ...PAIRS.map(([from, to]) => ({ from, to, key: `flow.l1.lbl.pair.${from}.${to}` })),
  { to: 'page', key: ROLE_KEY('toPage') },
  { to: 'db', key: 'flow.l1.lbl.data' },
  { to: 'queue', key: 'flow.l1.lbl.queue' },
  ...ROLES.map(({ role }) => ({ from: role, key: role === 'payments' ? 'flow.l1.lbl.pay' : ROLE_KEY(role) })),
];

// The role of a part (or a free box), from its id and its name; null when no word is known.
export function roleOfPart(part) {
  const name = plain(part?.name).trim();
  const all = new Set([...words(part?.id), ...words(part?.partId), ...words(name)]);
  for (const r of ROLES) {
    if (r.whole.includes(name) || r.words.some((w) => all.has(w))) return r.role;
  }
  return null;
}

// The i18n key of the words for an arrow from one box to another, or null when nothing is known. Only parts and free
// boxes have a role: an actor or a service keeps the catalog's own words.
export function linkLabelKey(from, to) {
  const roleOf = (n) => (n && (n.kind === 'part' || n.kind === 'free') ? roleOfPart({ id: String(n.id ?? '').replace(/^(part|free):/, ''), partId: n.partId, name: n.name }) : null);
  const a = roleOf(from);
  const b = roleOf(to);
  if (!a && !b) return null;
  return LINK_RULES.find((r) => (r.from && r.to ? r.from === a && r.to === b : r.to ? r.to === b : r.from === a))?.key ?? null;
}

// ---- the journeys of the Flow (flow.md fl10) ----------------------------------------------------------------------
// The paths a person (or a program) takes through the general view, end to end, found on its arrows with words
// (flowjourneys.mjs). Data only, tried in this order; the first six that match are kept. A matcher is { id } (one box),
// { role } (a part whose roleOfPart is that one) or { label } (a service whose arrow words are flow.l1.lbl.<label>).
// start: tried in order, the first box that reaches the end wins (a journey never starts in the middle of the program).
// via: boxes to pass through in order; an optional one that cannot be reached is skipped. end: tried in order. The
// name's {start}, {via} and {end} are filled with the boxes the path took; `name` is the English fallback.
const J = (key, nameKey, name, start, via, end) => ({ key, nameKey: `flow.j.name.${nameKey}`, name, start, via, end });
const box = (id) => ({ id });
const role = (r, optional = false) => ({ role: r, optional });
const said = (label) => ({ label });
const CLAUDE_SIDE = [box('svc:claude-files'), box('actor:claude-code')];
export const JOURNEYS = [
  J('open-map', 'open', 'You open {end}', [box('actor:browser')], [], [role('page')]),
  J('chat-appears', 'chatAppears', 'A Claude Code conversation shows up in {end}', CLAUDE_SIDE, [role('reader', true), role('state', true)], [role('page')]),
  J('chat-ai', 'chatAi', 'You ask in {via} and the AI answers', [box('actor:browser')], [role('chat')], [said('ai')]),
  J('pay', 'pay', 'A payment goes to {end}', [box('actor:customer'), box('actor:user'), box('actor:browser')], [role('payments', true)], [said('pay')]),
  J('alert-phone', 'alertPhone', 'An alert reaches your phone', CLAUDE_SIDE, [role('alerts')], [box('svc:ntfy'), box('svc:twilio'), box('svc:whatsapp')]),
  J('command', 'command', 'You type a command in the terminal', [box('actor:terminal')], [role('plugin', true)], [role('server'), role('page')]),
  J('alert-screen', 'alertScreen', 'An alert shows on this computer\'s screen', CLAUDE_SIDE, [role('alerts')], [box('svc:toast')]),
  J('open-phone', 'openPhone', 'You open {end} on your phone', [box('actor:lan')], [], [role('page')]),
];
// The journeys added when the catalog finds fewer than three: from a person or a service that sends something in, as
// far as the arrows go.
export const JOURNEY_PATH = { nameKey: 'flow.j.name.path', name: 'From {start} to {end}' };
