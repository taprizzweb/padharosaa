import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
let sA: string; // guest session in hotel A
let sA2: string; // second guest session in hotel A
let sB: string; // guest session in hotel B

const idem = () => randomUUID();
const svc = async <T = any>(fn: string, args: unknown[]): Promise<T> =>
  (await db.as('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const svcErr = (fn: string, args: unknown[]) =>
  db.asErr('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const staff = async <T = any>(uid: string, fn: string, args: unknown[]): Promise<T> =>
  (await db.as('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, args: unknown[]) =>
  db.asErr('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const create = (s: string, type: string, label: string, detail: string | null = null, urgent = false, key = idem()) =>
  svc<{ request_id: string; version: number; status: string; merged?: boolean; replayed?: boolean }>('padh_guest_create_request', [s, type, label, detail, urgent, key]);
const row = async (id: string) => (await db.admin<any>(`select * from public.requests where id = $1`, [id]))[0];
const msgs = async (sid: string) => db.admin<any>(`select body, params, chips, request_id from public.messages where session_id = $1 order by created_at, id`, [sid]);

async function mkSession(rid: string, room: string, name: string, status = 'active') {
  const r = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) on conflict (restaurant_id, number) do update set number = excluded.number returning id`, [rid, room]))[0]!.id;
  return (
    await db.admin<{ id: string }>(
      `insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status)
       values ($1,$2,$3,'+91','\\x01','\\x02',$4,$5) returning id`,
      [rid, r, name, Buffer.from(randomUUID()), status],
    )
  )[0]!.id;
}

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const t of [w.A, w.B]) await db.admin(`insert into public.hotel_settings (restaurant_id, is_mock) values ($1, true)`, [t.rid]);
  sA = await mkSession(w.A.rid, '204', 'Anita');
  sA2 = await mkSession(w.A.rid, '205', 'Ravi');
  sB = await mkSession(w.B.rid, '204', 'Pierre');
});
afterAll(async () => db.close());
// each test starts with fresh rate-limit counters (the flood test below proves the limit itself)
beforeEach(async () => {
  await db.admin(`delete from public.rate_limits`);
});

describe('guest creates a request', () => {
  it('routes by type, writes an event and tells the guest', async () => {
    const hk = await create(sA, 'housekeeping', 'Towels x2');
    expect(hk).toMatchObject({ status: 'received', version: 1 });
    expect((await row(hk.request_id)).team).toBe('housekeeping');
    const cab = await create(sA, 'cab', 'Cab to airport');
    expect((await row(cab.request_id)).team).toBe('concierge');
    const help = await create(sA, 'help', 'Air conditioner', null, true);
    const h = await row(help.request_id);
    expect([h.team, h.urgent]).toEqual(['front_desk', true]);
    const ev = await db.admin<any>(`select actor_type, action from public.request_events where request_id = $1`, [hk.request_id]);
    expect(ev).toEqual([{ actor_type: 'guest', action: 'created' }]);
    const m = await msgs(sA);
    expect(m.map((x: any) => x.body)).toContain('msg.sent');
    expect(m.map((x: any) => x.body)).toContain('msg.sorry_problem');
  });

  it('replaying the same idempotency key returns the original, never a duplicate', async () => {
    const key = idem();
    const a = await create(sA, 'wake', 'Wake-up 6:00 AM', null, false, key);
    const b = await create(sA, 'wake', 'Wake-up 6:00 AM', null, false, key);
    expect(b.request_id).toBe(a.request_id);
    expect(b.replayed).toBe(true);
    // another guest cannot use someone else's key to read their request
    expect((await svcErr('padh_guest_create_request', [sA2, 'wake', 'x', null, false, key]))?.code).toBe('GM012');
  });

  it('merges the same ask within 60 seconds, but not when the details differ', async () => {
    const a = await create(sA2, 'errand', 'Laundry', 'two shirts');
    const same = await create(sA2, 'errand', 'Laundry', 'two shirts');
    expect(same).toMatchObject({ request_id: a.request_id, merged: true });
    const other = await create(sA2, 'errand', 'Laundry', 'five shirts');
    expect(other.request_id).not.toBe(a.request_id);
  });

  it('rejects system types, bad input, and closed or missing sessions', async () => {
    for (const t of ['food', 'chat_message', 'feedback_alert', 'vista', 'nope'])
      expect((await svcErr('padh_guest_create_request', [sA, t, 'x', null, false, idem()]))?.code, t).toBe('GM015');
    expect((await svcErr('padh_guest_create_request', [sA, 'cab', '', null, false, idem()]))?.code).toBe('GM015');
    expect((await svcErr('padh_guest_create_request', [sA, 'cab', 'x', 'y'.repeat(501), false, idem()]))?.code).toBe('GM015');
    expect((await svcErr('padh_guest_create_request', [sA, 'cab', 'x', null, false, 'short']))?.code).toBe('GM015');
    expect((await svcErr('padh_guest_create_request', [randomUUID(), 'cab', 'x', null, false, idem()]))?.code).toBe('GM012');
    const ended = await mkSession(w.A.rid, '300', 'Gone', 'ended');
    expect((await svcErr('padh_guest_create_request', [ended, 'cab', 'x', null, false, idem()]))?.code).toBe('GM009');
  });

  it('strips control and bidi characters from labels and details', async () => {
    const s = await mkSession(w.A.rid, '301', 'Dirty');
    const r = await create(s, 'errand', 'Gift‮evil\u0007', '  a ⁦b  \t c ');
    const q = await row(r.request_id);
    expect([q.label, q.detail]).toEqual(['Giftevil', 'a b c']);
  });

  it('flood limit: the 11th request in 5 minutes is refused', async () => {
    const s = await mkSession(w.A.rid, '302', 'Flood');
    for (let i = 0; i < 10; i++) await create(s, 'errand', `Thing ${i}`);
    expect((await svcErr('padh_guest_create_request', [s, 'errand', 'Thing 11', null, false, idem()]))?.code).toBe('GM007');
  });

  it('a Lite restaurant (no hotel_settings) cannot receive Padharosaa requests', async () => {
    const [lite] = await db.admin<{ id: string }>(`insert into public.restaurants (slug, name) values ('lite-only','Lite') returning id`);
    const r = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'1') returning id`, [lite!.id]))[0]!.id;
    const s = (
      await db.admin<{ id: string }>(
        `insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash) values ($1,$2,'Lia','+91','\\x01','\\x02',$3) returning id`,
        [lite!.id, r, Buffer.from(randomUUID())],
      )
    )[0]!.id;
    expect((await svcErr('padh_guest_create_request', [s, 'cab', 'x', null, false, idem()]))?.code).toBe('GM009');
  });
});

