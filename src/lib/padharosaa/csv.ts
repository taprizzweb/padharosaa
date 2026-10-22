const TEAM_KEYS = ['concierge', 'front_desk', 'housekeeping', 'kitchen', 'maintenance', 'manager'];

/** name,email,department,whatsapp,head  (header row optional). Quotes are not needed; commas inside names are not supported. */
export function parseStaffCsv(text: string): { rows: Record<string, unknown>[]; bad: number } {
  const rows: Record<string, unknown>[] = []; let bad = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const c = line.split(',').map((x) => x.trim());
    if (/^name$/i.test(c[0] ?? '')) continue;
    const dep = (c[2] ?? '').toLowerCase().replace(/[\s-]+/g, '_').replace(/^reception$|^front_?desk$/, 'front_desk');
    if (!c[0] || !c[1] || !TEAM_KEYS.includes(dep)) { bad++; continue; }
    rows.push({ name: c[0], email: c[1], department: dep, whatsapp: c[3] || null, is_head: /^(y|yes|true|1|head)$/i.test(c[4] ?? '') });
  }
  return { rows, bad };
}
