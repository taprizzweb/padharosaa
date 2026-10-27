import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, type World } from './helpers/fixtures';

// Front office billing (migrations 0065-0067): the hotel's own taxes and charges, check-in, the folio, payments, check-out and the invoice.
// The money is checked with numbers worked out by hand; every tax is a whole number of paise, rounded half up.
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
const day = async (n: number) => (await db.admin<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date + $1::int, 'YYYY-MM-DD') as d`, [n]))[0]!.d;

const rate: Record<string, string> = {};
const cat: Record<string, string> = {};
const room: Record<string, string> = {};
const stay: Record<string, string> = {};

async function checkin(uid: string, no: string, o: { rate?: number | null; out?: number; company?: string | null; gstin?: string | null; inter?: boolean | null; advance?: number; mode?: string | null; mobile?: string | null; guest?: string } = {}) {
  return asU(uid,
    `select public.padh_stay_checkin($1::uuid,$2,$3,'aadhaar','4321',2,$4,$5,$6::boolean,null,$7::int,$8::date,$9::int,$10) as r`,
    [room[no], o.guest ?? `Guest ${no}`, o.mobile === undefined ? '98765 43210' : o.mobile, o.company ?? null, o.gstin ?? null, o.inter ?? null, o.rate === undefined ? 320000 : o.rate, await day(o.out ?? 2), o.advance ?? 0, o.mode ?? null]);
}
const folio = (uid: string, no: string, checkout = false) => asU(uid, `select public.padh_folio($1::uuid,$2::boolean) as r`, [stay[no], checkout]);
const f = async (no: string) => (await folio(w.A.waiter, no)).folio;
const group = (fo: any, bp: number) => fo.tax_groups.find((g: any) => g.tax_bp === bp);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, true)`, [w.A.rid]);
  for (const no of ['204', '205', '206', '207', '208']) {
    room[no] = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) returning id`, [w.A.rid, no]))[0]!.id;
  }
});
afterAll(async () => db.close());

describe('setup: the hotel decides its own taxes and charges', () => {
  it('reception can read the setup, nobody else outside the front office can; only owner or manager change it', async () => {
    const b = await asU(w.A.waiter, `select public.padh_billing_get() as r`);
    expect(b.tax_rates).toEqual([]); // nothing is fixed: no rate exists until the hotel adds one
    expect(b.categories.map((c: any) => c.name)).toEqual(['Room rent', 'Food & beverage', 'Laundry', 'Other charges']);
    for (const uid of [w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_billing_get()`))?.code).toBe('GM011');
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_tax_rate_save(null,'GST 5%',500,true)`))?.code).toBe('GM011');
  });
  it('tax rates: validated, no duplicate names, a template of common rates to choose from', async () => {
    for (const call of [`select public.padh_tax_rate_save(null,'',500,true)`, `select public.padh_tax_rate_save(null,'X',10001,true)`, `select public.padh_tax_rate_save(null,'X',-1,true)`, `select public.padh_tax_rate_save(null,'X',500,null)`]) expect((await errU(w.A.owner, call))?.code).toBe('GM015');
    expect((await asU(w.A.owner, `select public.padh_tax_presets_add() as r`)).added).toBe(4);
    expect((await asU(w.A.manager, `select public.padh_tax_presets_add() as r`)).added).toBe(0);
    expect((await errU(w.A.owner, `select public.padh_tax_rate_save(null,'GST 5%',500,true)`))?.code).toBe('GM019');
    const b = await asU(w.A.owner, `select public.padh_billing_get() as r`);
    for (const t of b.tax_rates) rate[t.name] = t.id;
    for (const c of b.categories) cat[c.name] = c.id;
    expect(Object.keys(rate).sort()).toEqual(['GST 0%', 'GST 12%', 'GST 18%', 'GST 5%']);
  });
  it('categories take one tax each; the room and food categories cannot be switched off; another hotel\'s tax is refused', async () => {
    await asU(w.A.owner, `select public.padh_category_save($1::uuid,'Room rent','996311',$2::uuid,true) as r`, [cat['Room rent'], rate['GST 5%']]);
    await asU(w.A.owner, `select public.padh_category_save($1::uuid,'Food & beverage',null,$2::uuid,true) as r`, [cat['Food & beverage'], rate['GST 5%']]);
    expect((await errU(w.A.owner, `select public.padh_category_save($1::uuid,'Room rent',null,null,false)`, [cat['Room rent']]))?.code).toBe('GM020');
    expect((await errU(w.A.owner, `select public.padh_category_save($1::uuid,'Room rent','12',null,true)`, [cat['Room rent']]))?.code).toBe('GM015');
    const [foreign] = await db.admin<{ id: string }>(`insert into public.tax_rates (restaurant_id, name, rate_bp) values ($1,'Other hotel',900) returning id`, [w.B.rid]);
    expect((await errU(w.A.owner, `select public.padh_category_save(null,'Spa',null,$1::uuid,true)`, [foreign!.id]))?.code).toBe('GM015');
    const spa = await asU(w.A.owner, `select public.padh_category_save(null,'Spa',null,$1::uuid,true) as r`, [rate['GST 18%']]);
    cat['Spa'] = spa.id;
    expect((await errU(w.A.manager, `select public.padh_category_save(null,'Spa',null,null,true)`))?.code).toBe('GM019');
  });
  it('the room tax rule by nightly rate: lowest limit first, only the last slab may have no limit', async () => {
    const slab = (items: unknown) => errU(w.A.owner, `select public.padh_slabs_set($1)`, [JSON.stringify(items)]);
    expect((await slab([{ up_to_paise: 750000, tax_rate_id: rate['GST 5%'] }, { up_to_paise: 500000, tax_rate_id: rate['GST 18%'] }]))?.code).toBe('GM015');
    expect((await slab([{ up_to_paise: null, tax_rate_id: rate['GST 18%'] }, { up_to_paise: 750000, tax_rate_id: rate['GST 5%'] }]))?.code).toBe('GM015');
    expect((await slab([{ up_to_paise: 750000, tax_rate_id: '00000000-0000-0000-0000-000000000000' }]))?.code).toBe('GM015');
    expect((await errU(w.A.waiter, `select public.padh_slabs_set('[]')`))?.code).toBe('GM011');
    const ok = await asU(w.A.owner, `select public.padh_slabs_set($1) as r`, [JSON.stringify([{ up_to_paise: 750000, tax_rate_id: rate['GST 5%'] }, { up_to_paise: null, tax_rate_id: rate['GST 18%'] }])]);
    expect(ok).toEqual({ slabs: 2 });
    expect((await asU(w.A.waiter, `select public.padh_billing_get() as r`)).slabs).toHaveLength(2);
  });
  it('invoice details: the GSTIN must be valid; extra charges are validated', async () => {
    expect((await errU(w.A.owner, `select public.padh_legal_set('Hotel','NOTAGSTIN','Jaipur','INV',null,true)`))?.code).toBe('GM015');
    expect((await errU(w.A.owner, `select public.padh_legal_set('Hotel','08ABCDE1234F1Z5','Jaipur','bad prefix!',null,true)`))?.code).toBe('GM015');
    await asU(w.A.owner, `select public.padh_legal_set('Spice Garden Pvt Ltd','08abcde1234f1z5','Jaipur, Rajasthan','INV','Check-out time 11 am',true) as r`);
    expect((await asU(w.A.owner, `select public.padh_billing_get() as r`)).settings).toMatchObject({ gstin: '08ABCDE1234F1Z5', prefix: 'INV', round_off: true });
    expect((await errU(w.A.owner, `select public.padh_extra_save(null,'Service charge','percent',10001,'room',null,true)`))?.code).toBe('GM015');
    expect((await errU(w.A.owner, `select public.padh_extra_save(null,'X','weekly',100,'room',null,true)`))?.code).toBe('GM015');
    expect((await errU(w.A.waiter, `select public.padh_extra_save(null,'Service charge','percent',1000,'room',null,true)`))?.code).toBe('GM011');
  });
});

describe('check-in', () => {
  it('rejects bad details and a room that is already taken; reception can check in; the guest gets a 4-digit stay code', async () => {
    expect((await errU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'A',null,null,null,1,null,null,null,null,100,$2::date,0,null)`, [room['204'], await day(1)]))?.code).toBe('GM015'); // name too short
    expect((await errU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Anita',null,null,null,1,null,null,null,null,100,$2::date,0,null)`, [room['204'], await day(0)]))?.code).toBe('GM015'); // must stay at least a night
    expect((await errU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Anita','12',null,null,1,null,null,null,null,100,$2::date,0,null)`, [room['204'], await day(1)]))?.code).toBe('GM015'); // short mobile
    expect((await errU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Anita',null,null,null,1,null,null,null,null,100,$2::date,5000,null)`, [room['204'], await day(1)]))?.code).toBe('GM015'); // advance with no mode
    expect((await errU(w.A.kitchen, `select public.padh_stay_checkin($1::uuid,'Anita',null,null,null,1,null,null,null,null,100,$2::date,0,null)`, [room['204'], await day(1)]))?.code).toBe('GM011');
    const a = await checkin(w.A.waiter, '204', { advance: 200000, mode: 'upi' });
    stay['204'] = a.stay_id;
    expect(a.stay_code).toMatch(/^[0-9]{4}$/);
    expect((await errU(w.A.manager, `select public.padh_stay_checkin($1::uuid,'Anita Two',null,null,null,1,null,null,null,null,100,$2::date,0,null)`, [room['204'], await day(1)]))?.code).toBe('GM019');
    const row = (await db.admin<any>(`select mobile, id_type, id_last4, rate_paise from public.stays where id = $1`, [stay['204']]))[0];
    expect(row).toMatchObject({ mobile: '9876543210', id_type: 'aadhaar', id_last4: '4321', rate_paise: 320000 });
  });
  it('the room type rate is used when none is typed; a company GSTIN from another state makes the bill IGST', async () => {
    const t = await asU(w.A.owner, `select public.padh_room_type_save(null,'Deluxe',350000,3,true) as r`);
    await asU(w.A.owner, `select public.padh_room_set_type($1::uuid,$2::uuid) as r`, [room['208'], t.id]);
    const s = await checkin(w.A.waiter, '208', { rate: null, out: 1 });
    stay['208'] = s.stay_id;
    expect((await f('208')).stay).toMatchObject({ rate_paise: 350000, room_type: 'Deluxe', nights: 1 });
    const c = await checkin(w.A.waiter, '206', { rate: 100000, out: 1, company: 'Acme Ltd', gstin: '27ABCDE1234F1Z5' });
    stay['206'] = c.stay_id;
    expect((await f('206')).stay.inter_state).toBe(true);
  });
});

describe('the folio: every amount is whole paise, tax is on the total per rate', () => {
  it('room 204: 2 nights at ₹3,200 and ₹620 of room service, both at 5%: tax 17,550 + 17,550 paise', async () => {
    const [t] = await db.admin<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1, 'Room 204', 'room') returning qr_token`, [w.A.rid]);
    const mk = async () => {
      const no = (await placeOrder(db, w.A, { token: t!.qr_token }, [{ item_id: w.A.chai, qty: 1 }])).order_no;
      await db.admin(`update public.orders set status = 'served' where restaurant_id = $1 and order_no = $2`, [w.A.rid, no]); // so the next one is not "too many pending"
      return no;
    };
    const paid = await mk(); const cancelled = await mk(); const old = await mk(); const billed = await mk(); const undecided = await mk();
    await db.admin(`update public.orders set total_paise = 62000, pay_method = 'room_bill' where restaurant_id = $1 and order_no = $2`, [w.A.rid, billed]);
    await db.admin(`update public.orders set total_paise = 99900, pay_method = 'pay_now' where restaurant_id = $1 and order_no = $2`, [w.A.rid, paid]);
    await db.admin(`update public.orders set total_paise = 99900, pay_method = 'room_bill', status = 'cancelled', cancel_reason = 'x' where restaurant_id = $1 and order_no = $2`, [w.A.rid, cancelled]);
    await db.admin(`update public.orders set total_paise = 99900, pay_method = 'room_bill', created_at = now() - interval '3 days' where restaurant_id = $1 and order_no = $2`, [w.A.rid, old]); // a guest before this stay
    await db.admin(`update public.orders set total_paise = 99900, pay_method = null where restaurant_id = $1 and order_no = $2`, [w.A.rid, undecided]); // the guest has not chosen yet
    const fo = await f('204');
    expect(fo.stay.nights).toBe(2);
    // the order shows dish by dish (the chai, then the rest of the order's total as "other"); together they equal the order
    expect(fo.lines.map((l: any) => [l.src, l.amount_paise])).toEqual([['room', 640000], ['order', 3000], ['order', 59000]]);
    expect(group(fo, 500)).toMatchObject({ taxable_paise: 702000, cgst_paise: 17550, sgst_paise: 17550, igst_paise: 0, tax_paise: 35100 });
    expect(fo).toMatchObject({ subtotal_paise: 702000, tax_paise: 35100, round_off_paise: 0, total_paise: 737100, paid_paise: 200000, balance_paise: 537100 });
  });
  it('a charge added at the desk takes the tax of its category; changing the category tax changes the folio; a voided charge no longer counts', async () => {
    await asU(w.A.waiter, `select public.padh_folio_add($1::uuid,$2::uuid,'Laundry · 5 shirts',1,25000) as r`, [stay['204'], cat['Laundry']]);
    let fo = await f('204');
    expect(group(fo, 0)).toMatchObject({ taxable_paise: 25000, tax_paise: 0 }); // no tax chosen for Laundry yet
    expect(fo.total_paise).toBe(762100);
    await asU(w.A.owner, `select public.padh_category_save($1::uuid,'Laundry',null,$2::uuid,true) as r`, [cat['Laundry'], rate['GST 18%']]);
    fo = await f('204');
    expect(group(fo, 1800)).toMatchObject({ taxable_paise: 25000, cgst_paise: 2250, sgst_paise: 2250, tax_paise: 4500 });
    expect(fo).toMatchObject({ subtotal_paise: 727000, tax_paise: 39600, total_paise: 766600 });
    const line = (await folio(w.A.waiter, '204')).lines[0].id;
    expect((await errU(w.A.waiter, `select public.padh_folio_void($1::uuid,'')`, [line]))?.code).toBe('GM014');
    await asU(w.A.waiter, `select public.padh_folio_void($1::uuid,'entered by mistake') as r`, [line]);
    expect((await f('204')).total_paise).toBe(737100);
    expect((await errU(w.A.waiter, `select public.padh_folio_void($1::uuid,'again')`, [line]))?.code).toBe('GM012'); // already crossed out
    await asU(w.A.waiter, `select public.padh_folio_add($1::uuid,$2::uuid,'Laundry · 5 shirts',1,25000) as r`, [stay['204'], cat['Laundry']]);
    expect((await f('204')).total_paise).toBe(766600);
    expect((await errU(w.A.waiter, `select public.padh_folio_add($1::uuid,$2::uuid,'x',1,0)`, [stay['204'], cat['Laundry']]))?.code).toBe('GM015'); // zero
    expect((await errU(w.A.waiter, `select public.padh_folio_add($1::uuid,$2::uuid,'x',100,10)`, [stay['204'], cat['Laundry']]))?.code).toBe('GM015'); // quantity
    expect((await errU(w.A.kitchen, `select public.padh_folio_add($1::uuid,$2::uuid,'x',1,10)`, [stay['204'], cat['Laundry']]))?.code).toBe('GM011');
  });
  it('rounding: ₹999.50 for a night at 5% = 2,499 + 2,499 paise of tax; the total is rounded to the rupee and the difference is shown', async () => {
    const s = await checkin(w.A.waiter, '205', { rate: 99950, out: 1 });
    stay['205'] = s.stay_id;
    const fo = await f('205');
    expect(group(fo, 500)).toMatchObject({ taxable_paise: 99950, cgst_paise: 2499, sgst_paise: 2499, tax_paise: 4998 });
    expect(fo).toMatchObject({ subtotal_paise: 99950, tax_paise: 4998, round_off_paise: -48, total_paise: 104900 });
  });
  it('the room tax follows the nightly rate: up to ₹7,500 at 5%, above at 18%; with the rule off the room category\'s own tax is used', async () => {
    const s = await checkin(w.A.waiter, '207', { rate: 800000, out: 1 });
    stay['207'] = s.stay_id;
    expect(group(await f('207'), 1800)).toMatchObject({ taxable_paise: 800000, cgst_paise: 72000, sgst_paise: 72000, tax_paise: 144000 });
    await asU(w.A.owner, `select public.padh_slabs_set('[]') as r`);
    expect(group(await f('207'), 500)).toMatchObject({ taxable_paise: 800000, tax_paise: 40000 });
    await asU(w.A.owner, `select public.padh_slabs_set($1) as r`, [JSON.stringify([{ up_to_paise: 750000, tax_rate_id: rate['GST 5%'] }, { up_to_paise: null, tax_rate_id: rate['GST 18%'] }])]);
    expect(group(await f('207'), 1800).tax_paise).toBe(144000);
  });
  it('another state: the same 5% is one IGST amount, not CGST + SGST', async () => {
    const fo = await f('206');
    expect(group(fo, 500)).toMatchObject({ taxable_paise: 100000, cgst_paise: 0, sgst_paise: 0, igst_paise: 5000, tax_paise: 5000 });
    expect(fo.total_paise).toBe(105000);
  });
  it('extra charges: a percent of the room (taxed), a fee per night (no tax); switching one off removes it', async () => {
    const svc = await asU(w.A.owner, `select public.padh_extra_save(null,'Service charge','percent',1000,'room',$1::uuid,true) as r`, [rate['GST 18%']]);
    const fee = await asU(w.A.owner, `select public.padh_extra_save(null,'Tourism fee','per_night',5000,'all',null,true) as r`);
    const fo = await f('204'); // room 640000 -> service charge 64000 (taxed 18%), fee 2 nights x 5000
    expect(fo.lines.filter((l: any) => l.src === 'extra').map((l: any) => [l.description, l.amount_paise, l.tax_bp])).toEqual([['Service charge', 64000, 1800], ['Tourism fee', 10000, 0]]);
    expect(group(fo, 1800)).toMatchObject({ taxable_paise: 89000, tax_paise: 2 * Math.floor((89000 * 1800 + 10000) / 20000) }); // laundry 25000 + service charge 64000
    await asU(w.A.owner, `select public.padh_extra_save($1::uuid,'Service charge','percent',1000,'room',$2::uuid,false) as r`, [svc.id, rate['GST 18%']]);
    await asU(w.A.owner, `select public.padh_extra_save($1::uuid,'Tourism fee','per_night',5000,'all',null,false) as r`, [fee.id]);
    expect((await f('204')).total_paise).toBe(766600);
  });
});

describe('nights', () => {
  it('leaving early counts fewer nights, staying past the planned day counts more', async () => {
    const r = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'210') returning id`, [w.A.rid]))[0]!.id;
    room['210'] = r;
    stay['210'] = (await checkin(w.A.waiter, '210', { rate: 100000, out: 3 })).stay_id;
    expect((await f('210')).stay.nights).toBe(3);
    expect((await folio(w.A.waiter, '210', true)).folio.stay.nights).toBe(1); // "if the guest leaves now"
    await db.admin(`update public.stays set check_in_at = check_in_at - interval '5 days' where id = $1`, [stay['210']]);
    expect((await f('210')).stay.nights).toBe(8); // planned: 5 days ago until 3 days from now
    expect((await folio(w.A.waiter, '210', true)).folio.stay.nights).toBe(5);
    await db.admin(`update public.stays set check_out_on = (now() at time zone 'Asia/Kolkata')::date - 1 where id = $1`, [stay['210']]);
    expect((await f('210')).stay.nights).toBe(5); // already past the planned day: counted to today
    expect((await f('210')).total_paise).toBe(5 * 100000 + 2 * Math.floor((5 * 100000 * 500 + 10000) / 20000));
  });
});

