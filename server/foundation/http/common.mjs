// Shared by the dispatcher and the route files of each block (kept apart from index.mjs so the route files never import it).

export class FdHttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

// A route answers an error by throwing: fail(409, 'no-draft') -> 409 { ok: false, error: 'no-draft' }.
export function fail(status, code) {
  throw new FdHttpError(status, code);
}

// A file or folder named in a query (?folder=, ?file=): relative to the project root, with / only, never climbing out.
export function pathParam(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text.includes('\\') || text.startsWith('/') || /^[a-z]:/i.test(text) || text.split('/').includes('..')) fail(400, 'bad-path');
  return text;
}
