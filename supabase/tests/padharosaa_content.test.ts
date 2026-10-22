import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';
import { findMock } from '../../scripts/lib-no-mock';

let db: TestDb;
let w: World;
const ids: Record<string, Record<string, string>> = { A: {}, B: {} };

async function seedTenant(key: 'A' | 'B', t: World['A']) {
  const q = async (sql: string, p: unknown[]) => (await db.admin<{ id: string }>(sql, p))[0]!.id;
  await db.admin(`insert into public.hotel_settings (restaurant_id, is_mock) values ($1, true)`, [t.rid]);
  const room = await q(`insert into public.rooms (restaurant_id, number) values ($1,'204') returning id`, [t.rid]);
  const sess = await q(
    `insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash) values ($1,$2,'Guest One','+91','\\x01','\\x02',$3) returning id`,
    [t.rid, room, Buffer.from(randomUUID())],
  );
  const req = await q(`insert into public.requests (restaurant_id, session_id, room_id, type, team, label) values ($1,$2,$3,'reservation','concierge','Table') returning id`, [t.rid, sess, room]);
  const it = await q(`insert into public.itineraries (restaurant_id, name, is_mock) values ($1,'Classic', true) returning id`, [t.rid]);
  const plan = await q(`insert into public.guest_plans (restaurant_id, session_id) values ($1,$2) returning id`, [t.rid, sess]);
  Object.assign(ids[key]!, { room, sess, req, it, plan });
  await db.admin(`insert into public.buffets (restaurant_id, service_date, mode, name, start_time, end_time) values ($1, current_date, 'in_house','Dinner','19:30','22:30')`, [t.rid]);
  await db.admin(`insert into public.guide_items (restaurant_id, category, name, is_mock) values ($1,'place','Hawa Mahal', true)`, [t.rid]);
  await db.admin(`insert into public.itinerary_stops (restaurant_id, itinerary_id, when_label, name) values ($1,$2,'9 AM','Amer')`, [t.rid, it]);
  await db.admin(`insert into public.guest_plan_items (restaurant_id, plan_id, name) values ($1,$2,'Amer Fort')`, [t.rid, plan]);
  await db.admin(`insert into public.bookings (restaurant_id, request_id, kind, what, on_date, at_time, party_size) values ($1,$2,'reservation','Table', current_date, '20:00', 4)`, [t.rid, req]);
  await db.admin(`insert into public.places (restaurant_id, name, rating, review_count, data_source, is_mock) values ($1,'Demo Cafe', 4.5, 10, 'mock', true)`, [t.rid]);
  await db.admin(`insert into public.notifications (restaurant_id, channel, to_ref, template, payload, dedupe_key) values ($1,'push','ref','buffet_changed','{"secret":"x"}', $2)`, [t.rid, randomUUID()]);
  await db.admin(`insert into public.feedback (restaurant_id, session_id, request_id, rating) values ($1,$2,$3,'okay')`, [t.rid, sess, req]);
}

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await seedTenant('A', w.A);
  await seedTenant('B', w.B);
});
afterAll(async () => db.close());

const TABLES = ['buffets', 'guide_items', 'itineraries', 'itinerary_stops', 'places', 'guest_plans', 'guest_plan_items', 'bookings', 'feedback'];

describe('content tables: isolation', () => {
  it('owner/manager/waiter see only their own hotel in every table', async () => {
    for (const t of TABLES) {
      for (const uid of [w.A.owner, w.A.manager, w.A.waiter]) {
        const rows = await db.as<{ restaurant_id: string }>('authenticated', uid, `select restaurant_id from public.${t}`);
        expect(rows.length, t).toBeGreaterThan(0);
        expect(rows.every((r) => r.restaurant_id === w.A.rid), t).toBe(true);
      }
    }
  });

  it('the kitchen reads buffet, guide, itineraries and places, but not plans, bookings or feedback', async () => {
    for (const t of ['buffets', 'guide_items', 'itineraries', 'itinerary_stops', 'places'])
      expect((await db.as('authenticated', w.A.kitchen, `select 1 from public.${t}`)).length, t).toBeGreaterThan(0);
    for (const t of ['guest_plans', 'guest_plan_items', 'bookings', 'feedback']) expect(await db.as('authenticated', w.A.kitchen, `select 1 from public.${t}`), t).toEqual([]);
  });

  it('strangers and anon see nothing', async () => {
    for (const t of [...TABLES, 'notifications']) {
      expect(await db.as('authenticated', w.stranger, `select 1 from public.${t}`), t).toEqual([]);
      expect((await db.asErr('anon', null, `select 1 from public.${t}`))?.code, t).toBe('42501');
    }
  });

  it('notifications: managers see status only, never the address or payload; waiters and kitchen see none', async () => {
    const rows = await db.as<any>('authenticated', w.A.manager, `select id, channel, template, status from public.notifications`);
    expect(rows.length).toBe(1);
    for (const c of ['to_ref', 'payload', 'dedupe_key']) expect((await db.asErr('authenticated', w.A.owner, `select ${c} from public.notifications`))?.code, c).toBe('42501');
    expect((await db.asErr('authenticated', w.A.owner, `select * from public.notifications`))?.code).toBe('42501');
    expect(await db.as('authenticated', w.A.waiter, `select 1 from public.notifications`)).toEqual([]);
    expect(await db.as('authenticated', w.A.kitchen, `select 1 from public.notifications`)).toEqual([]);
  });

  it('no client can write any content table', async () => {
    for (const t of [...TABLES, 'notifications'])
      for (const sql of [`insert into public.${t} select * from public.${t}`, `update public.${t} set restaurant_id = restaurant_id`, `delete from public.${t}`])
        expect((await db.asErr('authenticated', w.A.owner, sql))?.code, `${t}: ${sql}`).toBe('42501');
  });
});

