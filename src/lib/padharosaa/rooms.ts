// "101-110, 201 202, 301A" -> ['101',...,'110','201','202','301A']. Ranges are numeric only and capped, so a typo cannot create thousands.
export function parseRooms(input: string): { rooms: string[]; error: string | null } {
  const out = new Set<string>();
  for (const part of input.toUpperCase().split(/[\s,;]+/).filter(Boolean)) {
    const range = /^(\d{1,4})-(\d{1,4})$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b < a || b - a > 99) return { rooms: [], error: `"${part}" is not a valid range (up to 100 rooms at a time)` };
      for (let i = a; i <= b; i++) out.add(String(i));
    } else if (/^[A-Z0-9][A-Z0-9-]{0,9}$/.test(part)) out.add(part);
    else return { rooms: [], error: `"${part}" is not a valid room number` };
    if (out.size > 100) return { rooms: [], error: 'Add at most 100 rooms at a time' };
  }
  return { rooms: [...out], error: out.size === 0 ? 'Type at least one room number' : null };
}
