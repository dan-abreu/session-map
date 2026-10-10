// The manifest of the README screenshots (docs/images/shots.json): which version and which day they were taken, and the
// hash of every image, so a retouched or stale picture is caught by the release gate. Pure: files come in through readImage.
import { createHash } from 'node:crypto';

export const MANIFEST_TOOL = 'scripts/readme-shots.mjs';
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');

// images: { 'en-map.webp': { sha, width, height, lang } }. Sorted by name so the file diffs cleanly.
export function buildManifest({ version, date, images }) {
  if (!VERSION_RE.test(String(version))) throw new Error(`manifest version "${version}" is not a version`);
  if (!DAY_RE.test(String(date))) throw new Error(`manifest date "${date}" is not a YYYY-MM-DD day`);
  const sorted = {};
  for (const name of Object.keys(images).sort()) {
    const { sha, width, height, lang } = images[name];
    sorted[name] = { sha, width, height, lang };
  }
  return { version, date, tool: MANIFEST_TOOL, images: sorted };
}

const isManifest = (m) => Boolean(m) && typeof m === 'object' && typeof m.version === 'string' && typeof m.date === 'string'
  && Boolean(m.images) && typeof m.images === 'object' && !Array.isArray(m.images);

// -> [{ code, image?, expected?, found? }]; empty means the pictures are the ones the manifest vouches for.
// readImage(name) returns the bytes or null. The day only matters when publishing (publish: true).
export function verifyManifest(manifest, { version, today, readImage, publish = false }) {
  if (!isManifest(manifest)) return [{ code: 'manifest-invalid' }];
  const out = [];
  if (manifest.version !== version) out.push({ code: 'version-differs', expected: version, found: manifest.version });
  if (publish && manifest.date !== today) out.push({ code: 'date-not-today', expected: today, found: manifest.date });
  for (const [name, entry] of Object.entries(manifest.images)) {
    const bytes = readImage(name);
    if (!bytes) out.push({ code: 'image-missing', image: name });
    else if (sha256Of(bytes) !== entry?.sha) out.push({ code: 'sha-differs', image: name, expected: entry?.sha, found: sha256Of(bytes) });
  }
  return out;
}

// Width and height from a WebP header (lossy, lossless or extended), or null if it is not a WebP.
export function webpSize(buf) {
  if (buf.length < 25 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L' && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X' && buf.length >= 30) return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  return null;
}
