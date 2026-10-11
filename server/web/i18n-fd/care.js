// Screen texts of block B3 (up to date, findings, care mode), merged into the dictionaries by i18n.js.
// Each part lives in its own file so parallel tasks never edit the same one. Same keys in en and pt-BR; an optional
// `tech` field ({ en, 'pt-BR' }) holds the technical originals.
import uptodate from './care-uptodate.js';
import findings from './care-findings.js';
import mode from './care-mode.js';

const PARTS = [uptodate, findings, mode];
const merge = (lang) => Object.assign({}, ...PARTS.map((p) => p[lang] ?? {}));
const mergeTech = (lang) => Object.assign({}, ...PARTS.map((p) => p.tech?.[lang] ?? {}));

export default { en: merge('en'), 'pt-BR': merge('pt-BR'), tech: { en: mergeTech('en'), 'pt-BR': mergeTech('pt-BR') } };