describe('staff transitions', () => {
  it('accept: received -> accepted, stamps who/when, tells the guest, bumps version', async () => {
    const r = await create(sA, 'housekeeping', 'Extra pillow');
    const out = await staff(w.A.waiter, 'padh_accept', [r.request_id, 1]);
    expect(out).toMatchObject({ status: 'accepted', version: 2 });
    const q = await row(r.request_id);
    expect(q.accepted_by).toBe(w.A.waiter);
    expect(q.accepted_at).not.toBeNull();
    const m = (await msgs(sA)).filter((x: any) => x.request_id === r.request_id);
    expect(m.map((x: any) => x.body)).toContain('msg.accepted');
    expect(m.find((x: any) => x.body === 'msg.accepted').params).toMatchObject({ team: 'Housekeeping', label: 'Extra pillow' });
    const aud = await db.admin<any>(`select 1 from public.audit_log where action = 'padh_request_accepted' and entity_id = $1`, [r.request_id]);
    expect(aud.length).toBe(1);
  });

  it('two staff accept at once: the second gets a conflict and nothing changes twice', async () => {
    const r = await create(sA, 'cab', 'Cab to station');
    await staff(w.A.waiter, 'padh_accept', [r.request_id, 1]);
    expect((await staffErr(w.A.manager, 'padh_accept', [r.request_id, 1]))?.code).toBe('GM019');
    expect((await row(r.request_id)).version).toBe(2);
    // with the fresh version it is an illegal transition (already accepted)
    expect((await staffErr(w.A.manager, 'padh_accept', [r.request_id, 2]))?.code).toBe('GM010');
  });

  it('dismiss needs a reason, tells the guest the reason, and cannot be repeated', async () => {
    const r = await create(sA, 'reservation', 'Table for 4');
    for (const bad of [null, '', '  ', 'no', 'x'.repeat(141)])
      expect((await staffErr(w.A.waiter, 'padh_dismiss', [r.request_id, 1, bad]))?.code, String(bad)).toBe('GM014');
    expect((await row(r.request_id)).status).toBe('received');
    await staff(w.A.waiter, 'padh_dismiss', [r.request_id, 1, 'slot_full']);
    const q = await row(r.request_id);
    expect([q.status, q.dismissed_reason]).toEqual(['dismissed', 'slot_full']);
    const m = (await msgs(sA)).find((x: any) => x.request_id === r.request_id && x.body === 'msg.dismissed');
    expect(m.params).toMatchObject({ reason: 'slot_full', preset: true, label: 'Table for 4' });
    expect(m.chips).toEqual(['call_reception', 'chat_reception']);
    expect((await staffErr(w.A.waiter, 'padh_dismiss', [r.request_id, 2, 'Sorry, closed']))?.code).toBe('GM010');
  });

  it('dismiss with free text is stored cleaned and flagged as not a preset', async () => {
    const r = await create(sA, 'artisan', 'Block printing visit');
    await staff(w.A.manager, 'padh_dismiss', [r.request_id, 1, 'Studio is closed on ‮Mondays']);
    expect((await row(r.request_id)).dismissed_reason).toBe('Studio is closed on Mondays');
    const m = (await msgs(sA)).find((x: any) => x.request_id === r.request_id && x.body === 'msg.dismissed');
    expect(m.params.preset).toBe(false);
  });

  it('pass: changes team, returns to received, tells the guest; food cannot be passed', async () => {
    const r = await create(sA, 'errand', 'Fix the lamp');
    await staff(w.A.waiter, 'padh_accept', [r.request_id, 1]);
    const out = await staff(w.A.waiter, 'padh_pass', [r.request_id, 2, 'maintenance']);
    expect(out).toMatchObject({ status: 'received', team: 'maintenance', version: 3 });
    expect((await row(r.request_id)).accepted_by).toBeNull();
    expect((await msgs(sA)).some((x: any) => x.body === 'msg.passed' && x.params.team === 'Maintenance')).toBe(true);
    expect((await staffErr(w.A.waiter, 'padh_pass', [r.request_id, 3, 'maintenance']))?.code).toBe('GM010'); // same team
    expect((await staffErr(w.A.waiter, 'padh_pass', [r.request_id, 3, 'janitor']))?.code).toBe('GM015');
    await db.admin(`update public.requests set type = 'food', team = 'kitchen' where id = $1`, [r.request_id]);
    expect((await staffErr(w.A.waiter, 'padh_pass', [r.request_id, 3, 'concierge']))?.code).toBe('GM010');
  });

  it('complete: only after accept; help requests use resolve instead', async () => {
    const r = await create(sA, 'plan', 'My plan: 3 stops');
    expect((await staffErr(w.A.waiter, 'padh_complete', [r.request_id, 1]))?.code).toBe('GM010');
    await staff(w.A.waiter, 'padh_accept', [r.request_id, 1]);
    await staff(w.A.waiter, 'padh_complete', [r.request_id, 2]);
    const q = await row(r.request_id);
    expect(q.status).toBe('completed');
    expect(q.completed_at).not.toBeNull();
    const h = await create(sA, 'help', 'Noise');
    await staff(w.A.waiter, 'padh_accept', [h.request_id, 1]);
    expect((await staffErr(w.A.waiter, 'padh_complete', [h.request_id, 2]))?.code).toBe('GM010');
  });

  it('terminal states cannot be moved again', async () => {
    const r = await create(sA, 'checkout', 'Luggage help');
    await staff(w.A.waiter, 'padh_dismiss', [r.request_id, 1, 'will_call']);
    for (const fn of ['padh_accept', 'padh_complete']) expect((await staffErr(w.A.waiter, fn, [r.request_id, 2]))?.code, fn).toBe('GM010');
  });
});

