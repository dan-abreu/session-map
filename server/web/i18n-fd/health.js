// Screen texts of block B4 (health and versions), merged into the dictionaries by i18n.js.
// Each part lives in its own file so parallel tasks never edit the same one. Same keys in en and pt-BR; an optional
// `tech` field ({ en, 'pt-BR' }) holds the technical originals.
import ui from './health-ui.js';
import items1 from './health-items-1.js';
import items2 from './health-items-2.js';
import versions from './versions-ui.js';

const PARTS = [ui, items1, items2, versions];
const merge = (lang) => Object.assign({}, ...PARTS.map((p) => p[lang] ?? {}));
const mergeTech = (lang) => Object.assign({}, ...PARTS.map((p) => p.tech?.[lang] ?? {}));

export default { en: merge('en'), 'pt-BR': merge('pt-BR'), tech: { en: mergeTech('en'), 'pt-BR': mergeTech('pt-BR') } };
