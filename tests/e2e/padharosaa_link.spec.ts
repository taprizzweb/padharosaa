import { expect, test, type Page } from '@playwright/test';
import { q } from './helpers';
import { DEMO_TOTP_SECRET, totp } from '../../supabase/tests/helpers/totp';
import { DEMO_PASSWORD } from '../../supabase/tests/helpers/local-supabase';

// The guest link of a Padharosaa hotel: always visible to the platform admin, the owner and the manager; a new one needs the
// owner's (or admin's) own password. Runs against the real app and database, then switches the demo hotel off again so other specs see a plain restaurant.
test.describe.configure({ mode: 'serial' });
const RID = `(select id from public.restaurants where slug = 'spice-garden')`;
const linkOf = (page: Page) => page.getByLabel('Guest link').inputValue();

async function signIn(page: Page, email: string, landing: RegExp, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // a demo owner or manager lands straight on the page they asked for; an admin or an account with a second step goes through it first
  await page.waitForURL(new RegExp(`account/mfa|${landing.source}`), { timeout: 30_000 });
  if (page.url().includes('/account/mfa')) {
    await page.getByLabel('6-digit code').fill(totp(DEMO_TOTP_SECRET));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForURL(landing, { timeout: 30_000 });
  }
}

test.beforeAll(async () => { await q(`delete from public.hotel_settings where restaurant_id = ${RID}`); });
test.afterAll(async () => {
  await q(`delete from public.guide_items where restaurant_id = ${RID}`);
  await q(`delete from public.hotel_settings where restaurant_id in (${RID}, (select id from public.restaurants where slug = 'cafe-aroma'))`);
});

let first = '';
let second = '';

test('platform admin turns the hotel on from /admin and sees its guest link at once', async ({ page }) => {
  await signIn(page, 'admin@gotomenu.demo', /\/admin$/, '/admin');
  await page.getByRole('button', { name: 'Padharosaa hotel of Spice Garden' }).click();
  await page.getByRole('button', { name: 'Enable Padharosaa' }).click();
  await expect(page.getByLabel('Guest link')).toBeVisible();
  first = await linkOf(page);
  expect(first).toMatch(/\/padharosaa\/spice-garden\?k=[0-9a-f]{64}$/);
  await expect(page.getByRole('img', { name: 'Guest QR code' })).toBeVisible();
  // closing and opening again shows the very same link
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Padharosaa hotel of Spice Garden' }).click();
  await expect(page.getByLabel('Guest link')).toBeVisible();
  expect(await linkOf(page)).toBe(first);
});

