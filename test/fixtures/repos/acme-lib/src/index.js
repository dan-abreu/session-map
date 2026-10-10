/*
 * Slug helpers.
 * export function ghostHelper() {} was removed in 1.0.
 */
const NOTE = `export function ghostTemplate() {} // ${'not a comment'}`;

function normalize(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function slugify(title) {
  return normalize(title);
}

export function truncate(text, max = 40) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export const isSlug = (value) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
