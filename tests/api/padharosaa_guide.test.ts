import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, type World } from '../../supabase/tests/helpers/fixtures';
import { APP, authState, state } from './helpers';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
vi.mock('@/lib/supabase/server', async () => {
  const h = await import('./helpers');
  return { userClient: async () => h.fakeUserClient };
});
import { POST as loginPOST } from '@/app/api/padharosaa/v1/hotels/[slug]/sessions/route';
import { GET as guideGET } from '@/app/api/padharosaa/v1/guide/route';
import { GET as planGET } from '@/app/api/padharosaa/v1/plan/route';
import { POST as planPOST } from '@/app/api/padharosaa/v1/plan/[action]/route';
import { GET as buffetGET } from '@/app/api/padharosaa/v1/buffet/route';
import { POST as reqActionPOST } from '@/app/api/padharosaa/v1/requests/[id]/[action]/route';
import { POST as createPOST } from '@/app/api/padharosaa/v1/requests/route';
import { POST as staffReqPOST } from '@/app/api/padharosaa/v1/staff/requests/[id]/[action]/route';
import { GET as mGuideGET } from '@/app/api/padharosaa/v1/staff/guide/route';
import { POST as mGuidePOST } from '@/app/api/padharosaa/v1/staff/guide/[action]/route';
import { GET as mBuffetGET, POST as mBuffetPOST } from '@/app/api/padharosaa/v1/staff/buffet/route';
import { POST as enablePOST } from '@/app/api/padharosaa/v1/platform/hotels/[id]/enable/route';

let db: TestDb;
let w: World;
let key: string;
beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
  await db.admin(`insert into public.rooms (restaurant_id, number) values ($1,'204')`, [w.A.rid]);
  authState.userId = w.admin;
  key = ((await (await enablePOST(mk('/x', { body: {} }), p({ id: w.A.rid }))).json()) as any).qr_key;
});
afterAll(async () => { vi.unstubAllGlobals(); await db.close(); });
beforeEach(async () => { authState.userId = null; await db.admin(`delete from public.rate_limits`); });