test('the owner sees the same link; a new one needs their own password and a tick', async ({ page }) => {
  await signIn(page, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
  await expect(page.getByLabel('Guest link')).toBeVisible();
  expect(await linkOf(page)).toBe(first);
  await page.getByRole('button', { name: 'Create a new link…' }).click();
  const make = page.getByRole('button', { name: 'Create new link' });
  await expect(make).toBeDisabled(); // no password and no tick yet
  await page.getByLabel('Your password to confirm').fill('wrong-password');
  await page.getByRole('checkbox', { name: /old QR codes will stop working/ }).check();
  await make.click();
  await expect(page.getByText('That password was not right')).toBeVisible();
  expect(await linkOf(page)).toBe(first);
  await page.getByLabel('Your password to confirm').fill(DEMO_PASSWORD);
  await make.click();
  await expect(page.getByText('New guest link created')).toBeVisible();
  second = await linkOf(page);
  expect(second).not.toBe(first);
});

test('a guest: the old printed QR no longer works, the new one does', async ({ browser }) => {
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(first);
  await expect(g.getByText('Please scan the QR code')).toBeVisible();
  await g.goto(second);
  await expect(g.getByRole('heading', { name: 'Spice Garden' })).toBeVisible();
  await ctx.close();
});

test('the manager can see the link but cannot make a new one', async ({ page }) => {
  await signIn(page, 'manager@spice-garden.demo', /\/padharosaa\/manager$/, '/padharosaa/manager');
  await expect(page.getByLabel('Guest link')).toBeVisible();
  expect(await linkOf(page)).toBe(second);
  await expect(page.getByRole('button', { name: /Create a new link/ })).toHaveCount(0);
  await expect(page.getByText('Only the owner can create a new link')).toBeVisible();
  // and the manager can reach the one reception desk, where everything arrives
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await expect(nav.getByRole('link', { name: 'Reception desk (everything)' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Kitchen display' })).toHaveCount(0); // only when the hotel says it has one
  await nav.getByRole('link', { name: 'Reception desk (everything)' }).click();
  await expect(page).toHaveURL(/\/padharosaa\/desk$/);
  await expect(page.getByRole('button', { name: /^All \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true');
  // old addresses land on the desk too
  await page.goto('/padharosaa/housekeeping');
  await expect(page).toHaveURL(/\/padharosaa\/desk$/);
  // with a separate kitchen display switched on, the manager gets that screen as well
  await q(`update public.hotel_settings set kitchen_display = true where restaurant_id = ${RID}`);
  await page.goto('/padharosaa/desk');
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Kitchen display' }).click();
  await expect(page).toHaveURL(/\/padharosaa\/kitchen$/);
  await expect(page.getByRole('tab', { name: 'Live' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Sold out' })).toBeVisible();
  await q(`update public.hotel_settings set kitchen_display = false where restaurant_id = ${RID}`);
});

test('a first-time owner link: no tick is asked for, and one tap creates it', async ({ page }) => {
  await q(`update public.hotel_settings set qr_key_enc = null where restaurant_id = ${RID}`);
  await signIn(page, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
  await expect(page.getByText('No saved link yet')).toBeVisible();
  await page.getByRole('button', { name: 'Create guest link' }).click();
  await expect(page.getByRole('checkbox', { name: /old QR codes will stop working/ })).toHaveCount(0);
  await page.getByLabel('Your password to confirm').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Create new link' }).click();
  await expect(page.getByLabel('Guest link')).toBeVisible();
  second = await linkOf(page); // the newest link is the one that works from here on
  expect(second).toMatch(/\?k=[0-9a-f]{64}$/);
});

test('a guest login left over from one hotel never opens another hotel\'s page', async ({ browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  const admin = (await q<{ id: string }>(`select id from auth.users where email = 'admin@gotomenu.demo'`))[0]!.id;
  const out = (await q<{ r: { qr_key: string } }>(`select public.padh_admin_enable_hotel($1, (select id from public.restaurants where slug = 'cafe-aroma')) as r`, [admin]))[0]!.r;
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(second);
  await g.getByLabel('Your name').fill('Anita Sharma');
  await g.getByLabel('Mobile number').fill('9811111111');
  await g.getByLabel('Room number').fill('204');
  await g.getByRole('button', { name: 'Enter' }).click();
  await expect(g.getByText('Namaste, Anita')).toBeVisible();
  await g.goto(`/padharosaa/cafe-aroma?k=${out.qr_key}`);
  await expect(g.getByLabel('Your name')).toBeVisible(); // the other hotel's own sign-in, not Spice Garden's home
  await expect(g.getByText('Namaste, Anita')).toHaveCount(0);
  await ctx.close();
});

test('the owner adds many guide places from a CSV; sending the same list again adds nothing twice', async ({ page }) => {
  await signIn(page, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
  const rows = 'Amer Fort, place, "Hilltop fort, mirror hall", Early morning, Amer\nLaxmi Misthan Bhandar, food, Famous for ghewar';
  await page.getByLabel('Places CSV').fill(rows);
  await page.getByRole('button', { name: 'Add these places' }).click();
  await expect(page.getByText('2 added and live for guests')).toBeVisible();
  await expect(page.getByText('Amer Fort', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Places CSV').fill(rows);
  await page.getByRole('button', { name: 'Add these places' }).click();
  await expect(page.getByText(/0 added.*2 already in the guide/)).toBeVisible();
  expect((await q<{ n: number }>(`select count(*)::int n from public.guide_items where restaurant_id = ${RID} and active and not needs_review`))[0]!.n).toBe(2);
});