describe('help: resolve and the "not yet" escalation', () => {
  it('resolve -> guest says not yet -> new urgent request to the Manager linked to the original, only once', async () => {
    const h = await create(sA, 'help', 'Hot water', null, false);
    await staff(w.A.waiter, 'padh_resolve', [h.request_id, 1, 'fixed']);
    const q = await row(h.request_id);
    expect([q.status, q.resolution]).toEqual(['completed', 'fixed']);
    const ask = (await msgs(sA)).find((x: any) => x.request_id === h.request_id && x.body === 'msg.resolved');
    expect(ask.chips).toEqual(['resolved_yes', 'resolved_no']);

    // another guest cannot answer for this one
    expect((await svcErr('padh_guest_confirm_resolved', [sA2, h.request_id, false]))?.code).toBe('GM012');
    const out = await svc<any>('padh_guest_confirm_resolved', [sA, h.request_id, false]);
    expect(out.escalated).toBe(true);
    const n = await row(out.new_request_id);
    expect([n.team, n.urgent, n.parent_request_id, n.status]).toEqual(['manager', true, h.request_id, 'received']);
    expect((await msgs(sA)).some((x: any) => x.body === 'msg.escalated')).toBe(true);
    expect((await svcErr('padh_guest_confirm_resolved', [sA, h.request_id, false]))?.code).toBe('GM010');
  });

  it('resolve then "yes" just closes it; bad outcomes and non-help types are refused', async () => {
    const h = await create(sA, 'help', 'TV remote');
    expect((await staffErr(w.A.waiter, 'padh_resolve', [h.request_id, 1, 'magic']))?.code).toBe('GM015');
    await staff(w.A.waiter, 'padh_resolve', [h.request_id, 1, 'replacement_sent']);
    expect((await svc<any>('padh_guest_confirm_resolved', [sA, h.request_id, true])).escalated).toBe(false);
    const c = await create(sA, 'cab', 'Cab');
    expect((await staffErr(w.A.waiter, 'padh_resolve', [c.request_id, 1, 'fixed']))?.code).toBe('GM010');
  });
});

