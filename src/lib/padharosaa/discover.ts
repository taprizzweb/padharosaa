/**
 * Find real places near the hotel from OpenStreetMap (free, no key) and, if an AI service is configured, draft a short description.
 * Everything that comes out of here is a DRAFT: it never reaches guests until the manager reads it and publishes it.
 */

export type GuideCategory = 'place' | 'food' | 'craft';
export interface Candidate { category: GuideCategory; name: string; lat: number; lng: number; address: string | null; kind: string; distance_m: number; osm: string }

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(x))));
}

export function overpassQuery(lat: number, lng: number, radius: number): string {
  const around = `(around:${Math.round(radius)},${lat.toFixed(6)},${lng.toFixed(6)})`;
  return `[out:json][timeout:25];(
nwr["tourism"~"^(attraction|museum|viewpoint|gallery|zoo|theme_park)$"]["name"]${around};
nwr["historic"~"^(fort|castle|palace|monument|memorial|ruins|archaeological_site|temple|city_gate)$"]["name"]${around};
nwr["amenity"~"^(restaurant|cafe|food_court)$"]["name"]${around};
nwr["shop"~"^(craft|handicraft|jewelry|art|gift|antiques|fabric|clothes)$"]["name"]${around};
);out center tags 400;`;
}

interface OsmEl { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

const SKIP_NAME = /^\s*$/;
function classify(t: Record<string, string>): { category: GuideCategory; kind: string } | null {
  if (t.tourism && /^(attraction|museum|viewpoint|gallery|zoo|theme_park)$/.test(t.tourism)) return { category: 'place', kind: t.tourism };
  if (t.historic) return { category: 'place', kind: t.historic };
  if (t.amenity && /^(restaurant|cafe|food_court)$/.test(t.amenity)) return { category: 'food', kind: t.cuisine ? `${t.amenity}, ${t.cuisine.replace(/;/g, ', ')}` : t.amenity };
  if (t.shop) return { category: 'craft', kind: t.shop };
  return null;
}

/** Turns an Overpass answer into a short, de-duplicated, nearest-first list: at most `perCategory` of each kind. */
export function parseOverpass(json: unknown, origin: { lat: number; lng: number }, perCategory = 15): Candidate[] {
  const els = (json as { elements?: OsmEl[] } | null)?.elements;
  if (!Array.isArray(els)) return [];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    const name = (t['name:en'] ?? t.name ?? '').replace(/^[\s:;,.\-–—|]+/, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const c = classify(t);
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!c || SKIP_NAME.test(name) || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const key = `${c.category}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const addr = [t['addr:housename'], t['addr:street'], t['addr:suburb'], t['addr:city']].filter(Boolean).join(', ').slice(0, 200) || null;
    out.push({ category: c.category, name, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, address: addr, kind: c.kind, distance_m: haversineMeters(origin, { lat, lng }), osm: `${e.type}/${e.id}` });
  }
  out.sort((a, b) => a.distance_m - b.distance_m);
  const count: Record<string, number> = {};
  return out.filter((c) => (count[c.category] = (count[c.category] ?? 0) + 1) <= perCategory);
}

export async function discoverNearby(origin: { lat: number; lng: number }, radius: number, fetchImpl: typeof fetch = fetch): Promise<Candidate[] | null> {
  const body = new URLSearchParams({ data: overpassQuery(origin.lat, origin.lng, radius) });
  for (const url of OVERPASS) {
    try {
      const res = await fetchImpl(url, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Padharosaa/1.0 (hotel guide; contact via taprizz.in)' }, signal: AbortSignal.timeout(28000) });
      if (!res.ok) continue;
      return parseOverpass(await res.json(), origin);
    } catch { /* try the next mirror */ }
  }
  return null;
}

// ---------------------------------------------------------------- AI wording (optional)
export interface AiConfig { baseUrl: string; apiKey: string; model: string }
export interface DraftInput { name: string; category: string; kind?: string; address?: string | null }
export interface Draft { name: string; en: string; hi: string }

/** Anything that sounds like a concrete claim we cannot check (prices, hours, ratings, links) is dropped from AI text. */
const RISKY = /(₹|\brs\.?\s*\d|\binr\b|\d\s*(am|pm)\b|\b\d{1,2}[:.]\d{2}\b|https?:\/\/|www\.|\bopen(s|ing)?\s+(from|at|daily|until)\b|\brated\b|\bstars?\b|\bfree entry\b|\bticket\b)/i;
export function cleanAiText(s: unknown, max = 280): string {
  if (typeof s !== 'string') return '';
  const sentences = s.replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().split(/(?<=[.!?।])\s+/);
  const kept = sentences.filter((x) => x && !RISKY.test(x));
  return kept.join(' ').slice(0, max).trim();
}

export async function describeWithAi(cfg: AiConfig, items: DraftInput[], fetchImpl: typeof fetch = fetch): Promise<Draft[] | null> {
  if (items.length === 0) return [];
  const list = items.map((i, n) => `${n + 1}. ${i.name} (${i.category}${i.kind ? `, ${i.kind}` : ''}${i.address ? `, ${i.address}` : ''})`).join('\n');
  const prompt = `You help a hotel in Jaipur, India write a short guide for guests. For each numbered place write TWO neutral sentences in English and the same in Hindi (Devanagari). ` +
    `Use only the name, type and address given plus well-known general knowledge about what such a place is. Do NOT mention prices, opening hours, ticket costs, ratings, distances, dates or links, and do not invent details. ` +
    `If you do not know the place, describe only its type in general terms.\nReturn ONLY a JSON array like [{"n":1,"en":"...","hi":"..."}].\n\n${list}`;
  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, temperature: 0.2, messages: [{ role: 'system', content: 'You write careful, factual travel copy. You never invent facts.' }, { role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content ?? '';
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]) as { n?: number; en?: string; hi?: string }[];
    const out: Draft[] = [];
    for (const a of arr) {
      const item = items[(a.n ?? 0) - 1];
      if (!item) continue;
      out.push({ name: item.name, en: cleanAiText(a.en), hi: cleanAiText(a.hi) });
    }
    return out;
  } catch {
    return null;
  }
}

export const mapsDirectionsUrl = (from: { lat: number; lng: number } | null, to: { lat?: number | null; lng?: number | null; query?: string | null }): string | null => {
  const dest = typeof to.lat === 'number' && typeof to.lng === 'number' ? `${to.lat},${to.lng}` : to.query ? to.query : null;
  if (!dest) return null;
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  if (from) u.searchParams.set('origin', `${from.lat},${from.lng}`);
  u.searchParams.set('destination', dest);
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
};