function mk(path: string, o: { body?: unknown; cookie?: string; idem?: string; method?: string } = {}): Request {
  const method = o.method ?? (o.body === undefined ? 'GET' : 'POST');
  const h = new Headers({ 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
  if (method === 'POST') { h.set('origin', APP); h.set('content-type', 'application/json'); }
  if (o.cookie) h.set('cookie', o.cookie);
  if (o.idem) h.set('idempotency-key', o.idem);
  return new Request(`${APP}${path}`, { method, headers: h, body: method === 'POST' ? JSON.stringify(o.body ?? {}) : undefined });
}
const p = <T extends object>(x: T) => ({ params: Promise.resolve(x) });
const as = (uid: string | null) => { authState.userId = uid; };
const j = async (r: Response) => (await r.json()) as any;
async function guest(): Promise<string> {
  const res = await loginPOST(mk(`/l`, { body: { k: key, name: 'Anita Sharma', cc: '+91', mobile: '9811111111', room: '204' } }), p({ slug: w.A.slug }));
  return res.headers.getSetCookie().find((c) => c.startsWith('__Host-padh_sid='))!.split(';')[0]!;
}
const save = (body: unknown) => mGuidePOST(mk('/g', { body }), p({ action: 'save' }));

describe('manager guide: map discovery and AI wording only ever make drafts', () => {
  it('needs the hotel location first; then finds nearby places (free map data), imports them as drafts, drafts words with AI, and nothing is live until published', async () => {
    as(w.A.manager);
    vi.stubGlobal('fetch', vi.fn());
    expect((await mGuidePOST(mk('/g', { body: { radius_m: 3000 } }), p({ action: 'discover' }))).status).toBe(422); // no location yet
    expect((await mGuidePOST(mk('/g', { body: { lat: 26.9124, lng: 75.7873 } }), p({ action: 'location' }))).status).toBe(200);

    const overpass = { elements: [
      { type: 'node', id: 1, lat: 26.9855, lon: 75.8513, tags: { name: 'Amer Fort', historic: 'fort' } },
      { type: 'node', id: 3, lat: 26.9130, lon: 75.7880, tags: { name: 'Lassi Corner', amenity: 'cafe' } } ] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(overpass), { status: 200 })));
    const d = await j(await mGuidePOST(mk('/g', { body: { radius_m: 3000 } }), p({ action: 'discover' })));
    expect(d.candidates.map((c: any) => c.name)).toEqual(['Lassi Corner', 'Amer Fort']);
    expect(d.candidates[0].already).toBe(false);

    const imp = await j(await mGuidePOST(mk('/g', { body: { items: d.candidates.map((c: any) => ({ category: c.category, name: c.name, lat: c.lat, lng: c.lng, address: c.address })) } }), p({ action: 'import' })));
    expect(imp.saved).toBe(2);
    let g = await j(await mGuideGET(mk('/g')));
    expect(g.ai_available).toBe(true);
    expect(g.items.every((i: any) => i.needs_review && !i.active && i.source === 'osm')).toBe(true);
    expect((await j(await mGuidePOST(mk('/g', { body: { radius_m: 3000 } }), p({ action: 'discover' })))).candidates.every((c: any) => c.already)).toBe(true);

    // AI wording: still drafts
    const ai = { choices: [{ message: { content: JSON.stringify([{ n: 1, en: 'A cafe known for lassi. Costs ₹100.', hi: 'लस्सी के लिए जाना जाने वाला कैफ़े।' }, { n: 2, en: 'A hilltop fort.', hi: 'पहाड़ी पर किला।' }]) } }] };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ai), { status: 200 })));
    const ids = g.items.map((i: any) => i.id);
    expect((await j(await mGuidePOST(mk('/g', { body: { ids } }), p({ action: 'describe' })))).drafted).toBe(2);
    g = await j(await mGuideGET(mk('/g')));
    const lassi = g.items.find((i: any) => i.name === 'Lassi Corner');
    expect(lassi).toMatchObject({ description_en: 'A cafe known for lassi.', source: 'ai_draft', needs_review: true, active: false });

    const cookie = await guest();
    expect((await j(await guideGET(mk('/g', { cookie })))).items).toEqual([]); // guests see nothing yet
    // the manager edits the wording and publishes
    expect((await save({ id: lassi.id, category: 'food', name: 'Lassi Corner', description_en: 'Thick lassi, a short walk from the hotel.', publish: true })).status).toBe(200);
    const live = await j(await guideGET(mk('/g', { cookie })));
    expect(live.items.map((i: any) => i.name)).toEqual(['Lassi Corner']);
    expect(live.hotel).toEqual({ lat: 26.9124, lng: 75.7873 });
  });

  it('AI or the map being down is reported, not hidden; only owner / manager may use these; bad input is refused', async () => {
    as(w.A.manager);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await j(await mGuidePOST(mk('/g', { body: { radius_m: 3000 } }), p({ action: 'discover' })))).reason).toBe('map_service_unavailable');
    const draft = await j(await save({ category: 'place', name: 'Hawa Mahal', source: 'osm', lat: 26.9239, lng: 75.8267 }));
    expect((await j(await mGuidePOST(mk('/g', { body: { ids: [draft.id] } }), p({ action: 'describe' })))).reason).toBe('failed');
    expect((await mGuidePOST(mk('/g', { body: { ids: ['nope'] } }), p({ action: 'describe' }))).status).toBe(400);
    expect((await mGuidePOST(mk('/g', { body: { radius_m: 50 } }), p({ action: 'discover' }))).status).toBe(400);
    expect((await mGuidePOST(mk('/g', { body: {} }), p({ action: 'bogus' }))).status).toBe(404);
    expect((await save({ category: 'place', name: 'x', link_url: 'http://insecure.example' })).status).toBe(400);
    for (const uid of [w.A.waiter, w.A.kitchen]) { as(uid); expect((await save({ category: 'tip', name: 'x' })).status, uid).toBeGreaterThanOrEqual(400); }
    as(null);
    expect((await mGuideGET(mk('/g'))).status).toBe(401);
  });

  it('itineraries save with stops and can be archived', async () => {
    as(w.A.manager);
    const it = await j(await mGuidePOST(mk('/g', { body: { name: 'Palace day', tagline: 'Forts and lassi', active: true, stops: [{ when_label: '9:00', name: 'Amer Fort' }, { when_label: '2:00', name: 'City Palace', lat: 26.9255, lng: 75.8236 }] } }), p({ action: 'itinerary' })));
    const cookie = await guest();
    expect((await j(await guideGET(mk('/g', { cookie })))).itineraries[0].stops).toHaveLength(2);
    expect((await mGuidePOST(mk('/g', { body: { id: it.id } }), p({ action: 'itinerary-archive' }))).status).toBe(200);
    expect((await j(await guideGET(mk('/g', { cookie })))).itineraries).toEqual([]);
  });
});

