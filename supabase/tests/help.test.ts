import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, rpc, rpcErr, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());

const svc = async <T = any>(fn: string, args: unknown[]): Promise<T> =>
  (await db.as('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const svcErr = (fn: string, args: unknown[]) => db.asErr('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const setLink = (uid: string, enabled: boolean, topics: string[] | null = null, rotate = false) => rpc(db, uid, `public.mgr_set_help_link($1, $2::text[], $3)`, [enabled, topics, rotate]);
const getLink = async (uid: string) => (await rpc(db, uid, `public.mgr_get_help_link()`))[0]!.r as { enabled: boolean; token: string | null; topics: string[] };
const board = async (uid: string) => (await rpc(db, uid, `public.staff_get_board()`))[0]!.r as { help: { id: string; room: string; topics: string[]; note: string | null }[] };
const send = (token: string | null, room: string, topics: string[], note: string | null = null, ip: string | null = null, slug = w.A.slug) =>
  svc<{ id: string; room: string; replayed: boolean }>('guest_create_help', [slug, token, room, topics, note, ip]);

describe('call for problems', () => {
  it('is off until the owner turns it on; only the owner changes it; owner and manager can read it; it starts with a ready list of problems', async () => {
    expect(await getLink(w.A.owner)).toMatchObject({ enabled: false, token: null });
    expect((await getLink(w.A.owner)).topics).toContain('WiFi not working');
    expect((await rpcErr(db, w.A.manager, `public.mgr_set_help_link(true, null::text[], false)`))?.code).toBe('GM011');
    expect((await rpcErr(db, w.A.waiter, `public.mgr_get_help_link()`))?.code).toBe('GM011');
    expect((await rpcErr(db, w.stranger, `public.mgr_get_help_link()`))?.code).toBe('GM011');
    await setLink(w.A.owner, true);
    const s = await getLink(w.A.manager);
    expect(s.enabled).toBe(true);
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
    expect(s.topics.length).toBe(12);
  });

  it('the owner can write their own topics: trimmed, de-duplicated, in order, up to 20 of up to 40 characters', async () => {
    await setLink(w.A.owner, true, ['  Towel ', 'towel', 'Wi-Fi  down', '', 'Minibar empty']);
    expect((await getLink(w.A.owner)).topics).toEqual(['Towel', 'Wi-Fi down', 'Minibar empty']);
    expect((await rpcErr(db, w.A.owner, `public.mgr_set_help_link(true, ARRAY[$1]::text[], false)`, ['x'.repeat(41)]))?.code).toBe('GM015');
    expect((await rpcErr(db, w.A.owner, `public.mgr_set_help_link(true, (select array_agg('t' || g) from generate_series(1, 21) g), false)`))?.code).toBe('GM015');
    await setLink(w.A.owner, true, []); // empty keeps the current list
    expect((await getLink(w.A.owner)).topics).toEqual(['Towel', 'Wi-Fi down', 'Minibar empty']);
  });

  it('the page gets the restaurant, the topics and the room list; a wrong link, a wrong restaurant or an unknown slug are refused', async () => {
    const { token } = await getLink(w.A.owner);
    const page = await svc<any>('guest_get_help', [w.A.slug, token]);
    expect(page).toMatchObject({ status: 'active', topics: ['Towel', 'Wi-Fi down', 'Minibar empty'], rooms: [] });
    expect(page.restaurant.name).toBeTruthy();
    expect((await svcErr('guest_get_help', [w.A.slug, 'f'.repeat(64)]))?.code).toBe('GM002');
    expect((await svcErr('guest_get_help', [w.B.slug, token]))?.code).toBe('GM002');
    expect((await svcErr('guest_get_help', ['no-such-restaurant', token]))?.code).toBe('GM012');
    expect((await svcErr('guest_get_help', [w.A.slug, null]))?.code).toBe('GM002');
  });

  it('a guest sends a problem with topics and a note; reception sees it at once; waiter done; the kitchen sees none', async () => {
    const { token } = await getLink(w.A.owner);
    const r = await send(token, ' room 201 '.replace('room ', ''), ['wi-fi down', 'TOWEL'], '  The router light is red ');
    expect(r).toMatchObject({ room: '201', replayed: false });
    const b = await board(w.A.waiter);
    const h = b.help.find((x) => x.id === r.id)!;
    expect(h).toMatchObject({ room: '201', topics: ['Towel', 'Wi-Fi down'], note: 'The router light is red' });
    for (const uid of [w.A.owner, w.A.manager]) expect((await board(uid)).help.some((x) => x.id === r.id)).toBe(true);
    expect((await board(w.A.kitchen)).help).toEqual([]);
    expect((await board(w.B.owner)).help).toEqual([]);

    expect((await rpcErr(db, w.A.kitchen, `public.staff_resolve_help($1)`, [r.id]))?.code).toBe('GM011');
    expect((await rpcErr(db, w.B.owner, `public.staff_resolve_help($1)`, [r.id]))?.code).toBe('GM012'); // another restaurant's problem
    await rpc(db, w.A.waiter, `public.staff_resolve_help($1)`, [r.id]);
    await rpc(db, w.A.waiter, `public.staff_resolve_help($1)`, [r.id]); // a double tap is fine
    expect((await board(w.A.waiter)).help.some((x) => x.id === r.id)).toBe(false);
    const [row] = await db.admin<any>(`select status, resolved_by, resolved_at is not null as at from public.help_requests where id = $1`, [r.id]);
    expect(row).toMatchObject({ status: 'done', resolved_by: w.A.waiter, at: true });
  });

  it('a note alone is enough; nothing at all is not; unknown topics, bad rooms and long notes are refused', async () => {
    const { token } = await getLink(w.A.owner);
    expect((await send(token, '305', [], 'The window will not close')).replayed).toBe(false);
    for (const [room, topics, note] of [
      ['306', [], null], ['306', [], '   '], ['306', ['Not a topic'], null],
      ['', ['Towel'], null], ['a;b', ['Towel'], null], ['x'.repeat(11), ['Towel'], null], ['306', ['Towel'], 'n'.repeat(301)],
    ] as const) {
      expect((await svcErr('guest_create_help', [w.A.slug, token, room, topics, note, null]))?.code, JSON.stringify([room, topics, note]).slice(0, 50)).toBe('GM015');
    }
    expect((await svcErr('guest_create_help', [w.A.slug, 'f'.repeat(64), '306', ['Towel'], null, null]))?.code).toBe('GM002');
    expect((await svcErr('guest_create_help', [w.B.slug, token, '306', ['Towel'], null, null]))?.code).toBe('GM002');
  });

  it('only listed rooms are accepted when the owner listed rooms (same list as room service)', async () => {
    const { token } = await getLink(w.A.owner);
    await db.admin(`update public.restaurants set room_numbers = '{101,102}' where id = $1`, [w.A.rid]);
    expect((await svcErr('guest_create_help', [w.A.slug, token, '999', ['Towel'], null, null]))?.code).toBe('GM022');
    expect((await send(token, '102', ['Towel'])).room).toBe('102');
    expect((await svc<any>('guest_get_help', [w.A.slug, token])).rooms).toEqual(['101', '102']);
    await db.admin(`update public.restaurants set room_numbers = '{}' where id = $1`, [w.A.rid]);
  });

  it('the same message twice in 10 minutes is one request; at most 3 open per room; at most 20 sends per address', async () => {
    const { token } = await getLink(w.A.owner);
    const a = await send(token, '401', ['Towel']);
    const again = await send(token, '401', ['Towel']);
    expect(again).toMatchObject({ id: a.id, replayed: true });
    await send(token, '401', ['Wi-Fi down']);
    await send(token, '401', ['Minibar empty']);
    expect((await svcErr('guest_create_help', [w.A.slug, token, '401', ['Towel', 'Wi-Fi down'], null, null]))?.code).toBe('GM008');
    expect((await send(token, '402', ['Towel'])).replayed).toBe(false); // other rooms are unaffected
    let last: any = null;
    for (let i = 0; i < 21; i++) last = await svcErr('guest_create_help', [w.A.slug, token, '403', ['Towel'], null, 'iphash-help']);
    expect(last?.code).toBe('GM007');
  });

  it('turning it off or making a new link kills the old one; a suspended restaurant takes none; nothing is open to anon or signed-in users', async () => {
    const first = (await getLink(w.A.owner)).token!;
    await setLink(w.A.owner, true, null, true);
    const second = (await getLink(w.A.owner)).token!;
    expect(second).not.toBe(first);
    expect((await svcErr('guest_create_help', [w.A.slug, first, '501', ['Towel'], null, null]))?.code).toBe('GM002');
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await svcErr('guest_create_help', [w.A.slug, second, '501', ['Towel'], null, null]))?.code).toBe('GM001');
    expect((await svc<any>('guest_get_help', [w.A.slug, second])).status).toBe('suspended');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
    await setLink(w.A.owner, false);
    expect(await getLink(w.A.owner)).toMatchObject({ enabled: false, token: null });
    expect((await svcErr('guest_create_help', [w.A.slug, second, '501', ['Towel'], null, null]))?.code).toBe('GM002');
    expect((await db.asErr('authenticated', w.A.owner, `select public.guest_create_help('x','y','1','{}'::text[],'n',null)`))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select * from public.help_requests`))?.code).toBe('42501');
    expect((await db.asErr('authenticated', w.A.owner, `insert into public.help_requests (restaurant_id, room, note) values ('${w.A.rid}', '1', 'x')`))?.code).toBe('42501');
  });

  it('staff can read only their own restaurant\'s problems directly (for live updates); the kitchen and strangers cannot', async () => {
    await setLink(w.A.owner, true);
    const { token } = await getLink(w.A.owner);
    await send(token, '601', ['Towel']);
    const own = await db.as<any>('authenticated', w.A.waiter, `select count(*)::int n from public.help_requests`);
    expect(own[0].n).toBeGreaterThan(0);
    expect((await db.as<any>('authenticated', w.A.kitchen, `select count(*)::int n from public.help_requests`))[0].n).toBe(0);
    expect((await db.as<any>('authenticated', w.B.owner, `select count(*)::int n from public.help_requests`))[0].n).toBe(0);
    expect((await db.as<any>('authenticated', w.stranger, `select count(*)::int n from public.help_requests`))[0].n).toBe(0);
  });
});
