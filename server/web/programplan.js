// The floor plan of the page (id160, mm66): what the "The program" level draws, worked out apart from the drawing so it
// can be proved. A room is an area, a dashed box in it is a section, a colored block is a button, a grey line is a text.
// The census gives the rooms, sections and pieces; this decides how big each room is on the plan and how wide each block.

const BLOCK_MIN = 22;
const BLOCK_MAX = 92;
const LINES_MAX = 4;
const UNNAMED_MAX = 12;

// A block is as wide as the word on it would be, so a long button looks long and a short one short.
export const blockWidth = (text) => Math.max(BLOCK_MIN, Math.min(BLOCK_MAX, Math.round(String(text ?? '').length * 4.4) + 12));

// How many of the twelve columns of the plan a room takes: the more boxes it holds, the wider it is.
export const spanOf = (panels) => (panels <= 3 ? 4 : panels <= 8 ? 6 : panels <= 16 ? 8 : 12);

// rooms: the rooms the view works out from the census (programview.js). query: what the person is looking for, so a block can say it is the one.
export function planOf(rooms, query = '') {
  const q = query.trim().toLowerCase();
  const says = (text) => q !== '' && String(text).toLowerCase().includes(q);
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    span: spanOf(room.sections.length),
    building: room.sections.length === 0,
    counts: room.counts,
    unnamed: Math.min(room.counts?.unnamed ?? 0, UNNAMED_MAX),
    unnamedAll: room.counts?.unnamed ?? 0,
    panels: room.sections.map((s) => ({
      title: s.title,
      file: s.file,
      blocks: s.parts.map((p) => ({ type: p.type, text: p.text, width: blockWidth(p.text), hit: says(p.text) })),
      lines: Math.min(s.texts.length, LINES_MAX),
      texts: s.texts.length,
      hitText: s.texts.some((x) => says(x.text)),
      messages: s.messages.length,
    })),
  }));
}
