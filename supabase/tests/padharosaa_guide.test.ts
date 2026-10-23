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
const mk = async (rid: string, room: string, name: string, lang = 'en') => {
  const r = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) on conflict (restaurant_id, number) do update set number = excluded.number returning id`, [rid, room]))[0]!.id;
  return (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, language) values ($1,$2,$3,'+91','\\xdeadbeef','\\x02',$4,$5) returning id`, [rid, r, name, Buffer.from(randomUUID()), lang]))[0]!.id;
};
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const t of [w.A, w.B]) await svc('padh_admin_enable_hotel', [w.admin, t.rid, 'Asia/Kolkata']);
  sA = await mk(w.A.rid, '204', 'Anita', 'hi');
  sB = await mk(w.B.rid, '204', 'Pierre');
});
afterAll(async () => db.close());

describe('guide: drafts stay hidden until the manager publishes', () => {
  it('hotel location is set by owner or manager only and must be a valid pair', async () => {
    await staff(w.A.manager, 'padh_set_location', [26.9124, 75.7873]);
    expect((await staff<any>(w.A.manager, 'padh_guide_manage', [])).location).toEqual({ lat: 26.9124, lng: 75.7873 });
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await staffErr(uid, 'padh_set_location', [1, 1]))?.code, uid).toBe('GM011');
    expect((await staffErr(w.A.manager, 'padh_set_location', [26.9, null]))?.code).toBe('GM015');
    expect((await staffErr(w.A.manager, 'padh_set_location', [91, 10]))?.code).toBe('GM015');
  });

  it('a map or AI draft is not shown to guests; publishing it makes it live and stamps who verified it', async () => {
    const d = await staff<any>(w.A.manager, 'padh_guide_save', [{ category: 'place', name: 'Amer Fort', description_en: 'A hilltop fort.', description_hi: 'पहाड़ी पर किला।', lat: 26.9855, lng: 75.8513, source: 'osm' }]);
    expect(d).toMatchObject({ active: false, needs_review: true });
    expect((await svc<any>('padh_guest_guide', [sA])).items).toEqual([]);
    const pub = await staff<any>(w.A.manager, 'padh_guide_save', [{ id: d.id, category: 'place', name: 'Amer Fort', description_en: 'A hilltop fort.', description_hi: 'पहाड़ी पर किला।', lat: 26.9855, lng: 75.8513, publish: true }]);
    expect(pub).toMatchObject({ active: true, needs_review: false });
    const g = await svc<any>('padh_guest_guide', [sA]);
    expect(g.items).toHaveLength(1);
    expect(g.items[0]).toMatchObject({ name: 'Amer Fort', description: 'पहाड़ी पर किला।', lat: 26.9855 }); // Hindi guest gets Hindi text
    expect((await svc<any>('padh_guest_guide', [sB])).items).toEqual([]); // another hotel sees nothing of it
    const row = (await db.admin<any>(`select source, verified_by, last_verified_at is not null as v from public.guide_items where id = $1`, [d.id]))[0];
    expect(row).toMatchObject({ source: 'osm', verified_by: w.A.manager, v: true });
  });

  it('a manual item can go straight live; a draft cannot be switched on without publishing; archive hides it', async () => {
    const m = await staff<any>(w.A.owner, 'padh_guide_save', [{ category: 'food', name: 'Lassi at Lassiwala', description_en: 'Thick, cold lassi.', active: true }]);
    expect(m).toMatchObject({ active: true, needs_review: false });
    const d = await staff<any>(w.A.manager, 'padh_guide_save', [{ category: 'craft', name: 'Blue pottery', source: 'ai_draft' }]);
    const tryOn = await staff<any>(w.A.manager, 'padh_guide_save', [{ id: d.id, category: 'craft', name: 'Blue pottery', source: 'ai_draft', active: true, needs_review: true }]);
    expect(tryOn.active).toBe(false);
    expect((await svc<any>('padh_guest_guide', [sA])).items.map((i: any) => i.name)).not.toContain('Blue pottery');
    await staff(w.A.manager, 'padh_guide_archive', [m.id]);
    expect((await svc<any>('padh_guest_guide', [sA])).items.map((i: any) => i.name)).not.toContain('Lassi at Lassiwala');
    expect((await staff<any>(w.A.manager, 'padh_guide_manage', [])).items.map((i: any) => i.name)).not.toContain('Lassi at Lassiwala');
    expect((await staffErr(w.B.manager, 'padh_guide_archive', [d.id]))?.code).toBe('GM012'); // another hotel
  });

  it('validation and permissions', async () => {
    for (const bad of [{ category: 'museum', name: 'x' }, { category: 'place', name: '' }, { category: 'place', name: 'x', lat: 10 }, { category: 'place', name: 'x', link_url: 'http://insecure.example' },
                       { category: 'place', name: 'x', description_en: 'y'.repeat(601) }, { category: 'place', name: 'x', source: 'google' }]) {
      expect((await staffErr(w.A.manager, 'padh_guide_save', [bad]))?.code, JSON.stringify(bad)).toBe('GM015');
    }
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await staffErr(uid, 'padh_guide_save', [{ category: 'tip', name: 'x' }]))?.code, uid).toBe('GM011');
    expect((await staffErr(w.A.manager, 'padh_guide_save', [{ id: randomUUID(), category: 'tip', name: 'x' }]))?.code).toBe('GM012');
    expect((await svcErr('padh_guest_guide', [randomUUID()]))?.code).toBe('GM009');
  });
});

