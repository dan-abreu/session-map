// A health context in memory for the checks of B4-T3..T11: `files` is { path: text }, everything else has a sensible
// default. It is the real `makeHealthCtx` underneath, so a check sees the same read/find/has rules as in production
// (secret files unreadable, 200 KB limit, packages and kinds worked out from the files).
//
//   fakeHealthCtx({ files: { 'README.md': '# x' } })
//   fakeHealthCtx({ kinds: ['library'], visibility: 'private', api: { mode: 'none' } })
//
// Overrides: kinds (array), visibility ('public'|'private'|'unknown'), visibilitySource, hasCode, isMonorepo, packages.
import { isSecretsFile } from '../../server/files.mjs';
import { kindOfFile } from '../../server/sources/count.mjs';
import { typeOf } from '../../server/foundation/census.mjs';
import { makeHealthCtx } from '../../server/foundation/health-ctx.mjs';

const EMPTY_GIT = { remote: null, tags: [], subjects: [], defaultBranch: 'main' };

export function fakeHealthCtx({ files = {}, git = {}, configVisibility = null, api = null, versions = null, profile = null, now = '2026-10-10T12:00:00.000Z', ...over } = {}) {
  const rows = Object.keys(files).map((path) => {
    const secret = isSecretsFile(path);
    return { path, type: typeOf(path), kind: secret ? 'secret' : kindOfFile(path), included: !secret, bytes: Buffer.byteLength(String(files[path])) };
  });
  const ctx = makeHealthCtx({
    rows, readText: (p) => (Object.hasOwn(files, p) ? String(files[p]) : null),
    git: { ...EMPTY_GIT, ...git }, configVisibility, api, versions, profile, now,
  });
  if (over.kinds) ctx.kinds = new Set(over.kinds);
  if (over.visibility) {
    ctx.visibility = over.visibility;
    ctx.visibilitySource = over.visibilitySource ?? 'config';
  }
  if (over.packages) ctx.packages = over.packages;
  if (over.isMonorepo !== undefined) ctx.isMonorepo = over.isMonorepo;
  ctx.hasCode = over.hasCode ?? ctx.kinds.has('code');
  return ctx;
}
