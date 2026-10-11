// Mind map exports (mm16): the tree on screen taken out as a Markdown outline, a FreeMind file (.mm) or an XMind file
// (.xmind, a zip). Pure: no DOM, so node:test loads it; the page only saves what these return (saveBlob in flowexport.js).
// A tree here is {id, label, children: [tree]}, the one tree.js builds.

const enc = new TextEncoder();

// One line, one space between words: a label that holds a line break must not break the list or an attribute.
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function mapFileName(projectName, ext) {
  const base = String(projectName ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base ? `${base}-mind-map.${ext}` : `mind-map.${ext}`;
}

// The five characters XML reserves; the control characters XML 1.0 cannot hold at all are dropped, tab and line break are kept as references.
export function escapeXml(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
}

// ---- Markdown outline ---------------------------------------------------------------------------

// Every mark Markdown or HTML could read is written with a backslash, and a label that starts like a list item (1. 2) - +) too.
const mdPlain = (s) => flat(s).replace(/[\\`*_[\]()#~|<>&]/g, (ch) => '\\' + ch).replace(/^(\d+)([.)])/, '$1\\$2').replace(/^[-+]/, (ch) => '\\' + ch);

export function outlineOf(tree) {
  const lines = [];
  const walk = (node, depth) => {
    for (const child of node.children ?? []) {
      lines.push(`${'  '.repeat(depth)}- ${mdPlain(child.label)}`);
      walk(child, depth + 1);
    }
  };
  walk(tree, 0);
  return `# ${mdPlain(tree.label)}\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

// ---- FreeMind ---------------------------------------------------------------------------------

export function freeMindOf(tree) {
  let n = 0;
  const node = (t, pad) => {
    const open = `${pad}<node ID="ID_${++n}" TEXT="${escapeXml(flat(t.label))}"`;
    const kids = t.children ?? [];
    if (!kids.length) return `${open}/>`;
    return `${open}>\n${kids.map((k) => node(k, `${pad}  `)).join('\n')}\n${pad}</node>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1">\n${node(tree, '  ')}\n</map>\n`;
}

// ---- zip, store only ------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{name, data: Uint8Array}] → the bytes of a .zip that keeps each file as it is (no compression). The stamp is
// fixed (1980-01-01), so the same map always gives the same bytes. Names are written as UTF-8 (flag bit 11).
export function zipStore(files) {
  const DOS_DATE = 0x0021;
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // method: store
    local.setUint16(10, 0, true); // time
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true); // made by
    head.setUint16(6, 20, true); // version needed
    head.setUint16(8, 0x0800, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, 0, true);
    head.setUint16(14, DOS_DATE, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, f.data.length, true);
    head.setUint32(24, f.data.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const dirSize = central.reduce((sum, p) => sum + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// ---- XMind ------------------------------------------------------------------------------------

export function xmindFiles(tree) {
  let n = 0;
  const topic = (t) => {
    const out = { id: `topic-${++n}`, class: 'topic', title: flat(t.label) };
    if (t.children?.length) out.children = { attached: t.children.map(topic) };
    return out;
  };
  const rootTopic = topic(tree);
  const json = (value) => ({ data: enc.encode(JSON.stringify(value)) });
  return [
    { name: 'content.json', ...json([{ id: 'sheet-1', class: 'sheet', title: flat(tree.label), rootTopic }]) },
    { name: 'manifest.json', ...json({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }) },
    { name: 'metadata.json', ...json({ creator: { name: 'session-map' } }) },
  ];
}

export const xmindOf = (tree) => zipStore(xmindFiles(tree));
