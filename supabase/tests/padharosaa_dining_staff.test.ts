import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
let sA: string, sB: string;
const idem = () => randomUUID().replace(/-/g, '');
const svc = async <T = any>(fn: string, args: unknown[]): Promise<T> =>
  (await db.as('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const svcErr = (fn: string, args: unknown[]) => db.asErr('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const staff = async <T = any>(uid: string, fn: string, args: unknown[]): Promise<T> =>
  (await db.as('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, args: unknown[]) => db.asErr('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const mk = async (rid: string, room: string, name: string) => {
  const r = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) on conflict (restaurant_id, number) do update set number = excluded.number returning id`, [rid, room]))[0]!.id;
  return (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash) values ($1,$2,$3,'+91','\\xdeadbeef','\\x02',$4) returning id`, [rid, r, name, Buffer.from(randomUUID())]))[0]!.id;
};
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const t of [w.A, w.B]) await svc('padh_admin_enable_hotel', [w.admin, t.rid, 'Asia/Kolkata']);
  sA = await mk(w.A.rid, '204', 'Anita');
  sB = await mk(w.B.rid, '204', 'Pierre');
});
afterAll(async () => db.close());

describe('food request and the delivery / takeaway decision', () => {
  it('guest creates a food request for the kitchen (idempotent); kitchen decides delivery; the guest is told', async () => {
    const k = idem();
    const a = await svc<any>('padh_guest_create_food', [sA, 'Dinner: 2 thali', null, k]);
    expect((await svc<any>('padh_guest_create_food', [sA, 'Dinner: 2 thali', null, k])).replayed).toBe(true);
    expect((await db.admin<any>(`select team, type from public.requests where id = $1`, [a.request_id]))[0]).toMatchObject({ team: 'kitchen', type: 'food' });
    const r = await staff<any>(w.A.kitchen, 'padh_set_handover', [a.request_id, a.version, 'deliver']);
    expect(r).toMatchObject({ handover: 'deliver', version: a.version + 1 });
    const msgs = await db.admin<any>(`select body from public.messages where request_id = $1 order by created_at, id`, [a.request_id]);
    expect(msgs.map((m: any) => m.body)).toContain('msg.handover_deliver');
    expect((await staffErr(w.A.kitchen, 'padh_set_handover', [a.request_id, a.version, 'takeaway']))?.code).toBe('GM019'); // stale version
    const r2 = await staff<any>(w.A.manager, 'padh_set_handover', [a.request_id, r.version, 'takeaway']);
    expect(r2.handover).toBe('takeaway');
  });

  it('with room dining off, delivery is refused and takeaway works; only a manager changes the switch', async () => {
    await staff(w.A.manager, 'padh_set_dining', [false]);
    const a = await svc<any>('padh_guest_create_food', [sA, 'Snacks', null, idem()]);
    expect((await staffErr(w.A.kitchen, 'padh_set_handover', [a.request_id, a.version, 'deliver']))?.code).toBe('GM015');
    expect((await staff<any>(w.A.kitchen, 'padh_set_handover', [a.request_id, a.version, 'takeaway'])).handover).toBe('takeaway');
    expect((await staff<any>(w.A.kitchen, 'padh_my_alerts', [])).room_dining).toBe(false);
    for (const uid of [w.A.kitchen, w.A.waiter, w.stranger]) expect((await staffErr(uid, 'padh_set_dining', [true]))?.code, uid).toBe('GM011');
    await staff(w.A.owner, 'padh_set_dining', [true]);
  });

  it('only food requests take a handover; other hotels and other roles are refused', async () => {
    const c = await svc<any>('padh_guest_create_request', [sA, 'cab', 'Cab', null, false, idem()]);
    expect((await staffErr(w.A.manager, 'padh_set_handover', [c.request_id, c.version, 'deliver']))?.code).toBe('GM010');
    const f = await svc<any>('padh_guest_create_food', [sA, 'Tea', null, idem()]);
    expect((await staffErr(w.B.manager, 'padh_set_handover', [f.request_id, f.version, 'deliver']))?.code).toBe('GM012');
    expect((await staffErr(w.A.kitchen, 'padh_set_handover', [f.request_id, f.version, 'bike']))?.code).toBe('GM015');
  });
});

