/** Room service: parsing the owner's room list and cleaning the room number a guest types. */
export const ROOM_PATTERN = /^[A-Z0-9][A-Z0-9 -]{0,9}$/;
export const MAX_ROOMS = 300;
/** Ranges like 101-110 are numbers only and at most this long, so a typo cannot create thousands of rooms. */
const MAX_RANGE = 200;

/** The room as the database stores it: upper case, single spaces. Returns '' when it is not a plausible room number. */
export function normalizeRoom(input: string): string {
  const v = input.replace(/\s+/g, ' ').trim().toUpperCase();
  return ROOM_PATTERN.test(v) ? v : '';
}

export type ParsedRooms = { ok: true; rooms: string[] } | { ok: false; error: string };

/**
 * "101-110, 201, 202\nSUITE 1" becomes ["101", ..., "110", "201", "202", "SUITE 1"].
 * Separators are commas, semicolons and new lines. An empty text means "accept any room number".
 */
export function parseRooms(text: string): ParsedRooms {
  const out = new Set<string>();
  for (const raw of text.split(/[,;\n]/)) {
    const part = raw.trim();
    if (!part) continue;
    const range = /^(\d{1,6})\s*-\s*(\d{1,6})$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || to - from >= MAX_RANGE) return { ok: false, error: `"${part}" is not a valid range (up to ${MAX_RANGE} rooms, smallest number first).` };
      for (let n = from; n <= to; n++) out.add(String(n));
    } else {
      const room = normalizeRoom(part);
      if (!room) return { ok: false, error: `"${part}" is not a valid room number (letters, digits, space or hyphen, up to 10 characters).` };
      out.add(room);
    }
    if (out.size > MAX_ROOMS) return { ok: false, error: `Up to ${MAX_ROOMS} rooms can be listed.` };
  }
  return { ok: true, rooms: [...out] };
}

/** A staff-facing name: rooms are already stored as "Room 204", tables as just "5". */
export const tableName = (label: string): string => (/^room\b/i.test(label) ? label : `Table ${label}`);
