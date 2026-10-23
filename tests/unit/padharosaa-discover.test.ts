import { describe, expect, it, vi } from 'vitest';
import { cleanAiText, describeWithAi, discoverNearby, haversineMeters, mapsDirectionsUrl, overpassQuery, parseOverpass } from '@/lib/padharosaa/discover';

const hotel = { lat: 26.9124, lng: 75.7873 };

describe('distance and links', () => {
  it('haversine gives a sensible distance', () => {
    const d = haversineMeters(hotel, { lat: 26.9255, lng: 75.8236 });
    expect(d).toBeGreaterThan(3500); expect(d).toBeLessThan(4500);
    expect(haversineMeters(hotel, hotel)).toBe(0);
  });
  it('directions use coordinates when known, else the name, and are always a google maps https link', () => {
    const a = new URL(mapsDirectionsUrl(hotel, { lat: 26.9855, lng: 75.8513 })!);
    expect(a.origin + a.pathname).toBe('https://www.google.com/maps/dir/');
    expect(a.searchParams.get('origin')).toBe('26.9124,75.7873');
    expect(a.searchParams.get('destination')).toBe('26.9855,75.8513');
    expect(new URL(mapsDirectionsUrl(null, { query: 'Hawa Mahal Jaipur' })!).searchParams.get('destination')).toBe('Hawa Mahal Jaipur');
    expect(mapsDirectionsUrl(hotel, {})).toBeNull();
  });
});

describe('overpass', () => {
  it('builds a bounded query around the hotel', () => {
    const q = overpassQuery(26.9124, 75.7873, 3000);
    expect(q).toContain('(around:3000,26.912400,75.787300)');
    expect(q).toContain('out center tags');
  });
  it('keeps named places, classifies them, drops duplicates, sorts nearest first and caps each category', () => {
    const els = [
      { type: 'node', id: 1, lat: 26.9855, lon: 75.8513, tags: { name: 'Amer Fort', historic: 'fort' } },
      { type: 'way', id: 2, center: { lat: 26.9255, lon: 75.8236 }, tags: { 'name:en': 'City Palace', name: 'सिटी पैलेस', tourism: 'attraction' } },
      { type: 'node', id: 3, lat: 26.9130, lon: 75.7880, tags: { name: 'Lassi Corner', amenity: 'cafe', cuisine: 'indian;beverages' } },
      { type: 'node', id: 4, lat: 26.9131, lon: 75.7881, tags: { name: 'lassi corner', amenity: 'cafe' } },
      { type: 'node', id: 5, lat: 26.9140, lon: 75.7890, tags: { name: 'Blue Pottery House', shop: 'craft' } },
      { type: 'node', id: 6, lat: 26.9, lon: 75.8, tags: { amenity: 'restaurant' } },
      { type: 'node', id: 7, lat: 26.9, lon: 75.8, tags: { name: 'Bus stop', highway: 'bus_stop' } },
    ];
    const out = parseOverpass({ elements: els }, hotel);
    expect(out.map((c) => c.name)).toEqual(['Lassi Corner', 'Blue Pottery House', 'City Palace', 'Amer Fort']);
    expect(out[0]).toMatchObject({ category: 'food', kind: 'cafe, indian, beverages' });
    expect(out.find((c) => c.name === 'City Palace')!.category).toBe('place');
    const many = Array.from({ length: 40 }, (_, i) => ({ type: 'node', id: 100 + i, lat: 26.92 + i / 1000, lon: 75.79, tags: { name: `Spot ${i}`, tourism: 'attraction' } }));
    expect(parseOverpass({ elements: many }, hotel)).toHaveLength(15);
    expect(parseOverpass(null, hotel)).toEqual([]);
    expect(parseOverpass({ elements: 'x' }, hotel)).toEqual([]);
  });
  it('tries the next mirror when one fails and gives up cleanly when all fail', async () => {
    const ok = { elements: [{ type: 'node', id: 1, lat: 26.99, lon: 75.85, tags: { name: 'Amer Fort', historic: 'fort' } }] };
    const f = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 429 })).mockResolvedValueOnce(new Response(JSON.stringify(ok), { status: 200 }));
    expect((await discoverNearby(hotel, 3000, f as unknown as typeof fetch))!.map((c) => c.name)).toEqual(['Amer Fort']);
    const bad = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await discoverNearby(hotel, 3000, bad as unknown as typeof fetch)).toBeNull();
  });
});

describe('AI wording is cautious', () => {
  it('drops sentences with prices, times, ratings or links and trims control characters', () => {
    expect(cleanAiText('A hilltop fort above Jaipur. Entry costs ₹200. Open from 9 am daily. See www.example.com.')).toBe('A hilltop fort above Jaipur.');
    expect(cleanAiText('Nice‮ place.\u0007 It is rated 4.5 stars.')).toBe('Nice place.');
    expect(cleanAiText(undefined)).toBe('');
    expect(cleanAiText('x'.repeat(500)).length).toBe(280);
  });
  const cfg = { baseUrl: 'https://api.example.com/v1/', apiKey: 'k', model: 'm' };
  it('maps the model answer back to the right places, ignores unknown numbers, and returns null on any failure', async () => {
    const content = 'Sure! [{"n":2,"en":"A craft shop. Prices start at ₹500.","hi":"हस्तशिल्प की दुकान।"},{"n":9,"en":"ghost","hi":"x"},{"n":1,"en":"A fort.","hi":"किला।"}]';
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
    const out = await describeWithAi(cfg, [{ name: 'Amer Fort', category: 'place' }, { name: 'Pottery', category: 'craft' }], f as unknown as typeof fetch);
    expect(out).toEqual([{ name: 'Pottery', en: 'A craft shop.', hi: 'हस्तशिल्प की दुकान।' }, { name: 'Amer Fort', en: 'A fort.', hi: 'किला।' }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(await describeWithAi(cfg, [{ name: 'A', category: 'place' }], vi.fn().mockResolvedValue(new Response('no', { status: 500 })) as unknown as typeof fetch)).toBeNull();
    expect(await describeWithAi(cfg, [{ name: 'A', category: 'place' }], vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }))) as unknown as typeof fetch)).toBeNull();
    expect(await describeWithAi(cfg, [], vi.fn() as unknown as typeof fetch)).toEqual([]);
  });
});