describe('guest cancel and chat history', () => {
  it('cancel works only while received and only for the owner of the request', async () => {
    const r = await create(sA, 'late_checkout', 'Late check-out 2 PM');
    expect((await svcErr('padh_guest_cancel_request', [sA2, r.request_id]))?.code).toBe('GM012');
    await svc('padh_guest_cancel_request', [sA, r.request_id]);
    expect((await row(r.request_id)).status).toBe('cancelled');
    const r2 = await create(sA, 'late_checkout', 'Late check-out 3 PM');
    await staff(w.A.waiter, 'padh_accept', [r2.request_id, 1]);
    expect((await svcErr('padh_guest_cancel_request', [sA, r2.request_id]))?.code).toBe('GM010');
  });

  it('chat history is the guest\'s own, newest first, paginated', async () => {
    const list = await svc<any[]>('padh_guest_list_messages', [sA, null, 5]);
    expect(list.length).toBe(5);
    const dates = list.map((m) => +new Date(m.created_at));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    const older = await svc<any[]>('padh_guest_list_messages', [sA, list[4].created_at, 100]);
    expect(older.every((m) => +new Date(m.created_at) < +new Date(list[4].created_at))).toBe(true);
    const ended = await mkSession(w.A.rid, '303', 'Gone2', 'ended');
    expect((await svcErr('padh_guest_list_messages', [ended, null, 5]))?.code).toBe('GM009');
  });
});

