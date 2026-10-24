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

/** Splits CSV text into rows of cells. Cells may be wrapped in "double quotes" (so a comma or a new line can sit inside); "" is a quote. */
function splitCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  const end = () => { row.push(cell.trim()); cell = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') end();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; end(); if (row.some((c) => c)) out.push(row); row = []; }
    else cell += ch;
  }
  end(); if (row.some((c) => c)) out.push(row);
  return out;
}

const GUIDE_CATS: Record<string, 'place' | 'food' | 'craft' | 'tip'> = { place: 'place', places: 'place', sight: 'place', visit: 'place', food: 'food', eat: 'food', restaurant: 'food', craft: 'craft', shopping: 'craft', shop: 'craft', tip: 'tip', tips: 'tip' };
export interface GuideCsvRow { category: 'place' | 'food' | 'craft' | 'tip'; name: string; description_en: string | null; best_time: string | null; address: string | null; maps_query: string | null; link_url: string | null; lat: number | null; lng: number | null }

/**
 * name, type, description, best_time, address, maps_query, website, lat, lng   (header row optional; only name is required).
 * type is place, food, craft or tip (anything else means place). lat and lng must come together. A website is added as https if the scheme is missing.
 */
export function parseGuideCsv(text: string): { rows: GuideCsvRow[]; bad: number } {
  const rows: GuideCsvRow[] = []; let bad = 0;
  for (const c of splitCsv(text.replace(/^﻿/, ''))) {
    if (/^(place|name)s?$/i.test(c[0] ?? '') && /^(type|category)?$/i.test(c[1] ?? '')) continue; // header row
    const name = (c[0] ?? '').slice(0, 100);
    const cat = GUIDE_CATS[(c[1] ?? '').toLowerCase()] ?? 'place';
    const lat = c[7] ? Number(c[7]) : null, lng = c[8] ? Number(c[8]) : null;
    const site = (c[6] ?? '').trim();
    const link = site ? (/^https:\/\//i.test(site) ? site : /^http:\/\//i.test(site) ? `https://${site.slice(7)}` : `https://${site}`) : null;
    if (!name || (lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))) { bad++; continue; }
    rows.push({ category: cat, name, description_en: c[2]?.slice(0, 600) || null, best_time: c[3]?.slice(0, 100) || null, address: c[4]?.slice(0, 200) || null, maps_query: c[5]?.slice(0, 200) || null, link_url: link && link.length <= 500 ? link : null, lat, lng });
  }
  return { rows, bad };
}

export const GUIDE_CSV_SAMPLE = 'name,type,description,best_time,address,maps_query,website,lat,lng\nAmer Fort,place,"Hilltop fort with palaces, mirror hall and elephant-free jeep rides",Early morning,Amer,Amer Fort Jaipur,,,\nLaxmi Misthan Bhandar,food,Famous for ghewar and pyaaz kachori,Evening,Johari Bazaar,,lmbmisthanbhandar.com,26.9168,75.8276\n';