describe('content tables: rules', () => {
  const bad = (sql: string, p: unknown[] = []) => expect(db.admin(sql, p), sql).rejects.toThrow();
  it('buffet: one per day, "none" needs nothing else, any other mode needs name and times', async () => {
    await bad(`insert into public.buffets (restaurant_id, service_date, mode, name, start_time, end_time) values ($1, current_date, 'in_house','Dup','19:00','21:00')`, [w.A.rid]);
    await db.admin(`insert into public.buffets (restaurant_id, service_date, mode) values ($1, current_date + 1, 'none')`, [w.A.rid]);
    await bad(`insert into public.buffets (restaurant_id, service_date, mode) values ($1, current_date + 2, 'outdoor')`, [w.A.rid]);
    await bad(`insert into public.buffets (restaurant_id, service_date, mode, name, start_time, end_time) values ($1, current_date + 3, 'in_house','X','19:00','19:00')`, [w.A.rid]);
    await bad(`insert into public.buffets (restaurant_id, service_date, mode) values ($1, current_date + 4, 'brunch')`, [w.A.rid]);
  });

  it('links must be https; the review link must be a Google address', async () => {
    await bad(`update public.guide_items set link_url = 'javascript:alert(1)'`);
    await bad(`update public.guide_items set link_url = 'http://example.com'`);
    await db.admin(`update public.guide_items set link_url = 'https://example.com/a' where restaurant_id = $1`, [w.A.rid]);
    await bad(`update public.places set direct_review_link = 'https://evil.example/writereview'`);
    await bad(`update public.places set direct_review_link = 'https://search.google.com.evil.example/x'`);
    await db.admin(`update public.places set direct_review_link = 'https://search.google.com/local/writereview?placeid=ChIJabc123456' where restaurant_id = $1`, [w.A.rid]);
  });

  it('places: mock and source must agree; a real rating needs a fetch or verification date; ratings stay 0-5', async () => {
    await bad(`insert into public.places (restaurant_id, name, data_source, is_mock) values ($1,'Fake','places_api', true)`, [w.A.rid]);
    await bad(`insert into public.places (restaurant_id, name, data_source, is_mock) values ($1,'Fake2','mock', false)`, [w.A.rid]);
    await bad(`insert into public.places (restaurant_id, name, rating, data_source) values ($1,'Invented', 4.9, 'manual')`, [w.A.rid]);
    await bad(`insert into public.places (restaurant_id, name, rating, data_source, fetched_at) values ($1,'Too good', 5.5, 'places_api', now())`, [w.A.rid]);
    await db.admin(`insert into public.places (restaurant_id, name, rating, review_count, data_source, fetched_at) values ($1,'Real', 4.7, 1200, 'places_api', now())`, [w.A.rid]);
    await db.admin(`insert into public.places (restaurant_id, name, data_source) values ($1,'New (no rating)', 'manual')`, [w.A.rid]);
  });

  it('bookings: party 1-20, one booking per request, and only for a request of the same hotel', async () => {
    await bad(`insert into public.bookings (restaurant_id, request_id, kind, what, on_date, at_time, party_size) values ($1,$2,'reservation','x',current_date,'20:00',0)`, [w.A.rid, ids.A!.req]);
    await bad(`insert into public.bookings (restaurant_id, request_id, kind, what, on_date, at_time, party_size) values ($1,$2,'reservation','x',current_date,'20:00',21)`, [w.A.rid, ids.A!.req]);
    await bad(`insert into public.bookings (restaurant_id, request_id, kind, what, on_date, at_time, party_size) values ($1,$2,'reservation','x',current_date,'20:00',2)`, [w.A.rid, ids.A!.req]); // already has one
    await bad(`insert into public.bookings (restaurant_id, request_id, kind, what, on_date, at_time, party_size) values ($1,$2,'vista','x',current_date,'20:00',2)`, [w.B.rid, ids.A!.req]); // cross-hotel
  });

  it('cross-hotel links are impossible: stops, plan items, plans and feedback must point inside the same hotel', async () => {
    await bad(`insert into public.itinerary_stops (restaurant_id, itinerary_id, when_label, name) values ($1,$2,'x','x')`, [w.A.rid, ids.B!.it]);
    await bad(`insert into public.guest_plan_items (restaurant_id, plan_id, name) values ($1,$2,'x')`, [w.A.rid, ids.B!.plan]);
    await bad(`insert into public.guest_plans (restaurant_id, session_id) values ($1,$2)`, [w.A.rid, ids.B!.sess]);
    await bad(`insert into public.feedback (restaurant_id, session_id, rating) values ($1,$2,'great')`, [w.A.rid, ids.B!.sess]);
    await bad(`insert into public.guest_plans (restaurant_id, session_id) values ($1,$2)`, [w.A.rid, ids.A!.sess]); // one plan per session
  });

  it('notifications dedupe and feedback ratings are constrained', async () => {
    const k = randomUUID();
    await db.admin(`insert into public.notifications (restaurant_id, channel, to_ref, template, dedupe_key) values ($1,'push','r','t',$2)`, [w.A.rid, k]);
    await bad(`insert into public.notifications (restaurant_id, channel, to_ref, template, dedupe_key) values ($1,'push','r','t',$2)`, [w.A.rid, k]);
    await bad(`insert into public.notifications (restaurant_id, channel, to_ref, template) values ($1,'fax','r','t')`, [w.A.rid]);
    await bad(`insert into public.feedback (restaurant_id, session_id, rating) values ($1,$2,'amazing')`, [w.A.rid, ids.A!.sess]);
  });

  it('deleting a request keeps its feedback (request link cleared); the platform delete removes the whole hotel', async () => {
    await db.admin(`delete from public.bookings where request_id = $1`, [ids.B!.req]);
    await db.admin(`delete from public.requests where id = $1`, [ids.B!.req]);
    expect((await db.admin<any>(`select request_id from public.feedback where restaurant_id = $1`, [w.B.rid]))[0].request_id).toBeNull();
    // the platform's own delete function (a plain DELETE is blocked by the append-only audit log); it must cascade into every new table
    await db.as('service_role', null, `select public.admin_delete_restaurant($1, $2, $3)`, [w.admin, w.B.rid, w.B.slug]);
    for (const t of [...TABLES, 'notifications', 'hotel_settings', 'rooms', 'guest_sessions'])
      expect((await db.admin<any>(`select count(*)::int n from public.${t} where restaurant_id = $1`, [w.B.rid]))[0].n, t).toBe(0);
  });
});