describe('itineraries and the guest plan', () => {
  it('manager saves an itinerary with stops; removed stops are switched off; guests see only active ones', async () => {
    const it = await staff<any>(w.A.manager, 'padh_itinerary_save', [{ name: 'The 48-Hour Classic', tagline: 'Palaces and lassi', active: true, stops: [
      { when_label: 'Day 1 · 9:00', name: 'Amer Fort', note: 'Go early', lat: 26.9855, lng: 75.8513 }, { when_label: 'Day 1 · 2:00', name: 'City Palace' }, { when_label: 'Day 2 · 8:00', name: 'Hawa Mahal' }] }]);
    let m = (await staff<any>(w.A.manager, 'padh_guide_manage', [])).itineraries.find((x: any) => x.id === it.id);
    expect(m.stops.map((s: any) => s.name)).toEqual(['Amer Fort', 'City Palace', 'Hawa Mahal']);
    await staff(w.A.manager, 'padh_itinerary_save', [{ id: it.id, name: 'The 48-Hour Classic', stops: [{ id: m.stops[0].id, when_label: 'Day 1 · 9:30', name: 'Amer Fort' }, { when_label: 'Day 2', name: 'Jantar Mantar' }] }]);
    m = (await staff<any>(w.A.manager, 'padh_guide_manage', [])).itineraries.find((x: any) => x.id === it.id);
    expect(m.stops.map((s: any) => s.name)).toEqual(['Amer Fort', 'Jantar Mantar']);
    expect((await db.admin<any>(`select count(*)::int n from public.itinerary_stops where itinerary_id = $1`, [it.id]))[0].n).toBe(4); // old stops kept, switched off
    const g = (await svc<any>('padh_guest_guide', [sA])).itineraries[0];
    expect(g.stops.map((s: any) => s.name)).toEqual(['Amer Fort', 'Jantar Mantar']);
    expect((await svc<any>('padh_guest_guide', [sB])).itineraries).toEqual([]);
    expect((await staffErr(w.A.manager, 'padh_itinerary_save', [{ name: '', stops: [] }]))?.code).toBe('GM015');
    expect((await staffErr(w.B.manager, 'padh_itinerary_save', [{ id: it.id, name: 'x' }]))?.code).toBe('GM012');
  });

  it('guest builds a plan (add, de-duplicate, use an itinerary, remove) and sends it to the concierge once as a request', async () => {
    const itn = (await svc<any>('padh_guest_guide', [sA])).itineraries[0];
    let p = await svc<any>('padh_guest_plan_add', [sA, 'Albert Hall Museum', 'Day 1 · 5:00', 'Albert Hall Museum Jaipur', 26.9115, 75.8195]);
    p = await svc<any>('padh_guest_plan_add', [sA, 'albert hall museum', null, null, null, null]);
    expect(p.items).toHaveLength(1);
    p = await svc<any>('padh_guest_plan_use', [sA, itn.id]);
    expect(p.items.map((i: any) => i.name)).toEqual(['Albert Hall Museum', 'Amer Fort', 'Jantar Mantar']);
    p = await svc<any>('padh_guest_plan_remove', [sA, p.items[2].id]);
    expect(p.items.map((i: any) => i.name)).toEqual(['Albert Hall Museum', 'Amer Fort']);
    const sent = await svc<any>('padh_guest_plan_send', [sA, idem()]);
    const q = (await db.admin<any>(`select type, team, label, detail from public.requests where id = $1`, [sent.request_id]))[0];
    expect(q).toMatchObject({ type: 'plan', team: 'concierge', label: 'My day plan' });
    expect(q.detail).toContain('Albert Hall Museum');
    expect(q.detail).toContain('Day 1');
    expect((await svc<any>('padh_guest_plan', [sA])).requested_at).not.toBeNull();
    expect((await svcErr('padh_guest_plan_send', [sB, idem()]))?.code).toBe('GM015'); // empty plan
    expect((await svcErr('padh_guest_plan_use', [sB, itn.id]))?.code).toBe('GM012'); // another hotel's itinerary
    expect((await svcErr('padh_guest_plan_add', [sA, '', null, null, null, null]))?.code).toBe('GM015');
  });

  it('a plan holds at most 30 stops', async () => {
    const s = await mk(w.A.rid, '305', 'Ravi');
    for (let i = 0; i < 30; i++) await svc('padh_guest_plan_add', [s, `Stop ${i}`, null, null, null, null]);
    expect((await svcErr('padh_guest_plan_add', [s, 'One too many', null, null, null, null]))?.code).toBe('GM006');
  });
});

