import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, type World } from '../../supabase/tests/helpers/fixtures';
import { APP, state } from './helpers';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
import { pullHotel, runChannelPush } from '@/lib/padharosaa/channels';
import { POST as webhookPOST } from '@/app/api/padharosaa/v1/channel/webhook/[secret]/route';

// The channel manager end to end: the real worker code against the real database, with the channel service replaced by a recorder.
let db: TestDb;
let w: World;
const PROP = 'cccccccc-1111-2222-3333-444444444444';
const EXT_ROOM = 'aaaaaaaa-1111-2222-3333-444444444444';
const EXT_RATE = 'bbbbbbbb-1111-2222-3333-444444444444';
let type: string;
const calls: { method: string; url: string; headers: Record<string, string>; body: any }[] = [];
let feed: unknown[] = [];
let failPosts = false;
const day = async (n: number) => (await db.admin<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date + $1::int, 'YYYY-MM-DD') as d`, [n]))[0]!.d;

beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.A.rid]);
  type = (await db.admin<{ id: string }>(`insert into public.room_types (restaurant_id, name, rate_paise) values ($1,'Deluxe',300000) returning id`, [w.A.rid]))[0]!.id;
  for (const no of ['701', '702']) await db.admin(`insert into public.rooms (restaurant_id, number, room_type_id) values ($1,$2,$3)`, [w.A.rid, no, type]);
  await db.admin(`insert into public.channel_maps (restaurant_id, room_type_id, ext_room_type_id, ext_rate_plan_id) values ($1,$2,$3,$4)`, [w.A.rid, type, EXT_ROOM, EXT_RATE]);
  await db.admin(`insert into public.channel_links (restaurant_id, property_id, enabled) values ($1,$2,true)`, [w.A.rid, PROP]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith('https://app.channex.io/api/v1')) return new Response('{}', { status: 200 });
    const rec = { method: init?.method ?? 'GET', url: u.replace('https://app.channex.io/api/v1', ''), headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(rec);
    if (rec.method === 'POST' && failPosts) return new Response('boom', { status: 500 });
    if (rec.url.startsWith('/booking_revisions/feed')) return new Response(JSON.stringify({ data: feed }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
});
afterAll(async () => { vi.unstubAllGlobals(); await db.close(); });

describe('sending prices and rooms left', () => {
  it('a price change goes out as ranges with the key, then the queue is empty', async () => {
    await db.admin(`delete from public.channel_outbox`);
    calls.length = 0;
    await db.as('authenticated', w.A.owner, `select public.padh_rates_set($1::uuid,$2::date,$3::date,450000,null,null,null,false)`, [type, await day(3), await day(5)]);
    expect(await runChannelPush()).toBe(1);
    const r = calls.filter((c) => c.url === '/restrictions').flatMap((c) => c.body.values);
    expect(r).toEqual([
      { property_id: PROP, rate_plan_id: EXT_RATE, date_from: await day(3), date_to: await day(5), rate: 450000, stop_sell: false, min_stay_arrival: 1 },
    ]);
    const a = calls.filter((c) => c.url === '/availability').flatMap((c) => c.body.values);
    expect(a).toEqual([{ property_id: PROP, room_type_id: EXT_ROOM, date_from: await day(3), date_to: await day(5), availability: 2 }]);
    expect(calls[0]!.headers['user-api-key']).toBe('channex-test-key-channex-test-key');
    expect((await db.admin<any>(`select count(*)::int as n from public.channel_outbox where done_at is null`))[0].n).toBe(0);
    expect((await db.admin<any>(`select last_push_at is not null as ok, last_error from public.channel_links`))[0]).toEqual({ ok: true, last_error: null });
  });
  it('when the service refuses, the change stays queued with the reason, and goes out on the next try', async () => {
    calls.length = 0;
    failPosts = true;
    await db.as('authenticated', w.A.owner, `select public.padh_rates_set($1::uuid,$2::date,$2::date,460000,null,null,null,false)`, [type, await day(9)]);
    expect(await runChannelPush()).toBe(0);
    const [l] = await db.admin<any>(`select last_error from public.channel_links`);
    expect(l.last_error).toMatch(/answered 500/);
    expect((await db.admin<any>(`select count(*)::int as n from public.channel_outbox where done_at is null`))[0].n).toBe(1);
    failPosts = false;
    expect(await runChannelPush()).toBe(1);
    expect((await db.admin<any>(`select last_error from public.channel_links`))[0].last_error).toBeNull();
  });
});

describe('receiving bookings', () => {
  const rev = (id: string, o: Record<string, unknown> = {}, roomType = EXT_ROOM) => ({ id, type: 'booking_revision', attributes: { booking_id: 'bk-900', status: 'new', ota_name: 'Agoda', ota_reservation_code: 'AG-1', arrival_date: '2026-12-10', departure_date: '2026-12-12', amount: '6000.00',
    customer: { name: 'Sara', surname: 'Khan', phone: '+919800011122' }, rooms: [{ room_type_id: roomType, occupancy: { adults: 2 } }], ...o } });
  it('a new booking is saved as a reservation and acknowledged; the same revision twice makes one reservation', async () => {
    calls.length = 0;
    feed = [rev('rev-a')];
    expect(await pullHotel(w.A.rid, PROP)).toBe(1);
    expect(calls.some((c) => c.method === 'POST' && c.url === '/booking_revisions/rev-a/ack')).toBe(true);
    expect((await db.admin<any>(`select guest_name, source, rate_paise, external_ref from public.reservations where external_ref = 'bk-900#0'`))[0]).toEqual({ guest_name: 'Sara Khan', source: 'Agoda', rate_paise: 300000, external_ref: 'bk-900#0' });
    await pullHotel(w.A.rid, PROP);
    expect((await db.admin<any>(`select count(*)::int as n from public.reservations where external_ref = 'bk-900#0'`))[0].n).toBe(1);
    // the room taken by that booking is announced to the sites
    expect((await db.admin<any>(`select count(*)::int as n from public.channel_outbox where done_at is null`))[0].n).toBeGreaterThan(0);
  });
  it('a cancellation cancels it; a booking for an unlinked room type is not acknowledged and the reason is shown', async () => {
    calls.length = 0;
    feed = [rev('rev-b', { status: 'cancelled' }), rev('rev-c', { booking_id: 'bk-901' }, 'eeeeeeee-0000-0000-0000-000000000000')];
    await pullHotel(w.A.rid, PROP);
    expect((await db.admin<any>(`select status from public.reservations where external_ref = 'bk-900#0'`))[0].status).toBe('cancelled');
    expect(calls.some((c) => c.url === '/booking_revisions/rev-b/ack')).toBe(true);
    expect(calls.some((c) => c.url === '/booking_revisions/rev-c/ack')).toBe(false);
    expect((await db.admin<any>(`select last_error from public.channel_links`))[0].last_error).toMatch(/not linked/);
  });
  it('a message that cannot be read is skipped, not guessed', async () => {
    calls.length = 0;
    feed = [{ id: 'rev-d', attributes: { status: 'new' } }];
    expect(await pullHotel(w.A.rid, PROP)).toBe(0);
    expect(calls.some((c) => c.url.includes('/ack'))).toBe(false);
  });
});

describe('the webhook address', () => {
  const call = (secret: string) => webhookPOST(new Request(`${APP}/api/padharosaa/v1/channel/webhook/${secret}`, { method: 'POST', body: '{}' }), { params: Promise.resolve({ secret }) });
  it('answers 404 for a wrong or odd secret and 200 for the hotel\'s own', async () => {
    expect((await call('nope')).status).toBe(404);
    expect((await call('0'.repeat(64))).status).toBe(404);
    const [{ webhook_secret }] = await db.admin<any>(`select webhook_secret from public.channel_links`);
    expect((await call(webhook_secret)).status).toBe(200);
  });
});
