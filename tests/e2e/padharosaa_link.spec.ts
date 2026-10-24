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
  await page.getByRole('checkbox').check();
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
  // and the manager can move to every other screen
  const nav = page.getByRole('navigation', { name: 'Screens' });
  for (const name of ['Live board (all)', 'Reception', 'Housekeeping', 'Kitchen', 'Food orders']) await expect(nav.getByRole('link', { name })).toBeVisible();
  await nav.getByRole('link', { name: 'Housekeeping' }).click();
  await expect(page).toHaveURL(/\/padharosaa\/housekeeping$/);
  await expect(page.getByRole('button', { name: /^Housekeeping \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^All \(\d+\)$/ }).click();
  await expect(page.getByRole('button', { name: /^All \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/padharosaa/kitchen');
  await expect(page.getByRole('button', { name: /^Kitchen \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true');
});

test('a first-time owner link: no tick is asked for, and one tap creates it', async ({ page }) => {
  await q(`update public.hotel_settings set qr_key_enc = null where restaurant_id = ${RID}`);
  await signIn(page, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
  await expect(page.getByText('No saved link yet')).toBeVisible();
  await page.getByRole('button', { name: 'Create guest link' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
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