describe('buffet', () => {
  it('manager or reception sets the buffet for the coming days; the guest sees today and the next two; "none" needs no times', async () => {
    const days = (await staff<any>(w.A.manager, 'padh_buffet_list', [])).days;
    expect(days).toHaveLength(8);
    const today = days[0].date as string;
    await staff(w.A.manager, 'padh_buffet_set', [today, 'in_house', 'Thali night', '19:30', '22:30', 'Courtyard', 'Dal baati, gatte, ker sangri', 'Folk music']);
    const b = (await svc<any>('padh_guest_buffet', [sA])).days;
    expect(b[0]).toMatchObject({ mode: 'in_house', name: 'Thali night', start: '19:30', end: '22:30', venue: 'Courtyard', highlights: 'Dal baati, gatte, ker sangri' });
    const tomorrow = days[1].date as string;
    await staff(w.A.waiter, 'padh_buffet_set', [tomorrow, 'none', 'ignored', '10:00', '11:00', null, null, null]);
    expect((await svc<any>('padh_guest_buffet', [sA])).days[1]).toMatchObject({ mode: 'none', name: null, start: null });
    await staff(w.A.manager, 'padh_buffet_set', [today, 'outdoor', 'Garden dinner', '20:00', '23:00', 'Lawn', null, null]);
    expect((await db.admin<any>(`select version from public.buffets where restaurant_id = $1 and service_date = $2`, [w.A.rid, today]))[0].version).toBe(2);
    expect((await svc<any>('padh_guest_buffet', [sB])).days).toEqual([]);
    expect((await staffErr(w.A.manager, 'padh_buffet_set', [today, 'in_house', null, null, null, null, null, null]))?.code).toBe('GM015'); // a buffet needs a name and times
    expect((await staffErr(w.A.manager, 'padh_buffet_set', ['2020-01-01', 'none', null, null, null, null, null, null]))?.code).toBe('GM015');
    expect((await staffErr(w.A.kitchen, 'padh_buffet_set', [today, 'none', null, null, null, null, null, null]))?.code).toBe('GM011');
    expect((await staffErr(w.stranger, 'padh_buffet_list', []))?.code).toBe('GM011');
  });
});

describe('feedback', () => {
  it('a good rating invites a review; a poor one alerts the manager; once per request; only for the guest\'s own completed requests', async () => {
    const mkDone = async (label: string) => {
      const r = await svc<any>('padh_guest_create_request', [sA, 'cab', label, null, false, idem()]);
      await staff(w.A.waiter, 'padh_accept', [r.request_id, r.version]);
      const c = await staff<any>(w.A.waiter, 'padh_complete', [r.request_id, r.version + 1]);
      return c.request_id as string;
    };
    const open = await svc<any>('padh_guest_create_request', [sA, 'cab', 'Not done yet', null, false, idem()]);
    expect((await svcErr('padh_guest_feedback', [sA, open.request_id, 'great']))?.code).toBe('GM012'); // not completed
    const good = await mkDone('Cab to station');
    expect(await svc<any>('padh_guest_feedback', [sA, good, 'great'])).toEqual({ rating: 'great', review_invite: true });
    expect(await svc<any>('padh_guest_feedback', [sA, good, 'not_good'])).toMatchObject({ already: true });
    expect((await db.admin<any>(`select count(*)::int n from public.requests where type = 'feedback_alert'`))[0].n).toBe(0);
    const bad = await mkDone('Cab to airport');
    expect(await svc<any>('padh_guest_feedback', [sA, bad, 'not_good'])).toEqual({ rating: 'not_good', review_invite: false });
    const alert = (await db.admin<any>(`select team, urgent, label, parent_request_id from public.requests where type = 'feedback_alert'`))[0];
    expect(alert).toMatchObject({ team: 'manager', urgent: true, parent_request_id: bad });
    expect(alert.label).toContain('Cab to airport');
    expect((await svcErr('padh_guest_feedback', [sB, good, 'great']))?.code).toBe('GM012'); // someone else's request
    expect((await svcErr('padh_guest_feedback', [sA, good, 'amazing']))?.code).toBe('GM015');
  });
});
