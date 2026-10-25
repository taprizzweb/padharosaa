import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// The owner's Overview (migration 0061): who may read it, and what it counts.
let db: TestDb;
let w: World;
const overview = async (uid: string) => (await db.as('authenticated', uid, `select public.padh_overview() as r`, [] as never))[0]!.r as any;
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.A.rid]);
  const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'601') returning id`, [w.A.rid]))[0]!.id;
  const s = (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Anita','+91','\\x01','\\x02',$3,'active') returning id`, [w.A.rid, room, Buffer.from(randomUUID())]))[0]!.id;
  const mk = async (type: string, label: string, urgent = false) => (await db.as('service_role', null, `select public.padh_guest_create_request($1,$2,$3,null,$4,$5) as r`, [s, type, label, urgent, randomUUID()] as never))[0]!.r as { request_id: string };
  const a = await mk('housekeeping', 'Towels');
  await mk('housekeeping', 'Pillows');
  await mk('help', 'AC', true);
  await db.admin(`update public.requests set status = 'completed', accepted_at = created_at + interval '2 minutes', completed_at = created_at + interval '10 minutes' where id = $1`, [a.request_id]);
});
afterAll(async () => db.close());

describe('overview', () => {
  it('owner and manager read it; reception, kitchen and strangers cannot', async () => {
    for (const uid of [w.A.owner, w.A.manager]) expect((await overview(uid)).guests_in).toBe(1);
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await db.asErr('authenticated', uid, `select public.padh_overview()`, [] as never))?.code).toBe('GM011');
    expect((await db.asErr('authenticated', w.B.owner, `select public.padh_overview()`, [] as never))?.code).toBe('GM011'); // hotel B is not a hotel
  });
  it('counts today\'s requests, what is open, how fast they are answered, and the busiest hours', async () => {
    const o = await overview(w.A.owner);
    expect(o).toMatchObject({ rooms_with_guests: 1, requests_today: 3, open_now: 2, waiting_now: 2, urgent_today: 1, done_today: 1, orders_today: 0, orders_paise_today: 0 });
    expect(Number(o.avg_accept_minutes)).toBeCloseTo(2, 0);
    expect(Number(o.avg_done_minutes)).toBeCloseTo(10, 0);
    expect(o.by_type).toEqual([{ type: 'housekeeping', n: 2 }, { type: 'help', n: 1 }]);
    expect(o.by_hour).toHaveLength(24);
    expect(o.by_hour.reduce((a: number, b: number) => a + b, 0)).toBe(3);
    expect(o.last_days).toHaveLength(7);
    expect(o.last_days[6].n).toBe(3);
  });
});
