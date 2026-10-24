import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, orderErr, placeOrder, rpc, rpcErr, type World } from './helpers/fixtures';

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
const setRooms = (uid: string, enabled: boolean, rooms: string[], rotate = false) =>
  rpc(db, uid, `public.mgr_set_room_service($1, $2::text[], $3)`, [enabled, rooms, rotate]);
const getRooms = async (uid: string) => (await rpc(db, uid, `public.mgr_get_room_service()`))[0]!.r as { enabled: boolean; token: string | null; rooms: string[] };
const line = (id: string) => [{ item_id: id, qty: 1 }];

describe('room service', () => {
  it('is off until the owner turns it on; only the owner can change it, a manager can read it', async () => {
    expect(await getRooms(w.A.owner)).toEqual({ enabled: false, token: null, rooms: [] });
    expect((await rpcErr(db, w.A.manager, `public.mgr_set_room_service(true, '{}'::text[], false)`))?.code).toBe('GM011');
    expect((await rpcErr(db, w.A.waiter, `public.mgr_get_room_service()`))?.code).toBe('GM011');
    expect((await rpcErr(db, w.stranger, `public.mgr_get_room_service()`))?.code).toBe('GM011');
    await setRooms(w.A.owner, true, ['204', ' 101 ', 'suite 1', '204', '']);
    const s = await getRooms(w.A.manager);
    expect(s.enabled).toBe(true);
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
    expect(s.rooms).toEqual(['101', '204', 'SUITE 1']); // trimmed, upper-cased, de-duplicated, sorted
  });

  it('rejects bad room numbers in the list', async () => {
    for (const bad of ['', 'a'.repeat(11), 'room;drop', '-1', '1<2']) {
      if (bad === '') continue;
      expect((await rpcErr(db, w.A.owner, `public.mgr_set_room_service(true, ARRAY[$1]::text[], false)`, [bad]))?.code, bad).toBe('GM015');
    }
    expect((await rpcErr(db, w.A.owner, `public.mgr_set_room_service(true, (select array_agg(g::text) from generate_series(1, 301) g), false)`))?.code).toBe('GM015');
  });

  it('a guest opens a room and gets that room\'s own table link; orders then work like any table', async () => {
    const { token } = await getRooms(w.A.owner);
    const open = await svc<{ token: string; label: string }>('guest_open_room', [w.A.slug, token, ' room 204 '.replace('room ', ''), null]);
    expect(open.label).toBe('Room 204');
    expect(open.token).toMatch(/^[0-9a-f]{64}$/);
    // asking again returns the same room link (not a new table)
    expect((await svc<{ token: string }>('guest_open_room', [w.A.slug, token, '204', null])).token).toBe(open.token);
    expect((await db.admin<any>(`select count(*)::int n from public.dining_tables where restaurant_id = $1 and label = 'Room 204'`, [w.A.rid]))[0].n).toBe(1);

    const o = await placeOrder(db, w.A, { token: open.token }, line(w.A.chai));
    expect(o.table_label).toBe('Room 204');
    const board = (await rpc(db, w.A.waiter, `public.staff_get_board()`))[0]!.r as { orders: { table_label: string }[] };
    expect(board.orders.map((x) => x.table_label)).toContain('Room 204');
    // the menu for the room link is a normal table link
    const m = await svc<any>('guest_get_menu', [w.A.slug, open.token]);
    expect(m).toMatchObject({ table_label: 'Room 204', token_valid: true, room_link: false, rooms: null });
  });

  it('the shared link itself cannot order; the menu tells the page it is the room link and lists the rooms', async () => {
    const { token } = await getRooms(w.A.owner);
    expect((await orderErr(db, w.A, { token: token! }, line(w.A.chai)))?.code).toBe('GM002');
    expect((await svcErr('guest_request_by_token', [w.A.slug, token, 'waiter', 'water', null, null]))?.code).toBe('GM002');
    const m = await svc<any>('guest_get_menu', [w.A.slug, token]);
    expect(m).toMatchObject({ token_valid: false, table_label: null, room_link: true, rooms: ['101', '204', 'SUITE 1'] });
    expect((await svc<any>('guest_get_menu', [w.A.slug, null])).room_link).toBe(false);
  });

  it('only listed rooms are accepted; with no list any plausible number is; junk and wrong links are refused', async () => {
    const { token } = await getRooms(w.A.owner);
    expect((await svcErr('guest_open_room', [w.A.slug, token, '999', null]))?.code).toBe('GM022');
    expect((await svcErr('guest_open_room', [w.A.slug, token, 'x;y', null]))?.code).toBe('GM015');
    expect((await svcErr('guest_open_room', [w.A.slug, token, '   ', null]))?.code).toBe('GM015');
    expect((await svcErr('guest_open_room', [w.A.slug, 'f'.repeat(64), '204', null]))?.code).toBe('GM002');
    // another restaurant's slug with this restaurant's link
    expect((await svcErr('guest_open_room', [w.B.slug, token, '204', null]))?.code).toBe('GM002');
    await setRooms(w.A.owner, true, []);
    expect((await svc<{ label: string }>('guest_open_room', [w.A.slug, token, '999', null])).label).toBe('Room 999');
  });

  it('rooms stay out of the table list; managers cannot flood it; a restaurant cannot create more than 500 rooms', async () => {
    const tables = (await rpc(db, w.A.owner, `public.mgr_get_table_tokens()`)) as any[];
    expect(tables.map((t) => t.label).some((l) => String(l).startsWith('Room'))).toBe(false);
    const { token } = await getRooms(w.A.owner);
    await db.admin(`insert into public.dining_tables (restaurant_id, label, kind) select $1, 'Room Z' || g, 'room' from generate_series(1, 500) g`, [w.A.rid]);
    const n = (await db.admin<any>(`select count(*)::int n from public.dining_tables where restaurant_id = $1 and kind = 'room'`, [w.A.rid]))[0].n;
    expect(n).toBeGreaterThanOrEqual(500);
    expect((await svcErr('guest_open_room', [w.A.slug, token, '5555', null]))?.code).toBe('GM006');
    await db.admin(`delete from public.dining_tables where restaurant_id = $1 and label like 'Room Z%'`, [w.A.rid]);
  });

  it('turning it off kills the link; a new link kills the old one; a suspended restaurant takes no room orders', async () => {
    const first = (await getRooms(w.A.owner)).token!;
    await setRooms(w.A.owner, true, [], true);
    const second = (await getRooms(w.A.owner)).token!;
    expect(second).not.toBe(first);
    expect((await svcErr('guest_open_room', [w.A.slug, first, '204', null]))?.code).toBe('GM002');
    expect((await svc<any>('guest_open_room', [w.A.slug, second, '204', null])).label).toBe('Room 204');
    await setRooms(w.A.owner, false, []);
    expect(await getRooms(w.A.owner)).toMatchObject({ enabled: false, token: null });
    expect((await svcErr('guest_open_room', [w.A.slug, second, '204', null]))?.code).toBe('GM002');
    await setRooms(w.A.owner, true, []);
    const tok = (await getRooms(w.A.owner)).token!;
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await svcErr('guest_open_room', [w.A.slug, tok, '204', null]))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
  });

  it('is throttled per address, is isolated per restaurant and leaves an audit entry', async () => {
    const { token } = await getRooms(w.A.owner);
    let last: any = null;
    for (let i = 0; i < 41; i++) last = await svcErr('guest_open_room', [w.A.slug, token, '204', 'iphash-1']);
    expect(last?.code).toBe('GM007');
    expect((await getRooms(w.B.owner)).enabled).toBe(false);
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where restaurant_id = $1 and action = 'room_service_updated'`, [w.A.rid]))[0].n).toBeGreaterThan(0);
  });
});

describe('shared table link', () => {
  const setLink = (uid: string, enabled: boolean, rotate = false) => rpc(db, uid, `public.mgr_set_table_link($1, $2)`, [enabled, rotate]);
  const getLink = async (uid: string) => (await rpc(db, uid, `public.mgr_get_table_link()`))[0]!.r as { enabled: boolean; token: string | null };

  it('is off until the owner turns it on; the manager can read but not change it; others cannot read it', async () => {
    expect(await getLink(w.A.owner)).toEqual({ enabled: false, token: null });
    expect((await rpcErr(db, w.A.manager, `public.mgr_set_table_link(true, false)`))?.code).toBe('GM011');
    expect((await rpcErr(db, w.A.waiter, `public.mgr_get_table_link()`))?.code).toBe('GM011');
    await setLink(w.A.owner, true);
    const s = await getLink(w.A.manager);
    expect(s.enabled).toBe(true);
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('opens a real table by name (any letter case) and nothing else; rooms are never reachable from it', async () => {
    const { token } = await getLink(w.A.owner);
    await db.admin(`insert into public.dining_tables (restaurant_id, label) values ($1, 'A7') on conflict do nothing`, [w.A.rid]);
    const open = await svc<{ token: string; label: string }>('guest_open_table', [w.A.slug, token, ' a7 ', null]);
    expect(open.label).toBe('A7');
    const o = await placeOrder(db, w.A, { token: open.token }, line(w.A.chai));
    expect(o.table_label).toBe('A7');
    // a table that does not exist, a room, junk and an inactive table are all "not on the list"
    expect((await svcErr('guest_open_table', [w.A.slug, token, 'NOPE', null]))?.code).toBe('GM022');
    await db.admin(`insert into public.dining_tables (restaurant_id, label, kind) values ($1, 'Room 5', 'room') on conflict do nothing`, [w.A.rid]);
    expect((await svcErr('guest_open_table', [w.A.slug, token, 'Room 5', null]))?.code).toBe('GM022');
    expect((await svcErr('guest_open_table', [w.A.slug, token, '   ', null]))?.code).toBe('GM015');
    await db.admin(`update public.dining_tables set active = false where restaurant_id = $1 and label = 'A7'`, [w.A.rid]);
    expect((await svcErr('guest_open_table', [w.A.slug, token, 'A7', null]))?.code).toBe('GM022');
    await db.admin(`update public.dining_tables set active = true where restaurant_id = $1 and label = 'A7'`, [w.A.rid]);
  });

  it('the shared link itself cannot order; the menu lists only tables on a table link and only rooms on a room link', async () => {
    const { token } = await getLink(w.A.owner);
    expect((await orderErr(db, w.A, { token: token! }, line(w.A.chai)))?.code).toBe('GM002');
    const m = await svc<any>('guest_get_menu', [w.A.slug, token]);
    expect(m).toMatchObject({ table_link: true, room_link: false, token_valid: false, table_label: null, rooms: null });
    expect(m.tables).toContain('A7');
    expect(m.tables.some((l: string) => l.startsWith('Room'))).toBe(false);
    // and the room link never lists tables
    await setRooms(w.A.owner, true, ['204']);
    const room = (await getRooms(w.A.owner)).token!;
    const rm = await svc<any>('guest_get_menu', [w.A.slug, room]);
    expect(rm).toMatchObject({ room_link: true, table_link: false, tables: null, rooms: ['204'] });
    // a room link cannot open a table and a table link cannot open a room
    expect((await svcErr('guest_open_table', [w.A.slug, room, 'A7', null]))?.code).toBe('GM002');
    expect((await svcErr('guest_open_room', [w.A.slug, token, '204', null]))?.code).toBe('GM002');
    expect((await svc<any>('guest_get_menu', [w.A.slug, null])).tables).toBeNull();
  });

  it('new link kills the old one, off erases it, a suspended restaurant is refused, wrong slug is refused, and it is audited', async () => {
    const first = (await getLink(w.A.owner)).token!;
    await setLink(w.A.owner, true, true);
    const second = (await getLink(w.A.owner)).token!;
    expect(second).not.toBe(first);
    expect((await svcErr('guest_open_table', [w.A.slug, first, 'A7', null]))?.code).toBe('GM002');
    expect((await svcErr('guest_open_table', [w.B.slug, second, 'A7', null]))?.code).toBe('GM002');
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await svcErr('guest_open_table', [w.A.slug, second, 'A7', null]))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
    await setLink(w.A.owner, false);
    expect(await getLink(w.A.owner)).toEqual({ enabled: false, token: null });
    expect((await svcErr('guest_open_table', [w.A.slug, second, 'A7', null]))?.code).toBe('GM002');
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where restaurant_id = $1 and action = 'table_link_updated'`, [w.A.rid]))[0].n).toBeGreaterThan(0);
  });
});

