// What leaves the PC for an outside AI goes through here first: personal data and secrets become placeholders.
// Claude (the local CLI) keeps receiving the prompt as written; only the helper providers see the masked text.

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
const KNOWN_SECRETS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI, Anthropic, OpenRouter, DeepSeek
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
];
// Unicode letters too: an ASCII-only local part would leave the accented half of a name out (joã[email]).
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
// Unpunctuated CPF (11 digits) and CNPJ (14 digits); 10 and 13 digits are left alone, they are usually timestamps.
const BARE_ID = /\b(?:\d{11}|\d{14})\b/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const PHONES = [
  /(?:\+?\b55[\s.-]?)?(?:\(\d{2}\)|\b\d{2})[\s.-]?9[\s.-]\d{4}[\s.-]?\d{4}\b/g, // (11) 9 8765-4321: the mobile 9 apart
  /\b55[\s.-]?\(?[1-9]{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g, // 55 11 987654321, 5511987654321 (wa.me links)
  /\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{4}\b/g, // +55 11 98765-4321, +1 415 555 0100
  /\(\d{2,3}\)\s?\d{4,5}[\s.-]?\d{4}\b/g, // (11) 98765-4321
  /\b\d{2,3}[\s.-]\d{4,5}[\s.-]\d{4}\b/g, // 11 98765 4321
  /\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/g, // 415-555-0100
  /\b9\d{4}-\d{4}\b/g, // 98765-4321
];
// A bare 10-digit number is usually a timestamp, unless a word just before says it is a phone.
const PHONE_WORD = /\b(tel|telefone|fone|cel|celular|whatsapp|wpp|zap|phone)(\W{0,3})\d{10}\b/gi;
const LONG_HEX =/\b[0-9a-f]{32,}\b/gi;
const LONG_RUN = /[A-Za-z0-9+/=_-]{32,}/g;

// The card checksum keeps ordinary long numbers (ids, timestamps) out of the mask.
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const count = (text, re) => (text.match(re) ?? []).length;
// A base64 secret mixes digits, capitals and small letters in one long piece; a file path is short pieces split by "/".
const looksRandom = (run) => run.split('/').some((seg) => seg.length >= 32 && count(seg, /\d/g) >= 3 && count(seg, /[A-Z]/g) >= 3 && count(seg, /[a-z]/g) >= 3);

// The digest arrives JSON-quoted, so a line break inside a prompt is the two characters \n: the n glues to what
// follows and hides it from every \b. A marker after each escape keeps the boundary; it is gone before returning.
const MARK = '\u0000';
const ESCAPE = /\\[nrtbf]/g;

export function redact(text) {
  let out = String(text ?? '').replaceAll(MARK, '').replace(ESCAPE, (m) => m + MARK);
  out = out.replace(PRIVATE_KEY, '[secret]');
  out = out.replace(URL_CREDENTIALS, '$1[credentials]@');
  out = out.replace(BEARER, 'Bearer [secret]');
  for (const re of KNOWN_SECRETS) out = out.replace(re, '[secret]');
  out = out.replace(EMAIL, '[email]');
  out = out.replace(CNPJ, '[cnpj]').replace(CPF, '[cpf]').replace(BARE_ID, '[id]');
  out = out.replace(CARD, (m) => (luhn(m.replace(/\D/g, '')) ? '[card]' : m));
  for (const re of PHONES) out = out.replace(re, '[phone]');
  out = out.replace(LONG_HEX, '[secret]');
  out = out.replace(PHONE_WORD, '$1$2[phone]');
  out = out.replace(LONG_RUN, (m) => (looksRandom(m) ? '[secret]' : m));
  return out.replaceAll(MARK, '');
}
