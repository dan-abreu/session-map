// Fluid Flow (fl05, fl06): what the Flow tab says about a map with no diagram of its own, and the three ways to take the
// drawing out of the page: SVG and PNG of what is on screen, Markdown with the mermaid block. The pure helpers come first
// (what node:test loads); the DOM ones below only run in the page.

const PNG_SCALE = 2;
const PNG_SIDE_MAX = 8192;

// A map with parts whose README has no diagram: the page shows the one session-map drew from the layers and relations.
export const isAutoDraft = (arch) => arch.source !== 'none' && !arch.mermaid && arch.parts.length > 0;

export function exportFileName(projectName, ext) {
  const base = String(projectName ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base ? `${base}-flow.${ext}` : `flow.${ext}`;
}

// The README's own fence is the only thing that may close the block, so a ``` inside the drawing is written as mermaid draws it.
export function markdownOf(projectName, text, flowWord) {
  return `# ${projectName} · ${flowWord}\n\n\`\`\`mermaid\n${text.replace(/```/g, '#96;#96;#96;')}\n\`\`\`\n`;
}

export function pngSize(width, height) {
  const w = Math.max(1, Number(width) || 0), h = Math.max(1, Number(height) || 0);
  const scale = Math.min(PNG_SCALE, PNG_SIDE_MAX / w, PNG_SIDE_MAX / h);
  return { width: Math.max(2, Math.round(w * scale)), height: Math.max(2, Math.round(h * scale)), scale: PNG_SCALE };
}

// A stand-alone .svg from the markup of the drawing on screen: its own size instead of "fill the area", the namespace a
// file needs, and a background so it reads on a white page or a dark one.
export function svgDocument(markup, { width, height, background }) {
  const open = /^<svg\b([^>]*)>/.exec(markup);
  if (!open) return markup;
  const attrs = open[1].replace(/\s(?:width|height|style|xmlns|tabindex|role)="[^"]*"/g, '');
  const body = markup.slice(open[0].length);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${attrs} width="${Math.round(width)}" height="${Math.round(height)}"><rect width="100%" height="100%" fill="${background}"/>${body}`;
}

// ---- in the page only ------------------------------------------------------------------------

// What the page's own stylesheet paints on the drawing (the colour of each part, the flags) is not inside the svg, so a
// copy taken out of the page would lose it: each element carries its computed look as inline style.
const LOOK = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'];
const SHAPES = 'rect, path, polygon, polyline, circle, ellipse, line, text, tspan';

export function standaloneSvg(live, background) {
  const box = live.viewBox.baseVal;
  const copy = live.cloneNode(true);
  const from = live.querySelectorAll(SHAPES);
  const to = copy.querySelectorAll(SHAPES);
  from.forEach((el, i) => {
    const css = getComputedStyle(el);
    to[i].setAttribute('style', LOOK.map((p) => `${p}:${css.getPropertyValue(p)}`).join(';'));
  });
  for (const el of copy.querySelectorAll('[tabindex], [role], [aria-pressed]')) {
    for (const a of ['tabindex', 'role', 'aria-pressed']) el.removeAttribute(a);
  }
  return { markup: svgDocument(copy.outerHTML, { width: box.width, height: box.height, background }), width: box.width, height: box.height };
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A data: address, not a blob one, so the canvas is not marked as tainted by what it drew.
export function svgToPng(markup, width, height) {
  const size = pngSize(width, height);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext('2d').drawImage(img, 0, 0, size.width, size.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png-failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('png-failed'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}
