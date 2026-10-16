// Screen texts of block B6 (navigation, Home, Health, guide), merged into the dictionaries by i18n.js.
// Each part lives in its own file so parallel tasks never edit the same one. Same keys in en and pt-BR; an optional
// `tech` field ({ en, 'pt-BR' }) holds the technical originals.
import nav from './screens-nav.js';
import home from './screens-home.js';
import saude from './screens-saude.js';
import guide from './screens-guide.js';
import statement from './screens-statement.js';
import logs from './screens-logs.js';

const PARTS = [nav, home, saude, guide, statement, logs];
const merge = (lang) => Object.assign({}, ...PARTS.map((p) => p[lang] ?? {}));

const mergeTech = (lang) => Object.assign({}, ...PARTS.map((p) => p.tech?.[lang] ?? {}));

export default { en: merge('en'), 'pt-BR': merge('pt-BR'), tech: { en: mergeTech('en'), 'pt-BR': mergeTech('pt-BR') } };