describe('staff directory, mutes and problem alerts', () => {
  it('manager sets department / WhatsApp / head; phone format validated; other hotels cannot be touched', async () => {
    const d = await staff<any[]>(w.A.manager, 'padh_staff_directory', []);
    expect(d.length).toBeGreaterThan(2);
    await staff(w.A.manager, 'padh_staff_profile_set', [w.A.waiter, 'front_desk', '+91 98765-43210', true]);
    expect((await staff<any[]>(w.A.manager, 'padh_staff_directory', [])).find((x) => x.user_id === w.A.waiter)).toMatchObject({ department: 'front_desk', whatsapp: '+919876543210', is_head: true });
    expect((await staffErr(w.A.manager, 'padh_staff_profile_set', [w.A.waiter, 'front_desk', '98765', false]))?.code).toBe('GM015');
    expect((await staffErr(w.A.manager, 'padh_staff_profile_set', [w.A.waiter, 'spa', null, false]))?.code).toBe('GM015');
    expect((await staffErr(w.A.manager, 'padh_staff_profile_set', [w.B.waiter, 'front_desk', null, false]))?.code).toBe('GM012');
    for (const uid of [w.A.waiter, w.A.kitchen]) {
      expect((await staffErr(uid, 'padh_staff_directory', []))?.code, uid).toBeTruthy();
      expect((await staffErr(uid, 'padh_staff_profile_set', [w.A.waiter, 'kitchen', null, false]))?.code, uid).toBe('GM011');
    }
    expect(await db.asErr('authenticated', w.A.manager, `select * from public.staff_profiles`, [])).toBeTruthy(); // no direct table access
  });

  it('a problem queues WhatsApp alerts for the chosen team head and the reception head; muting stops only your own', async () => {
    const maint = w.A.kitchen; // any staff row can stand in as the maintenance head for this test
    await db.admin(`insert into public.staff_profiles (user_id, restaurant_id, department, whatsapp, is_head) values ($1,$2,'maintenance','+919811122233', true) on conflict (user_id) do update set department='maintenance', whatsapp='+919811122233', is_head=true`, [maint, w.A.rid]);
    const out = await svc<any>('padh_guest_create_help', [sA, 'ac_electrical', 'AC is dripping', true, idem()]);
    const q = (await db.admin<any>(`select team, notify_team, urgent, label from public.requests where id = $1`, [out.request_id]))[0];
    expect(q).toMatchObject({ team: 'front_desk', notify_team: 'maintenance', urgent: true, label: 'AC or electrical' });
    const n = await db.admin<any>(`select to_ref, template, channel, payload from public.notifications where payload->>'request_id' = $1 order by to_ref`, [out.request_id]);
    expect(n.map((x: any) => x.to_ref).sort()).toEqual([maint, w.A.waiter].sort());
    expect(n[0]).toMatchObject({ template: 'help_alert', channel: 'whatsapp' });
    expect(JSON.stringify(n)).not.toContain('+91'); // numbers are looked up at send time, never copied into the outbox

    await staff(w.A.waiter, 'padh_set_my_alert', ['front_desk', true]);
    const out2 = await svc<any>('padh_guest_create_help', [sA, 'noise', 'Loud music', false, idem()]);
    const n2 = await db.admin<any>(`select to_ref from public.notifications where payload->>'request_id' = $1`, [out2.request_id]);
    expect(n2).toEqual([]); // the only reception head muted front desk, and nobody heads another team here
    expect((await staff<any>(w.A.waiter, 'padh_my_alerts', [])).muted).toEqual(['front_desk']);
    await staff(w.A.waiter, 'padh_set_my_alert', ['front_desk', false]);
  });

  it('alert mutes are personal, validated and role-aware; categories are validated', async () => {
    expect((await staffErr(w.A.kitchen, 'padh_set_my_alert', ['front_desk', true]))?.code).toBe('GM011'); // kitchen sees only its own team
    expect((await staffErr(w.A.manager, 'padh_set_my_alert', ['spa', true]))?.code).toBe('GM015');
    await staff(w.A.manager, 'padh_set_my_alert', ['kitchen', true]);
    expect((await staff<any>(w.A.manager, 'padh_my_alerts', [])).muted).toEqual(['kitchen']);
    expect((await staff<any>(w.A.waiter, 'padh_my_alerts', [])).muted).toEqual([]); // someone else's mute is not mine
    expect((await svcErr('padh_guest_create_help', [sA, 'ghosts', null, false, idem()]))?.code).toBe('GM015');
    expect((await svcErr('padh_guest_create_help', [sB, 'noise', null, false, 'short']))?.code).toBe('GM015');
  });
});