describe('guest plan, buffet and feedback over the API', () => {
  it('guest builds a plan and sends it once; the concierge sees one request', async () => {
    const cookie = await guest();
    const add = await planPOST(mk('/p', { body: { name: 'Albert Hall Museum', when_label: 'Day 1', lat: 26.9115, lng: 75.8195 }, cookie }), p({ action: 'add' }));
    expect(add.status).toBe(200);
    expect((await j(await planGET(mk('/p', { cookie })))).items).toHaveLength(1);
    expect((await planPOST(mk('/p', { body: { name: 'x', lat: 10 }, cookie }), p({ action: 'add' }))).status).toBe(400);
    const sent = await planPOST(mk('/p', { body: {}, cookie, idem: randomUUID() }), p({ action: 'send' }));
    expect(sent.status).toBe(201);
    expect((await planPOST(mk('/p', { body: {}, cookie }), p({ action: 'send' }))).status).toBe(400); // needs an idempotency key
    expect((await planPOST(mk('/p', { body: {}, cookie }), p({ action: 'nope' }))).status).toBe(404);
    expect((await planGET(mk('/p'))).status).toBe(401);
    const item = (await j(await planGET(mk('/p', { cookie })))).items[0].id;
    expect((await j(await planPOST(mk('/p', { body: { item }, cookie }), p({ action: 'remove' })))).items).toEqual([]);
  });

  it('manager sets the buffet; the guest sees it', async () => {
    as(w.A.manager);
    const today = (await j(await mBuffetGET(mk('/b')))).today as string;
    expect((await mBuffetPOST(mk('/b', { body: { date: today, mode: 'in_house', name: 'Thali night', start: '19:30', end: '22:30', venue: 'Courtyard', highlights: 'Dal baati' } }))).status).toBe(200);
    const cookie = await guest();
    expect((await j(await buffetGET(mk('/b', { cookie })))).days[0]).toMatchObject({ name: 'Thali night', start: '19:30' });
    expect((await mBuffetPOST(mk('/b', { body: { date: today, mode: 'in_house' } }))).status).toBe(400);
    expect((await mBuffetPOST(mk('/b', { body: { date: today, mode: 'none', start: '25:00' } }))).status).toBe(400);
  });

  it('after a request is done the guest can rate it: good invites a review, not good alerts the manager', async () => {
    const cookie = await guest();
    const c = await j(await createPOST(mk('/r', { body: { type: 'cab', label: 'Cab' }, cookie, idem: randomUUID() })));
    as(w.A.waiter);
    await staffReqPOST(mk('/s', { body: { version: c.version } }), p({ id: c.request_id, action: 'accept' }));
    await staffReqPOST(mk('/s', { body: { version: c.version + 1 } }), p({ id: c.request_id, action: 'complete' }));
    expect(await j(await reqActionPOST(mk('/f', { body: { rating: 'great' }, cookie }), p({ id: c.request_id, action: 'feedback' })))).toEqual({ rating: 'great', review_invite: true });
    expect((await reqActionPOST(mk('/f', { body: { rating: 'wow' }, cookie }), p({ id: c.request_id, action: 'feedback' }))).status).toBe(400);
  });
});