describe('isolation and authorisation', () => {
  it('staff of hotel B cannot touch hotel A requests (looks like not found)', async () => {
    const r = await create(sA, 'cab', 'Cab for B test');
    for (const [fn, args] of [
      ['padh_accept', [r.request_id, 1]],
      ['padh_dismiss', [r.request_id, 1, 'not_available']],
      ['padh_pass', [r.request_id, 1, 'manager']],
      ['padh_complete', [r.request_id, 1]],
    ] as const)
      expect((await staffErr(w.B.manager, fn, [...args]))?.code, fn).toBe('GM012');
    expect((await row(r.request_id)).status).toBe('received');
  });

  it('kitchen can act only on kitchen requests; strangers and anon cannot act at all', async () => {
    const r = await create(sA, 'housekeeping', 'Soap');
    expect((await staffErr(w.A.kitchen, 'padh_accept', [r.request_id, 1]))?.code).toBe('GM011');
    expect((await staffErr(w.stranger, 'padh_accept', [r.request_id, 1]))?.code).toBe('GM011');
    expect((await db.asErr('anon', null, `select public.padh_accept($1, 1)`, [r.request_id]))?.code).toBe('42501');
    const f = await create(sA, 'errand', 'Pretend food');
    await db.admin(`update public.requests set type = 'food', team = 'kitchen' where id = $1`, [f.request_id]);
    expect(await staff(w.A.kitchen, 'padh_accept', [f.request_id, 1])).toMatchObject({ status: 'accepted' });
    expect((await staffErr(w.A.kitchen, 'padh_pass', [f.request_id, 2, 'concierge']))?.code).toBe('GM011');
  });

  it('a suspended hotel cannot process requests', async () => {
    const r = await create(sB, 'cab', 'Suspended test');
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.B.rid]);
    expect((await staffErr(w.B.owner, 'padh_accept', [r.request_id, 1]))?.code).toBe('GM001');
    expect((await svcErr('padh_guest_create_request', [sB, 'cab', 'x', null, false, idem()]))?.code).toBe('GM009');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.B.rid]);
  });

  it('guest functions are not callable by staff or anon; staff functions not by service_role', async () => {
    expect((await db.asErr('authenticated', w.A.owner, `select public.padh_guest_create_request($1,'cab','x',null,false,'abcdefgh')`, [sA]))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.padh_guest_list_messages($1,null,5)`, [sA]))?.code).toBe('42501');
    expect((await db.asErr('service_role', null, `select public.padh_accept($1, 1)`, [randomUUID()]))?.code).toBe('42501');
  });

  it('staff read only their hotel; kitchen sees only kitchen requests; messages hidden from kitchen', async () => {
    const seenA = await db.as<{ restaurant_id: string }>('authenticated', w.A.waiter, `select restaurant_id from public.requests`);
    expect(seenA.length).toBeGreaterThan(5);
    expect(seenA.every((r) => r.restaurant_id === w.A.rid)).toBe(true);
    const k = await db.as<{ team: string }>('authenticated', w.A.kitchen, `select team from public.requests`);
    expect(k.length).toBeGreaterThan(0);
    expect(k.every((r) => r.team === 'kitchen')).toBe(true);
    expect(await db.as('authenticated', w.A.kitchen, `select 1 from public.messages`)).toEqual([]);
    const ev = await db.as<any>('authenticated', w.A.kitchen, `select request_id from public.request_events`);
    const kids = new Set(k.length ? (await db.admin<any>(`select id from public.requests where team = 'kitchen' and restaurant_id = $1`, [w.A.rid])).map((x: any) => x.id) : []);
    expect(ev.every((e: any) => kids.has(e.request_id))).toBe(true);
    expect(await db.as('authenticated', w.stranger, `select 1 from public.requests`)).toEqual([]);
  });

  it('idempotency_key is not readable; no client write on requests, events or messages; events are append-only', async () => {
    expect((await db.asErr('authenticated', w.A.owner, `select idempotency_key from public.requests`))?.code).toBe('42501');
    expect((await db.asErr('authenticated', w.A.owner, `select * from public.requests`))?.code).toBe('42501');
    for (const sql of [
      `update public.requests set status = 'completed'`,
      `delete from public.requests`,
      `insert into public.messages (restaurant_id, session_id, direction, kind) values ('${w.A.rid}','${sA}','staff','staff_text')`,
      `update public.request_events set action = 'x'`,
      `delete from public.request_events`,
    ])
      expect((await db.asErr('authenticated', w.A.owner, sql))?.code, sql).toBe('42501');
    for (const sql of [`update public.request_events set action = 'x'`, `delete from public.request_events`])
      expect((await db.asErr('service_role', null, sql))?.code, sql).toBe('42501');
  });
});
