import { expect, test, type Page } from '@playwright/test';
import { q } from './helpers';
import { DEMO_TOTP_SECRET, totp } from '../../supabase/tests/helpers/totp';
import { DEMO_PASSWORD } from '../../supabase/tests/helpers/local-supabase';

// Screenshots of the main screens for a visual review (not a normal test: it only runs when SHOTS=<folder> is set).
//   SHOTS=/tmp/shots npx tsx scripts/run-e2e.ts tests/e2e/screens.spec.ts --project=mobile
test.skip(!process.env.SHOTS, 'screenshots only on request');
test.describe.configure({ mode: 'serial' });
const OUT = process.env.SHOTS ?? '/tmp/shots';
const RID = `(select id from public.restaurants where slug = 'spice-garden')`;
const shot = async (page: Page, name: string, full = true) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); };

async function signIn(page: Page, email: string, landing: RegExp, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(new RegExp(`account/mfa|${landing.source}`), { timeout: 30_000 });
  if (page.url().includes('/account/mfa')) {
    await page.getByLabel('6-digit code').fill(totp(DEMO_TOTP_SECRET));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForURL(landing, { timeout: 30_000 });
  }
}

let link = '';
test('prepare a demo hotel with a guest, requests, an order and a buffet', async ({ browser }) => {
  await q(`delete from public.hotel_settings where restaurant_id = ${RID}`);
  const r = (await q<{ r: { qr_key: string } }>(`select public.padh_admin_enable_hotel((select user_id from public.platform_admins limit 1), ${RID}, 'Asia/Kolkata') as r`))[0]!.r;
  await q(`insert into public.rooms (restaurant_id, number) select ${RID}, n from unnest(array['101','102','103','104']) n on conflict do nothing`);
  await q(`update public.hotel_settings set reception_phone = '919828114008', wifi_name = 'Spice-Guest', review_link = 'https://g.page/r/spice/review' where restaurant_id = ${RID}`);
  link = `/padharosaa/spice-garden?k=${r.qr_key}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const g = await ctx.newPage();
  await g.goto(link);
  await shot(g, '01-guest-login');
  await g.getByLabel('Your name').fill('Saksham Verma');
  await g.getByRole('button', { name: 'Accept cookies' }).click();
  await g.getByLabel('Mobile number').fill('9828114008');
  await g.getByLabel('Room number').fill('101');
  await g.getByRole('button', { name: 'Enter' }).click();
  await expect(g.getByText('Namaste, Saksham')).toBeVisible();
  await shot(g, '02-guest-home');
  await g.getByText('Services', { exact: true }).click();
  await shot(g, '03-guest-services');
  await ctx.close();
  // requests of every kind, straight into the database as the guest's session
  const sid = (await q<{ id: string }>(`select id from public.guest_sessions where restaurant_id = ${RID} order by started_at desc limit 1`))[0]!.id;
  for (const [type, label, urgent] of [['help', 'Air conditioner not cooling', true], ['housekeeping', 'Housekeeping: Extra towels', false], ['cab', 'Cab', false], ['housekeeping', 'Housekeeping: Laundry pick-up', false], ['wake', 'Wake-up call', false]] as const)
    await q(`select public.padh_guest_create_request($1,$2,$3,null,$4,gen_random_uuid()::text)`, [sid, type, label, urgent]);
  await q(`insert into public.buffets (restaurant_id, service_date, mode, name, start_time, end_time, venue) values (${RID}, (now() at time zone 'Asia/Kolkata')::date, 'in_house', 'Rajasthani thali night', '19:30', '22:30', 'Courtyard') on conflict do nothing`);
});

test('guest screens', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const g = await ctx.newPage();
  await g.goto(link);
  await g.getByLabel('Your name').fill('Saksham Verma');
  await g.getByLabel('Mobile number').fill('9828114008');
  await g.getByLabel('Room number').fill('101');
  await g.getByRole('button', { name: 'Enter' }).click();
  await expect(g.getByText('Namaste, Saksham')).toBeVisible();
  await shot(g, '04-guest-home-with-buffet');
  await g.getByText('Dining', { exact: true }).click();
  await shot(g, '05-guest-dining');
  await ctx.close();
});

for (const [label, size] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]] as const) {
  test(`staff screens on a ${label}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: size });
    const p = await ctx.newPage();
    await signIn(p, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await p.waitForTimeout(800);
    await shot(p, `10-${label}-desk-reception`);
    await p.getByText('Check out a room').click();
    await shot(p, `11-${label}-desk-checkout-open`);
    await ctx.close();
    const c2 = await browser.newContext({ viewport: size });
    const o = await c2.newPage();
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.waitForTimeout(800);
    await shot(o, `20-${label}-owner-overview`);
    for (const [i, tab] of ['Start', 'Hotel', 'Orders & payment', 'Buffet & guide', 'Team'].entries()) {
      await o.getByRole('tab', { name: tab }).click();
      await shot(o, `2${i + 1}-${label}-owner-${tab.replace(/\W+/g, '-').toLowerCase()}`);
    }
    await o.goto('/padharosaa/desk');
    await shot(o, `30-${label}-desk-as-owner`);
    await o.getByRole('button', { name: 'Dark mode' }).click();
    await shot(o, `31-${label}-desk-dark`);
    await o.goto('/padharosaa/owner');
    await shot(o, `32-${label}-overview-dark`);
    await c2.close();
  });
}

// the hotel modules, with a few rooms, a booking and a price change in place
for (const [label, size] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]] as const) {
  test(`hotel modules on a ${label}`, async ({ browser }) => {
    await q(`insert into public.room_types (restaurant_id, name, rate_paise) values (${RID}, 'Deluxe', 300000), (${RID}, 'Suite', 520000) on conflict do nothing`);
    for (const [no, t] of [['101', 'Deluxe'], ['102', 'Deluxe'], ['103', 'Deluxe'], ['201', 'Suite'], ['202', 'Suite']] as const) {
      await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '${no}') on conflict do nothing`);
      await q(`update public.rooms set room_type_id = (select id from public.room_types where restaurant_id = ${RID} and name = '${t}') where restaurant_id = ${RID} and number = '${no}'`);
    }
    await q(`update public.rooms set hk_status = 'dirty' where restaurant_id = ${RID} and number = '102'`);
    const ctx = await browser.newContext({ viewport: size });
    const o = await ctx.newPage();
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    for (const [name, path] of [['rooms', 'rooms'], ['rates', 'rates'], ['channels', 'channels'], ['pos', 'pos'], ['inventory', 'inventory'], ['reports', 'reports']] as const) {
      await o.goto(`/padharosaa/${path}`);
      if (name === 'rates') await o.getByTestId('rate-types').getByRole('button').first().click();
      await shot(o, `40-${label}-${name}`);
    }
    await o.goto('/padharosaa/rooms');
    await o.getByRole('tab', { name: 'Calendar' }).click();
    await shot(o, `41-${label}-rooms-calendar`);
    await ctx.close();
  });
}
