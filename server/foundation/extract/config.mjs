// Config reader: variable NAMES from .env.example files and turbo.json. Values are never read into the output.
import { isSecretsFile } from '../../files.mjs';

export const VERSION = 'config@1';
// .env.example has no extension in the census ('other'); turbo.json is 'json'. The file name decides.
export const TYPES = ['json', 'other'];

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const TURBO_KEY_RE = /"(env|globalEnv|globalPassThroughEnv)"\s*:\s*\[/g;
const STRING_RE = /"((?:[^"\\]|\\.)*)"/g;

const baseOf = (path) => String(path).replaceAll('\\', '/').split('/').pop();
const isExample = (base) => /^\.env(\..+)?\.example$/i.test(base);

function add(out, path, name, line, source) {
  const id = `env:${name}`;
  const seen = out.find((f) => f.id === id);
  if (seen) { seen.refs.push({ file: path, line }); return; }
  out.push({ id, kind: 'env', name, file: path, line, origin: 'EXTRACTED', extractor: VERSION, attrs: { source }, refs: [] });
}

function fromExample(path, text) {
  const out = [];
  text.split('\n').forEach((l, i) => {
    const m = ENV_LINE_RE.exec(l);
    if (m) add(out, path, m[1], i + 1, 'example');
  });
  return out;
}

function fromTurbo(path, text) {
  try { JSON.parse(text); } catch { return []; }
  const out = [];
  const lineAt = (o) => text.slice(0, o).split('\n').length;
  const found = [];
  for (const k of text.matchAll(TURBO_KEY_RE)) {
    const start = k.index + k[0].length;
    const end = text.indexOf(']', start);
    for (const s of text.slice(start, end).matchAll(STRING_RE)) {
      if (NAME_RE.test(s[1])) found.push({ name: s[1], at: start + s.index });
    }
  }
  found.sort((a, b) => a.at - b.at).forEach((f) => add(out, path, f.name, lineAt(f.at), 'turbo'));
  return out;
}

export function extract({ path, text }) {
  const base = baseOf(path);
  if (isSecretsFile(path)) return { facts: [], hints: [] };
  if (isExample(base)) return { facts: fromExample(path, String(text)), hints: [] };
  if (base === 'turbo.json') return { facts: fromTurbo(path, String(text)), hints: [] };
  return { facts: [], hints: [] };
}