describe('room order handover (room delivery or takeaway)', () => {
  it('kitchen chooses delivery or takeaway for a room order; the guest status shows it; table orders refuse it', async () => {
    const { token } = await getRooms(w.A.owner);
    const open = await svc<{ token: string }>('guest_open_room', [w.A.slug, token, '204', null]);
    const o = await placeOrder(db, w.A, { token: open.token }, line(w.A.chai));
    const board0 = (await rpc(db, w.A.kitchen, `public.staff_get_board()`))[0]!.r as any;
    expect(board0.room_dining).toBe(true);
    const card = board0.orders.find((x: any) => x.id === o.order_id);
    expect(card).toMatchObject({ is_room: true, handover: null });

    const set = (uid: string, mode: string) => rpc(db, uid, `public.staff_set_order_handover($1, $2)`, [o.order_id, mode]);
    expect((await set(w.A.kitchen, 'deliver'))[0]!.r).toMatchObject({ handover: 'deliver' });
    expect(((await rpc(db, w.A.waiter, `public.staff_get_board()`))[0]!.r as any).orders.find((x: any) => x.id === o.order_id).handover).toBe('deliver');
    const st = await svc<any>('guest_get_status', [o.session_id, 30]);
    expect(st.orders.find((x: any) => x.order_no === o.order_no).handover).toBe('deliver');
    expect((await set(w.A.manager, 'takeaway'))[0]!.r).toMatchObject({ handover: 'takeaway' });

    expect((await rpcErr(db, w.A.kitchen, `public.staff_set_order_handover($1, 'bike')`, [o.order_id]))?.code).toBe('GM015');
    expect((await rpcErr(db, w.B.kitchen, `public.staff_set_order_handover($1, 'deliver')`, [o.order_id]))?.code).toBe('GM012'); // another restaurant
    expect((await rpcErr(db, w.stranger, `public.staff_set_order_handover($1, 'deliver')`, [o.order_id]))?.code).toBe('GM011');
    const tableOrder = await placeOrder(db, w.A, { token: w.A.t1.token }, line(w.A.chai));
    expect((await rpcErr(db, w.A.kitchen, `public.staff_set_order_handover($1, 'deliver')`, [tableOrder.order_id]))?.code).toBe('GM010'); // only room orders
  });

  it('with room dining switched off at a hotel, delivery is refused and takeaway still works', async () => {
    await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, false) on conflict (restaurant_id) do update set room_dining = false`, [w.A.rid]);
    const { token } = await getRooms(w.A.owner);
    const open = await svc<{ token: string }>('guest_open_room', [w.A.slug, token, '204', null]);
    const o = await placeOrder(db, w.A, { token: open.token }, line(w.A.chai));
    expect((await rpcErr(db, w.A.kitchen, `public.staff_set_order_handover($1, 'deliver')`, [o.order_id]))?.code).toBe('GM015');
    expect((await rpc(db, w.A.kitchen, `public.staff_set_order_handover($1, 'takeaway')`, [o.order_id]))[0]!.r).toMatchObject({ handover: 'takeaway' });
    expect(((await rpc(db, w.A.kitchen, `public.staff_get_board()`))[0]!.r as any).room_dining).toBe(false);
  });
});

describe('the guest picks Room delivery or Takeaway when ordering', () => {
  const setH = (slug: string, token: string, no: number | string, mode: string, minutes: number | null = null) => svc<any>('guest_set_order_handover', [slug, token, no, mode, minutes]);
  // earlier tests leave orders waiting; the app allows only a few waiting orders per table, so start each test clean
  beforeEach(async () => { await db.admin(`update public.orders set status = 'served' where restaurant_id = $1 and status = 'placed'`, [w.A.rid]); });
  const setHErr = (slug: string, token: string, no: number | string, mode: string, minutes: number | null = null) => svcErr('guest_set_order_handover', [slug, token, no, mode, minutes]);

  it('a hotel guest chooses Takeaway with a pickup time or Room delivery; the kitchen board and the guest status show it', async () => {
    await db.admin(`update public.hotel_settings set room_dining = true where restaurant_id = $1`, [w.A.rid]);
    const { token } = await getRooms(w.A.owner);
    const open = await svc<{ token: string }>('guest_open_room', [w.A.slug, token, '204', null]);
    const o = await placeOrder(db, w.A, { token: open.token }, line(w.A.chai));
    expect(await setH(w.A.slug, open.token, o.order_no, 'takeaway', 30)).toEqual({ handover: 'takeaway', handover_minutes: 30 });
    const card = (((await rpc(db, w.A.kitchen, `public.staff_get_board()`))[0]!.r as any).orders as any[]).find((x) => x.id === o.order_id);
    expect(card).toMatchObject({ handover: 'takeaway', handover_minutes: 30 });
    const st = await svc<any>('guest_get_status', [o.session_id, 30]);
    expect(st.room_dining).toBe(true);
    expect(st.orders.find((x: any) => x.order_no === o.order_no)).toMatchObject({ handover: 'takeaway', handover_minutes: 30 });
    // the guest may change their mind while the order is still waiting; room delivery clears the pickup time
    expect(await setH(w.A.slug, open.token, o.order_no, 'deliver')).toEqual({ handover: 'deliver', handover_minutes: null });
    // the kitchen switching to takeaway keeps working, and switching back to delivery clears the time again
    expect((await rpc(db, w.A.kitchen, `public.staff_set_order_handover($1, 'takeaway')`, [o.order_id]))[0]!.r).toMatchObject({ handover: 'takeaway' });
    expect((await rpc(db, w.A.kitchen, `public.staff_set_order_handover($1, 'deliver')`, [o.order_id]))[0]!.r).toMatchObject({ handover: 'deliver' });
  });

  it('a hotel without room dining refuses Room delivery and tells the status so; takeaway still works', async () => {
    await db.admin(`update public.hotel_settings set room_dining = false where restaurant_id = $1`, [w.A.rid]);
    const { token } = await getRooms(w.A.owner);
    const open = await svc<{ token: string }>('guest_open_room', [w.A.slug, token, '204', null]);
    const o = await placeOrder(db, w.A, { token: open.token }, line(w.A.chai));
    expect((await setHErr(w.A.slug, open.token, o.order_no, 'deliver'))?.code).toBe('GM015');
    expect(await setH(w.A.slug, open.token, o.order_no, 'takeaway', 45)).toEqual({ handover: 'takeaway', handover_minutes: 45 });
    expect((await svc<any>('guest_get_status', [o.session_id, 30])).room_dining).toBe(false);
  });

  it('only on the guest\'s own table, only while waiting, only in a hotel room, only with sane values', async () => {
    await db.admin(`update public.hotel_settings set room_dining = true where restaurant_id = $1`, [w.A.rid]);
    const { token } = await getRooms(w.A.owner);
    const open = await svc<{ token: string }>('guest_open_room', [w.A.slug, token, '204', null]);
    const other = await svc<{ token: string }>('guest_open_room', [w.A.slug, token, '101', null]);
    const o = await placeOrder(db, w.A, { token: open.token }, line(w.A.chai));
    expect((await setHErr(w.A.slug, other.token, o.order_no, 'takeaway'))?.code).toBe('GM012'); // someone else's room
    expect((await setHErr(w.B.slug, open.token, o.order_no, 'takeaway'))?.code).toBe('GM012'); // another restaurant
    expect((await setHErr(w.A.slug, 'x'.repeat(40), o.order_no, 'takeaway'))?.code).toBe('GM012');
    for (const bad of [['bike', null], ['takeaway', 4], ['takeaway', 181], [null, null]] as const) expect((await setHErr(w.A.slug, open.token, o.order_no, bad[0] as string, bad[1]))?.code, JSON.stringify(bad)).toBe('GM015');
    const t1 = await placeOrder(db, w.A, { token: w.A.t1.token }, line(w.A.chai));
    expect((await setHErr(w.A.slug, w.A.t1.token, t1.order_no, 'takeaway'))?.code).toBe('GM010'); // a table order, not a room
    await rpc(db, w.A.kitchen, `public.staff_set_order_status($1, 'preparing', null)`, [o.order_id]);
    expect((await setHErr(w.A.slug, open.token, o.order_no, 'takeaway'))?.code).toBe('GM010'); // already being prepared
    for (const role of ['anon', 'authenticated'] as const) expect((await db.asErr(role, role === 'authenticated' ? w.A.kitchen : null, `select public.guest_set_order_handover($1,$2,$3,'takeaway',null)`, [w.A.slug, open.token, o.order_no]))?.code).toBe('42501');
  });
});