describe('payments and check-out', () => {
  it('payments add up; a refund cannot be more than was paid; reception and manager can record them, the kitchen cannot', async () => {
    expect((await errU(w.A.waiter, `select public.padh_payment_add($1::uuid,'payment','cheque',100,null)`, [stay['204']]))?.code).toBe('GM015');
    expect((await errU(w.A.waiter, `select public.padh_payment_add($1::uuid,'refund','cash',300000,null)`, [stay['204']]))?.code).toBe('GM015'); // only 200000 was paid
    expect((await errU(w.A.kitchen, `select public.padh_payment_add($1::uuid,'payment','cash',100,null)`, [stay['204']]))?.code).toBe('GM011');
    await asU(w.A.waiter, `select public.padh_payment_add($1::uuid,'payment','cash',600000,'receipt 17') as r`, [stay['204']]);
    await asU(w.A.manager, `select public.padh_payment_add($1::uuid,'refund','cash',33400,'change given back') as r`, [stay['204']]);
    const fo = await f('204');
    expect(fo.paid_paise).toBe(200000 + 600000 - 33400);
    expect(fo.balance_paise).toBe(766600 - 766600);
  });
  it('check-out with money still due changes nothing: no invoice, no used invoice number, the guest stays in', async () => {
    await db.admin(`update public.stays set check_in_at = check_in_at - interval '1 day' where id = $1`, [stay['205']]);
    expect((await errU(w.A.waiter, `select public.padh_stay_checkout($1::uuid)`, [stay['205']]))?.code).toBe('GM026');
    expect((await db.admin<any>(`select status from public.stays where id = $1`, [stay['205']]))[0].status).toBe('in_house');
    expect(await db.admin(`select 1 from public.invoices where stay_id = $1`, [stay['205']])).toEqual([]);
    expect(await db.admin(`select 1 from public.invoice_counters where restaurant_id = $1`, [w.A.rid])).toEqual([]);
  });
  it('the old quick check-out refuses a room with a guest checked in; a room with no stay still works as before', async () => {
    expect((await errU(w.A.waiter, `select public.padh_checkout_room($1::uuid)`, [room['204']]))?.code).toBe('GM027');
    const free = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'209') returning id`, [w.A.rid]))[0]!.id;
    expect((await asU(w.A.waiter, `select public.padh_checkout_room($1::uuid) as r`, [free])).room).toBe('209');
  });
  it('settled stays check out; invoice numbers run 0001, 0002 without gaps; the invoice is a frozen copy', async () => {
    // the guests have now stayed their nights (room 204 two, room 205 one): nights are counted up to the day of check-out
    await db.admin(`update public.stays set check_in_at = check_in_at - interval '2 days' where id = $1`, [stay['204']]);
    const a = await asU(w.A.waiter, `select public.padh_stay_checkout($1::uuid) as r`, [stay['204']]);
    expect(a.invoice_number).toMatch(/^INV\/\d{4}-\d{2}\/0001$/);
    await asU(w.A.waiter, `select public.padh_payment_add($1::uuid,'payment','upi',104900,null) as r`, [stay['205']]);
    const b = await asU(w.A.manager, `select public.padh_stay_checkout($1::uuid) as r`, [stay['205']]);
    expect(b.invoice_number).toMatch(/^INV\/\d{4}-\d{2}\/0002$/);
    const inv = await asU(w.A.waiter, `select public.padh_invoice_get($1::uuid) as r`, [stay['204']]);
    expect(inv.hotel).toMatchObject({ name: expect.any(String), legal_name: 'Spice Garden Pvt Ltd', gstin: '08ABCDE1234F1Z5', address: 'Jaipur, Rajasthan', terms: 'Check-out time 11 am' });
    expect(inv.folio).toMatchObject({ total_paise: 766600, tax_paise: 39600, subtotal_paise: 727000 });
    // later changes to the hotel's rates or details never touch an issued invoice
    await asU(w.A.owner, `select public.padh_tax_rate_save($1::uuid,'GST 5%',1200,true) as r`, [rate['GST 5%']]);
    await asU(w.A.owner, `select public.padh_legal_set('Renamed Hotel','27ABCDE1234F1Z5','Mumbai','INV',null,true) as r`);
    const again = await asU(w.A.waiter, `select public.padh_invoice_get($1::uuid) as r`, [stay['204']]);
    expect(again.folio.total_paise).toBe(766600);
    expect(again.hotel.legal_name).toBe('Spice Garden Pvt Ltd');
    expect((await asU(w.A.waiter, `select public.padh_folio($1::uuid) as r`, [stay['204']])).invoice.number).toBe(a.invoice_number);
    await asU(w.A.owner, `select public.padh_tax_rate_save($1::uuid,'GST 5%',500,true) as r`, [rate['GST 5%']]);
    await asU(w.A.owner, `select public.padh_legal_set('Spice Garden Pvt Ltd','08ABCDE1234F1Z5','Jaipur, Rajasthan','INV','Check-out time 11 am',true) as r`);
  });
  it('after check-out: the stay is closed to new charges and payments, the room\'s guests are signed out, the lists are right', async () => {
    expect((await errU(w.A.waiter, `select public.padh_folio_add($1::uuid,$2::uuid,'x',1,100)`, [stay['204'], cat['Laundry']]))?.code).toBe('GM012');
    expect((await errU(w.A.waiter, `select public.padh_payment_add($1::uuid,'payment','cash',100,null)`, [stay['204']]))?.code).toBe('GM012');
    expect((await errU(w.A.waiter, `select public.padh_stay_checkout($1::uuid)`, [stay['204']]))?.code).toBe('GM019');
    expect((await db.admin<any>(`select count(*)::int as n from public.stay_codes where room_id = $1 and (valid_until is null or valid_until > now())`, [room['204']]))[0].n).toBe(0);
    const inHouse = await asU(w.A.waiter, `select public.padh_stays_list('in_house') as r`);
    expect(inHouse.every((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(x.check_out_on) && Number(x.nights) >= 1)).toBe(true); // the screen shows these: they were once empty and crashed it
    expect(inHouse.map((s: any) => s.room).sort()).toEqual(['206', '207', '208', '210']);
    const out = await asU(w.A.waiter, `select public.padh_stays_list('checked_out') as r`);
    expect(out.map((s: any) => [s.room, s.invoice_number.endsWith('0001') || s.invoice_number.endsWith('0002')])).toEqual([['204', true], ['205', true]]);
  });
  it('another hotel can see nothing of these stays', async () => {
    for (const call of [`select public.padh_folio($1::uuid)`, `select public.padh_invoice_get($1::uuid)`, `select public.padh_stay_checkout($1::uuid)`]) {
      expect(await errU(w.B.owner, call, [stay['206']])).toBeTruthy();
    }
    expect((await errU(w.B.owner, `select public.padh_payment_add($1::uuid,'payment','cash',100,null)`, [stay['206']]))).toBeTruthy();
  });
});