describe('mock-data guard and demo seed', () => {
  it('the seed is idempotent and everything it creates is flagged mock', async () => {
    const d = await createTestDb();
    try {
      const sql = readFileSync(join(__dirname, '..', 'seed', 'padharosaa_demo.sql'), 'utf8');
      await d.pool.query(sql);
      const count = async () => (await d.admin<any>(`select (select count(*) from public.guide_items)::int g, (select count(*) from public.places)::int p, (select count(*) from public.rooms)::int r`))[0];
      const first = await count();
      await d.pool.query(sql);
      expect(await count()).toEqual(first);
      for (const t of ['hotel_settings', 'guide_items', 'itineraries', 'places']) expect((await d.admin<any>(`select count(*)::int n from public.${t} where not is_mock`))[0].n, t).toBe(0);
      const found = await findMock(d.pool);
      expect(found.length).toBeGreaterThanOrEqual(4);
      expect(found.join(' ')).toMatch(/hotel_settings.*guide_items|guide_items/s);
    } finally {
      await d.close();
    }
  });

  it('a clean database passes, a Lite database without Padharosaa tables passes, and switching a record off clears it', async () => {
    const d = await createTestDb();
    try {
      expect(await findMock(d.pool)).toEqual([]);
      await d.admin(`insert into public.restaurants (slug, name) values ('real-hotel','Real') `);
      const rid = (await d.admin<any>(`select id from public.restaurants where slug = 'real-hotel'`))[0].id;
      await d.admin(`insert into public.hotel_settings (restaurant_id, is_mock) values ($1, true)`, [rid]);
      expect(await findMock(d.pool)).toHaveLength(1);
      await d.admin(`update public.hotel_settings set enabled = false where restaurant_id = $1`, [rid]);
      expect(await findMock(d.pool)).toEqual([]);
    } finally {
      await d.close();
    }
    const lite = { query: async (sql: string) => (sql.includes('to_regclass') ? { rows: [{ t: null }] } : { rows: [{ n: 0 }] }) };
    expect(await findMock(lite as never)).toEqual([]);
  });
});
