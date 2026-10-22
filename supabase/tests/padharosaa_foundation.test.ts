import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
let roomA: string;
let roomB: string;
let sessA: string;
let sessB: string;
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const t of [w.A, w.B]) {
    await db.admin(`insert into public.hotel_settings (restaurant_id, is_mock, qr_key_hash, wifi_password_enc) values ($1, true, '\\x01', '\\x02')`, [t.rid]);
    await db.admin(`insert into public.concierge_shifts (restaurant_id, label, start_time, end_time, staff_name) values ($1,'Night','23:00','07:00','Meera')`, [t.rid]);
  }
  roomA = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'204') returning id`, [w.A.rid]))[0]!.id;
  roomB = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'204') returning id`, [w.B.rid]))[0]!.id;
  const sess = async (rid: string, room: string, name: string) =>
    (
      await db.admin<{ id: string }>(
        `insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash)
         values ($1,$2,$3,'+91','\\x01','\\x02',$4) returning id`,
        [rid, room, name, Buffer.from(randomUUID())],
      )
    )[0]!.id;
  sessA = await sess(w.A.rid, roomA, 'Anita');
  sessB = await sess(w.B.rid, roomB, 'Pierre');
});
afterAll(async () => db.close());

describe('padharosaa foundation: tenant isolation', () => {
  it('staff see only their own hotel rows in every new table', async () => {
    for (const [tbl, col] of [['hotel_settings', 'restaurant_id'], ['rooms', 'restaurant_id'], ['concierge_shifts', 'restaurant_id']] as const) {
      const rows = await db.as<{ restaurant_id: string }>('authenticated', w.A.manager, `select ${col} as restaurant_id from public.${tbl}`);
      expect(rows.length, tbl).toBeGreaterThan(0);
      expect(rows.every((r) => r.restaurant_id === w.A.rid), tbl).toBe(true);
    }
    const g = await db.as<{ id: string }>('authenticated', w.A.waiter, `select id from public.guest_sessions`);
    expect(g.map((r) => r.id)).toEqual([sessA]);
    expect(g.map((r) => r.id)).not.toContain(sessB);
  });

  it('a user without a staff row and anon see nothing / are refused', async () => {
    expect(await db.as('authenticated', w.stranger, `select 1 from public.rooms`)).toEqual([]);
    expect(await db.as('authenticated', w.stranger, `select 1 from public.guest_sessions`)).toEqual([]);
    for (const t of ['hotel_settings', 'rooms', 'concierge_shifts', 'guest_sessions', 'stay_codes']) {
      expect((await db.asErr('anon', null, `select 1 from public.${t}`))?.code, t).toBe('42501');
    }
  });

  it('kitchen cannot read guest sessions; stay_codes unreachable for everyone', async () => {
    expect(await db.as('authenticated', w.A.kitchen, `select 1 from public.guest_sessions`)).toEqual([]);
    expect((await db.asErr('authenticated', w.A.owner, `select 1 from public.stay_codes`))?.code).toBe('42501');
  });
});

describe('padharosaa foundation: sensitive columns and writes', () => {
  it('secret columns are not readable by any staff role', async () => {
    const cases: [string, string][] = [
      ['hotel_settings', 'qr_key_hash'],
      ['hotel_settings', 'wifi_password_enc'],
      ['guest_sessions', 'mobile_enc'],
      ['guest_sessions', 'mobile_hash'],
      ['guest_sessions', 'token_hash'],
      ['guest_sessions', 'push_subscription'],
    ];
    for (const [t, c] of cases) {
      expect((await db.asErr('authenticated', w.A.owner, `select ${c} from public.${t}`))?.code, `${t}.${c}`).toBe('42501');
      expect((await db.asErr('authenticated', w.A.owner, `select * from public.${t}`))?.code, `${t}.*`).toBe('42501');
    }
  });

  it('no client can insert, update or delete any new table', async () => {
    for (const uid of [w.A.owner, w.A.manager]) {
      expect((await db.asErr('authenticated', uid, `insert into public.rooms (restaurant_id, number) values ($1,'999')`, [w.A.rid]))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `update public.hotel_settings set theme = 'terracotta'`))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `delete from public.guest_sessions`))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `update public.concierge_shifts set staff_name = 'x'`))?.code).toBe('42501');
    }
  });
});

describe('padharosaa foundation: data rules', () => {
  it('same room number may exist in two hotels, not twice in one', async () => {
    expect(roomA).not.toBe(roomB);
    await expect(db.admin(`insert into public.rooms (restaurant_id, number) values ($1,'204')`, [w.A.rid])).rejects.toThrow();
  });

  it('a session cannot point at another hotel\'s room', async () => {
    await expect(
      db.admin(
        `insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash)
         values ($1,$2,'Eve','+91','\\x01','\\x02','\\x03')`,
        [w.A.rid, roomB],
      ),
    ).rejects.toThrow();
  });

  it('input limits hold (bad theme, bad phone, bad URL, bad name, bad country code, empty shift)', async () => {
    const bad = [
      `update public.hotel_settings set theme = 'neon'`,
      `update public.hotel_settings set reception_phone = '12ab'`,
      `update public.hotel_settings set review_link = 'http://x.test'`,
      `update public.hotel_settings set entrance_maps_url = 'javascript:alert(1)'`,
      `update public.guest_sessions set guest_name = 'A'`,
      `update public.guest_sessions set mobile_cc = '91'`,
      `update public.guest_sessions set language = 'xx'`,
      `update public.concierge_shifts set end_time = start_time`,
      `insert into public.rooms (restaurant_id, number) values ('${'00000000-0000-0000-0000-000000000000'}', 'bad;room')`,
    ];
    for (const sql of bad) await expect(db.admin(sql), sql).rejects.toThrow();
  });

  it('a night shift may cross midnight', async () => {
    const r = await db.admin<{ n: number }>(`select count(*)::int n from public.concierge_shifts where end_time < start_time`);
    expect(r[0]!.n).toBe(2);
  });

  it('is_hotel is true only for restaurants with an enabled hotel_settings row', async () => {
    const is = async (rid: string) => (await db.as<{ r: boolean }>('authenticated', w.A.owner, `select private.is_hotel($1) as r`, [rid]))[0]!.r;
    expect(await is(w.A.rid)).toBe(true);
    await db.admin(`insert into public.restaurants (slug, name) values ('lite-cafe','Lite Cafe')`);
    const lite = (await db.admin<{ id: string }>(`select id from public.restaurants where slug = 'lite-cafe'`))[0]!.id;
    expect(await is(lite)).toBe(false);
  });
});

describe('padharosaa foundation: backfill', () => {
  it('rooms are created from restaurants.room_numbers when the migration runs', async () => {
    const d = await createTestDb({ migrate: false });
    try {
      const files = (await import('./helpers/db')).migrationFiles;
      for (const m of await files()) {
        if (m.name.startsWith('0026')) {
          await d.admin(`insert into public.restaurants (slug, name, room_numbers) values ('old-hotel','Old','{101,"SUITE 1","bad;x"}')`);
        }
        await d.admin(m.sql);
      }
      const rows = await d.admin<{ number: string }>(`select number from public.rooms order by 1`);
      expect(rows.map((r) => r.number)).toEqual(['101', 'SUITE 1']);
    } finally {
      await d.close();
    }
  });
});
