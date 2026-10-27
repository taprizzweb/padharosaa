import { expect, test, type Page } from '@playwright/test';
import { newTable, q } from './helpers';
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
  await q(`delete from public.buffets where restaurant_id = ${RID}`);
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
  await page.getByRole('tab', { name: 'Start' }).click(); // the console opens on the Overview
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
  await page.getByRole('tab', { name: 'Start' }).click(); // the console opens on the Overview
  await expect(page.getByLabel('Guest link')).toBeVisible();
  expect(await linkOf(page)).toBe(second);
  await expect(page.getByRole('button', { name: /Create a new link/ })).toHaveCount(0);
  await expect(page.getByText('Only the owner can create a new link')).toBeVisible();
  // and the manager can reach the one reception desk, where everything arrives
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await expect(nav.getByRole('link', { name: 'Reception desk' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Kitchen' })).toHaveCount(0); // only when the hotel says it has one
  await nav.getByRole('link', { name: 'Reception desk' }).click();
  await expect(page).toHaveURL(/\/padharosaa\/desk$/);
  await expect(page.getByRole('button', { name: /^All\s*\d+$/ })).toHaveAttribute('aria-pressed', 'true');
  // old addresses land on the desk too
  await page.goto('/padharosaa/housekeeping');
  await expect(page).toHaveURL(/\/padharosaa\/desk$/);
  // with a separate kitchen display switched on, the manager gets that screen as well
  await q(`update public.hotel_settings set kitchen_display = true where restaurant_id = ${RID}`);
  await page.goto('/padharosaa/desk');
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Kitchen' }).click();
  await expect(page).toHaveURL(/\/padharosaa\/kitchen$/);
  await expect(page.getByRole('tab', { name: 'Live' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Sold out' })).toBeVisible();
  await q(`update public.hotel_settings set kitchen_display = false where restaurant_id = ${RID}`);
});

test('a first-time owner link: no tick is asked for, and one tap creates it', async ({ page }) => {
  await q(`update public.hotel_settings set qr_key_enc = null where restaurant_id = ${RID}`);
  await signIn(page, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
  await page.getByRole('tab', { name: 'Start' }).click(); // the console opens on the Overview
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
  await page.getByRole('tab', { name: 'Buffet & guide' }).click();
  const rows = 'Amer Fort, place, "Hilltop fort, mirror hall", Early morning, Amer\nLaxmi Misthan Bhandar, food, Famous for ghewar';
  await page.getByLabel('Places CSV', { exact: true }).fill(rows);
  await page.getByRole('button', { name: 'Add these places' }).click();
  await expect(page.getByText('2 added and live for guests')).toBeVisible();
  await expect(page.getByText('Amer Fort', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Places CSV', { exact: true }).fill(rows);
  await page.getByRole('button', { name: 'Add these places' }).click();
  await expect(page.getByText(/0 added.*2 already in the guide/)).toBeVisible();
  expect((await q<{ n: number }>(`select count(*)::int n from public.guide_items where restaurant_id = ${RID} and active and not needs_review`))[0]!.n).toBe(2);
});

test('a bill request and a waiter call arrive on the reception desk with the rest, and "Bill given" clears it', async ({ page }) => {
  const tb = await newTable();
  const t = tb.id;
  const s = (await q<{ id: string }>(`insert into public.table_sessions (restaurant_id, table_id, pay_mode) values (${RID}, $1, 'upi') returning id`, [t]))[0]!.id;
  await q(`insert into public.service_requests (restaurant_id, table_id, session_id, type, pay_mode) values (${RID}, $1, $2, 'bill', 'upi')`, [t, s]);
  await q(`insert into public.service_requests (restaurant_id, table_id, session_id, type, reason) values (${RID}, $1, $2, 'waiter', 'water')`, [t, s]);
  try {
    await signIn(page, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    const mine = page.getByTestId('table-call').filter({ hasText: tb.label }); // other tests may leave their own calls on the same desk
    await expect(mine.getByText('Asked for the bill · pays by UPI')).toBeVisible();
    await expect(mine.getByText('Asked for a waiter')).toBeVisible();
    await mine.getByRole('button', { name: 'Bill given' }).click();
    await expect(mine.getByText('Asked for the bill · pays by UPI')).toHaveCount(0);
    await expect(mine.getByText('Asked for a waiter')).toBeVisible();
  } finally {
    await q(`delete from public.table_sessions where id = $1`, [s]);
    await q(`delete from public.dining_tables where id = $1`, [t]);
  }
});

test('reception can set the buffet from the desk', async ({ page }) => {
  await signIn(page, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
  await page.getByText('Buffet and guest phone alerts').click();
  await page.getByRole('button', { name: /^Today/ }).click();
  await page.getByLabel(/^Name \(e.g. Thali night\)/).fill('Rajasthani thali night');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Buffet saved.')).toBeVisible();
  expect((await q<{ n: number }>(`select count(*)::int n from public.buffets where restaurant_id = ${RID} and name = 'Rajasthani thali night'`))[0]!.n).toBe(1);
  // the desk also chooses when guests' phones are told: on save, and a daily reminder time
  const card = page.getByTestId('buffet-notify');
  await card.getByLabel('Remind everyone every day at').fill('18:30');
  await card.getByRole('button', { name: 'Save time' }).click();
  await expect(page.getByText('Alert settings saved.')).toBeVisible();
  expect((await q<{ t: string }>(`select to_char(buffet_notify_time, 'HH24:MI') t from public.hotel_settings where restaurant_id = ${RID}`))[0]!.t).toBe('18:30');
  await expect(page.getByTestId('notify-state')).toContainText('every day at 6:30 PM');
  await card.getByRole('button', { name: 'Send a test alert now' }).click();
  await expect(page.getByTestId('notify-test')).toContainText(/keys are missing|No guest phone has allowed alerts|Test sent/);
  await card.getByLabel('Send when today\'s buffet is saved').uncheck();
  await expect.poll(async () => (await q<{ b: boolean }>(`select buffet_notify_on_save b from public.hotel_settings where restaurant_id = ${RID}`))[0]!.b).toBe(false);
});

test('every guest is told about today\'s buffet on the home screen, with a New mark until they look', async ({ browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const g = await ctx.newPage();
  try {
    await g.goto(second);
    await g.getByLabel('Your name').fill('Buffet Guest');
    await g.getByRole('button', { name: 'Accept cookies' }).click();
    await g.getByLabel('Mobile number').fill('9866666666');
    await g.getByLabel('Room number').fill('204');
    await g.getByRole('button', { name: 'Enter' }).click();
    const notice = g.getByTestId('buffet-notice');
    await expect(notice).toContainText('Rajasthani thali night');
    await expect(notice).toContainText('New');
    await notice.click();
    await expect(g.getByRole('heading', { name: "Today's buffet" })).toBeVisible();
    await g.getByRole('button', { name: 'Back' }).click();
    await expect(g.getByTestId('buffet-notice')).not.toContainText('New');
  } finally {
    await ctx.close();
  }
});

test('in a hotel only the Taprizz admin edits the menu: the owner has no edit option; the admin clears old dishes (select all, delete selected, category with its dishes)', async ({ page }) => {
  const c1 = (await q<{ id: string }>(`insert into public.categories (restaurant_id, name_en) values (${RID}, 'Zz Old starters') returning id`))[0]!.id;
  const c2 = (await q<{ id: string }>(`insert into public.categories (restaurant_id, name_en) values (${RID}, 'Zz Old drinks') returning id`))[0]!.id;
  for (const [c, n] of [[c1, 'Zz Dish 1'], [c1, 'Zz Dish 2'], [c2, 'Zz Dish 3']] as const) {
    await q(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values (${RID}, $1, $2, 10000)`, [c, n]);
  }
  try {
    // the owner has no way to edit the menu: no link, the address sends them away, and the database refuses anyway
    await signIn(page, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    const nav = page.getByRole('navigation', { name: 'Screens' });
    await expect(nav.getByRole('link', { name: /add or delete dishes/ })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Menu' })).toHaveCount(0); // the hotel's menu is the Taprizz admin's: no side-menu entry for the owner
    await page.goto('/dash/menu');
    await expect(page).toHaveURL(/\/dash\/settings$/);
    await expect(page.getByRole('link', { name: 'Menu', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    // the Taprizz admin edits it from the admin panel
    await signIn(page, 'admin@gotomenu.demo', /\/admin$/, '/admin');
    await page.getByRole('button', { name: 'Edit the menu of Spice Garden' }).click();
    await expect(page).toHaveURL(/\/dash\/menu$/);
    const section = page.getByRole('region', { name: 'Zz Old starters' });
    await section.getByRole('button', { name: 'Select all' }).click();
    await page.getByRole('button', { name: 'Delete selected' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page.getByText('Zz Dish 1')).toHaveCount(0);
    expect((await q<{ n: number }>(`select count(*)::int n from public.items where restaurant_id = ${RID} and name_en like 'Zz Dish%'`))[0]!.n).toBe(1);
    await page.getByRole('region', { name: 'Zz Old drinks' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(/and its 1 dish/)).toBeVisible();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page.getByText('Zz Old drinks')).toHaveCount(0);
    expect((await q<{ n: number }>(`select count(*)::int n from public.items where restaurant_id = ${RID} and name_en like 'Zz Dish%'`))[0]!.n).toBe(0);
    await page.getByRole('button', { name: 'Leave and go back to the admin panel' }).click();
    await expect(page).toHaveURL(/\/admin$/);
  } finally {
    await q(`delete from public.staff where display_name = 'Taprizz admin (support)'`);
    await q(`delete from public.items where restaurant_id = ${RID} and name_en like 'Zz Dish%'`);
    await q(`delete from public.categories where restaurant_id = ${RID} and name_en like 'Zz Old%'`);
  }
});

test('the owner sets opening and closing time; after closing a guest sees it and cannot send a request, and from the opening time it works again', async ({ page, browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  const t = async (plus: string) => (await q<{ t: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::time + interval '${plus}', 'HH24:MI') as t`))[0]!.t;
  await signIn(page, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
  await page.getByRole('tab', { name: 'Orders & payment' }).click();
  const card = page.getByRole('heading', { name: 'Opening and closing time for requests' }).locator('..');
  await card.getByLabel('Starts at').fill(await t('+2 hours'));
  await card.getByLabel('Closes at').fill(await t('+3 hours'));
  await card.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText('Hours saved.')).toBeVisible();
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(second);
  await g.getByLabel('Your name').fill('Late Guest');
  await g.getByLabel('Mobile number').fill('9822222222');
  await g.getByLabel('Room number').fill('204');
  await g.getByRole('button', { name: 'Enter' }).click();
  await expect(g.getByText('Namaste, Late')).toBeVisible();
  await expect(g.getByText(/Requests are closed right now\. They open again at/)).toBeVisible();
  await g.getByText('Help / problem').first().click();
  await expect(g.getByRole('button', { name: /^Send/ })).toBeDisabled();
  await g.keyboard.press('Escape');
  // the owner opens it all day again: the guest can send
  await card.getByRole('button', { name: 'Open all day' }).click();
  await expect(page.getByText('Requests are open all day again.')).toBeVisible();
  await g.reload();
  await expect(g.getByText(/Requests are closed right now/)).toHaveCount(0);
  await ctx.close();
});

test('reception sees only the desk, the menu (sold-out switches) and settings, and no console, dashboard or team tools', async ({ page }) => {
  await signIn(page, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
  const nav = page.getByRole('navigation', { name: 'Screens' });
  await expect(nav.getByRole('link')).toHaveText(['Reception desk', 'Rooms', 'Billing', 'Counter billing', 'Menu', 'Settings']);
  await expect(page.getByRole('heading', { name: 'Opening and closing time for requests' })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Menu' }).click();
  await expect(page).toHaveURL(/\/padharosaa\/menu$/);
  await expect(page.getByRole('tab', { name: 'Live' })).toHaveCount(0); // only the sold-out switches
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/padharosaa\/settings$/);
  await expect(page.getByRole('link', { name: 'Change my password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  // the owner's pages stay closed to reception
  await page.goto('/padharosaa/owner');
  await expect(page).toHaveURL(/\/padharosaa\/desk$/);
});

test('Dining: "What do you feel like?" has Veg, Non-Veg, Jain, Bar and Bestsellers, and hides categories that have nothing for the chosen chips', async ({ browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  const mk = async (name: string, item: string, diet: string) => {
    const id = (await q<{ id: string }>(`insert into public.categories (restaurant_id, name_en) values (${RID}, $1) returning id`, [name]))[0]!.id;
    await q(`insert into public.items (restaurant_id, category_id, name_en, price_paise, diet) values (${RID}, $1, $2, 10000, $3)`, [id, item, diet]);
  };
  await mk('Zz Soup - Non-Veg', 'Zz Chicken Soup', 'nonveg');
  await mk('Zz Salads - Veg', 'Zz Green Salad', 'veg');
  await mk('Bar - Zz Wine', 'Zz Red Wine', 'veg');
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const g = await ctx.newPage();
  try {
    await g.goto(second);
    await g.getByLabel('Your name').fill('Dina Guest');
    await g.getByRole('button', { name: 'Accept cookies' }).click(); // on a small screen the cookie notice would cover the Enter button
    await g.getByLabel('Mobile number').fill('9833333333');
    await g.getByLabel('Room number').fill('204');
    await g.getByRole('button', { name: 'Enter' }).click();
    await expect(g.getByText('Namaste, Dina')).toBeVisible();
    await g.getByText('Dining', { exact: true }).click();
    await expect(g.getByRole('group').filter({ hasText: 'Food type' }).getByRole('button')).toHaveText(['Veg', 'Non-Veg', 'Jain', 'Bar', 'Bestsellers']);
    const chip = (n: string) => g.getByRole('button', { name: new RegExp(`^(✓ )?${n}$`) });
    const foodType = g.getByRole('group').filter({ hasText: 'Food type' });
    // the long list of categories is never shown at once: first a section, then the type of dish inside it
    await expect(chip('Zz Soup')).toHaveCount(0);
    await expect(chip('Food')).toBeVisible();
    await expect(chip('Bar')).toHaveCount(2); // the Bar food type and the Bar section
    await chip('Food').click();
    await expect(chip('Zz Soup')).toBeVisible();
    await expect(chip('Zz Salads')).toBeVisible();
    await foodType.getByRole('button', { name: 'Non-Veg', exact: true }).click(); // Non-Veg: only types with a non-veg dish
    await expect(chip('Zz Soup')).toBeVisible();
    await expect(chip('Zz Salads')).toHaveCount(0);
    await expect(g.getByRole('group').filter({ hasText: 'What are you in the mood for?' }).getByRole('button', { name: 'Bar' })).toHaveCount(0); // a bar dish is stored as veg: no Bar section under Non-Veg
    await foodType.getByRole('button', { name: /^(✓ )?Veg$/ }).click(); // Veg turns Non-Veg off
    await expect(foodType.getByRole('button', { name: /Non-Veg$/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(chip('Zz Salads')).toBeVisible();
    await expect(chip('Zz Soup')).toHaveCount(0);
    await foodType.getByRole('button', { name: /^(✓ )?Veg$/ }).click();
    await foodType.getByRole('button', { name: 'Bar', exact: true }).click(); // Bar: only the bar section is left
    await expect(g.getByText('What are you in the mood for?')).toHaveCount(0); // one section only: no need to choose it, its types show at once
    await expect(chip('Zz Wine')).toBeVisible();
    await expect(chip('Zz Salads')).toHaveCount(0);
    expect(await g.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await ctx.close();
    await q(`delete from public.items where restaurant_id = ${RID} and name_en like 'Zz %'`);
    await q(`delete from public.categories where restaurant_id = ${RID} and (name_en like 'Zz %' or name_en like 'Bar - Zz %')`);
  }
});

test('after a room order the guest picks "Add to room receipt" or "Pay now" (the hotel QR photo); the desk sees which', async ({ browser, page }) => {
  const t = await newTable();
  await q(`update public.dining_tables set kind = 'room' where id = $1`, [t.id]);
  await q(`update public.hotel_settings set pay_qr_path = $1 where restaurant_id = ${RID}`, [`${(await q<{ id: string }>(`select ${RID} as id`))[0]!.id}/payqr-e2e.png`]);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const g = await ctx.newPage();
  try {
    await g.goto(`/${t.slug}?k=${t.token}`);
    await g.getByRole('button', { name: 'Add Butter Naan', exact: true }).click();
    await g.getByRole('button', { name: /View cart/ }).click();
    await g.getByRole('dialog').getByRole('button', { name: 'Place order' }).click();
    const choice = g.getByTestId('pay-choice');
    await expect(choice.getByRole('button', { name: 'Add to room receipt' })).toBeVisible();
    await expect(choice.getByRole('button', { name: 'Pay now' })).toBeVisible();
    await choice.getByRole('button', { name: 'Pay now' }).click();
    await expect(choice.getByRole('img', { name: /payment QR code/ })).toBeVisible(); // the hotel's own QR photo
    await expect(choice.getByText(/pay ₹60/)).toBeVisible();
    await choice.getByRole('button', { name: 'Change how I pay' }).click();
    await choice.getByRole('button', { name: 'Add to room receipt' }).click();
    await expect(choice.getByText(/Added to your room receipt/)).toBeVisible();
    await expect(choice.getByRole('img')).toHaveCount(0);
    // the desk sees the choice on the order
    await signIn(page, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await expect(page.getByText('Add to room receipt').first()).toBeVisible();
    expect(await g.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await ctx.close();
    await q(`update public.hotel_settings set pay_qr_path = null where restaurant_id = ${RID}`);
  }
});

test('the platform admin edits any hotel\'s menu from the admin panel and then leaves', async ({ page, browser }) => {
  await signIn(page, 'admin@gotomenu.demo', /\/admin$/, '/admin');
  await page.getByRole('button', { name: 'Edit the menu of Spice Garden' }).click();
  await expect(page).toHaveURL(/\/dash\/menu$/);
  await expect(page.getByTestId('support-banner')).toContainText('You are editing Spice Garden as Taprizz admin');
  await expect(page.getByRole('heading', { name: 'Menu', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add category' })).toBeVisible();
  await page.getByRole('button', { name: 'Leave and go back to the admin panel' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  expect((await q<{ n: number }>(`select count(*)::int n from public.staff where display_name = 'Taprizz admin (support)'`))[0]!.n).toBe(0);
  // a platform admin always signs in to the admin panel, never to a hotel page
  await page.getByRole('button', { name: 'Edit the menu of Spice Garden' }).click();
  await expect(page).toHaveURL(/\/dash\/menu$/);
  // while the visit is on, signing in again (another device) still lands on the admin panel
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await signIn(p2, 'admin@gotomenu.demo', /\/admin$/, '/admin');
  await ctx.close();
  await page.getByRole('button', { name: 'Leave and go back to the admin panel' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  expect((await q<{ n: number }>(`select count(*)::int n from public.staff where display_name = 'Taprizz admin (support)'`))[0]!.n).toBe(0);
});

test('reception checks a room out and the guest is signed out at once', async ({ page, browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  try {
    await g.goto(second);
    await g.getByLabel('Your name').fill('Checkout Guest');
    await g.getByLabel('Mobile number').fill('9844444444');
    await g.getByLabel('Room number').fill('204');
    await g.getByRole('button', { name: 'Enter' }).click();
    await expect(g.getByText('Namaste, Checkout')).toBeVisible();
    // the guest tells reception when they leave, and asks for luggage help
    await g.getByText('Check-out', { exact: true }).click();
    await g.getByLabel('I will check out at', { exact: true }).check();
    await g.getByLabel('I will check out at', { exact: true }).last().fill('11:30');
    await g.getByLabel('Please send someone for my luggage').check();
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByRole('heading', { name: 'Sent' })).toBeVisible();
    const co = (await q<{ label: string; detail: string }>(`select label, detail from public.requests where restaurant_id = ${RID} and type = 'checkout' order by created_at desc limit 1`))[0]!;
    expect(co.label).toBe('Check-out request: At 11:30 AM');
    expect(co.detail).toBe('Luggage help');
    await signIn(page, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await page.getByText(/^Check out a room/).click();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Check out Room 204' }).click();
    await expect(page.getByText('Room 204 checked out. The guest is signed out.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check out Room 204' })).toHaveCount(0);
    await q(`update public.hotel_settings set review_link = 'https://g.page/r/spice-garden/review' where restaurant_id = ${RID}`);
    await g.reload();
    // the guest gets a thank-you with the hotel's Google review link, not a sign-in page
    await expect(g.getByRole('heading', { name: 'Thank you, Checkout' })).toBeVisible();
    await expect(g.getByRole('link', { name: /Review us on Google/ })).toHaveAttribute('href', 'https://g.page/r/spice-garden/review');
    await expect(g.getByText('Namaste, Checkout')).toHaveCount(0);
    await g.getByRole('button', { name: 'Sign in again' }).click();
    await expect(g.getByLabel('Your name')).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('reception hands a request to a person; it lands on that person\'s own display with "Assigned to me" and "Only mine"; routing sends the next one straight there; Done today lists finished ones', async ({ page, browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  const mgrName = (await q<{ n: string }>(`select s.display_name n from public.staff s join auth.users u on u.id = s.user_id where u.email = 'manager@spice-garden.demo'`))[0]!.n;
  const mgrId = (await q<{ id: string }>(`select s.user_id id from public.staff s join auth.users u on u.id = s.user_id where u.email = 'manager@spice-garden.demo'`))[0]!.id;
  const gctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mctx = await browser.newContext();
  const g = await gctx.newPage();
  const m = await mctx.newPage();
  try {
    await g.goto(second);
    await g.getByLabel('Your name').fill('Assign Guest');
    await g.getByRole('button', { name: 'Accept cookies' }).click();
    await g.getByLabel('Mobile number').fill('9866666666');
    await g.getByLabel('Room number').fill('204');
    await g.getByRole('button', { name: 'Enter' }).click();
    await expect(g.getByText('Namaste, Assign')).toBeVisible();
    await g.getByText('Services', { exact: true }).click();
    await g.getByLabel('Extra pillows').check();
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByRole('heading', { name: 'Sent' })).toBeVisible();
    // reception hands it to the manager
    await signIn(page, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    const card = page.locator('li', { hasText: 'Housekeeping: Extra pillows' }).first();
    await card.getByRole('button', { name: 'Assign to…' }).click();
    await card.getByRole('button', { name: new RegExp(`^${mgrName}`) }).click();
    await expect(card.getByText(`Assigned to ${mgrName}`)).toBeVisible();
    expect((await q<{ a: string }>(`select assigned_to::text a from public.requests where restaurant_id = ${RID} and label = 'Housekeeping: Extra pillows' order by created_at desc limit 1`))[0]!.a).toBe(mgrId);
    // the manager sees it as theirs
    await signIn(m, 'manager@spice-garden.demo', /\/padharosaa\/manager$/, '/padharosaa/manager');
    await m.goto('/padharosaa/desk');
    const mine = m.locator('li', { hasText: 'Housekeeping: Extra pillows' }).first();
    await expect(mine.getByText('Assigned to me')).toBeVisible();
    await m.getByRole('button', { name: /^Only mine/ }).click();
    await expect(mine).toBeVisible();
    // finish it: it moves to "Done today"
    await mine.getByRole('button', { name: 'Accept' }).click();
    await mine.getByRole('button', { name: 'Mark done' }).click();
    await m.getByTestId('done-today').locator('summary').click();
    await expect(m.getByTestId('done-today')).toContainText('Housekeeping: Extra pillows');
    // routing: housekeeping goes straight to the manager from now on
    await q(`insert into public.request_routing (restaurant_id, team, user_id) values (${RID}, 'housekeeping', '${mgrId}') on conflict (restaurant_id, team) do update set user_id = excluded.user_id`);
    await g.getByRole('button', { name: 'Back to home' }).click().catch(() => undefined);
    await g.goto(second);
    await g.getByText('Services', { exact: true }).click();
    await g.getByLabel('Extra towels').check();
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByRole('heading', { name: 'Sent' })).toBeVisible();
    expect((await q<{ a: string }>(`select assigned_to::text a from public.requests where restaurant_id = ${RID} and label = 'Housekeeping: Extra towels' order by created_at desc limit 1`))[0]!.a).toBe(mgrId);
  } finally {
    await q(`delete from public.request_routing where restaurant_id = ${RID}`);
    await gctx.close();
    await mctx.close();
  }
});

test('signing in never drops the owner or the kitchen on the reception desk, even from an old ?next=desk link; the console has a Sign out button', async ({ browser }) => {
  for (const [email, land] of [['owner@spice-garden.demo', /\/padharosaa\/owner$/], ['kitchen@spice-garden.demo', /\/padharosaa\/kitchen$/]] as const) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    try {
      await signIn(p, email, land, '/padharosaa/desk'); // an expired desk sends people to /login?next=/padharosaa/desk
      await expect(p).toHaveURL(land);
      if (email.startsWith('owner')) {
        await p.getByRole('button', { name: 'Sign out' }).click();
        await expect(p).toHaveURL(/\/login/);
      }
    } finally {
      await ctx.close();
    }
  }
});

test('the owner console opens on an Overview of today; the desk and the console can switch to dark mode', async ({ browser }) => {
  const ctx = await browser.newContext();
  const o = await ctx.newPage();
  try {
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await expect(o.getByTestId('overview')).toBeVisible();
    await expect(o.getByText('Guests in', { exact: true })).toBeVisible();
    await expect(o.getByText('Requests', { exact: true })).toBeVisible();
    await expect(o.getByRole('img', { name: 'Requests by hour today' })).toBeVisible();
    await expect(o.getByTestId('hotel-kpis')).toContainText('Occupancy'); // the hotel's own numbers on top
    await expect(o.getByRole('img', { name: 'Sales per day, last 7 days' })).toBeVisible();
    await o.getByRole('button', { name: 'Dark mode' }).click();
    await expect(o.locator('html')).toHaveClass(/ns-dark/);
    await o.goto('/padharosaa/desk'); // the choice is remembered on this device
    await expect(o.locator('html')).toHaveClass(/ns-dark/);
    await o.getByRole('button', { name: 'Dark mode' }).click();
    await expect(o.locator('html')).not.toHaveClass(/ns-dark/);
  } finally {
    await ctx.close();
  }
});

test('a hotel that gives every guest their own Wi-Fi login: the owner pastes the list and the guest sees the next login on Stay & Wi-Fi', async ({ browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  await q(`delete from public.wifi_vouchers where restaurant_id = ${RID}`);
  const octx = await browser.newContext();
  const gctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const o = await octx.newPage();
  const g = await gctx.newPage();
  try {
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('tab', { name: 'Hotel' }).click();
    await o.getByLabel('Logins (one per line)').fill('Username,Password\n70012 JHWS\n70013,KPLM');
    await o.getByRole('button', { name: 'Add these logins' }).click();
    await expect(o.getByText(/2 logins added/)).toBeVisible();
    await expect(o.getByTestId('wifi-stock')).toContainText('2 unused');
    await g.goto(second);
    await g.getByLabel('Your name').fill('Wifi Guest');
    await g.getByRole('button', { name: 'Accept cookies' }).click();
    await g.getByLabel('Mobile number').fill('9877777777');
    await g.getByLabel('Room number').fill('204');
    await g.getByRole('button', { name: 'Enter' }).click();
    await expect(g.getByText('Namaste, Wifi')).toBeVisible();
    await g.getByText('Stay & Wi-Fi', { exact: true }).click();
    const card = g.getByTestId('wifi-voucher');
    await expect(card).toContainText('70012');
    await expect(card).toContainText('JHWS');
    await expect(o.getByTestId('wifi-stock')).toBeVisible();
    await o.reload();
    await o.getByRole('tab', { name: 'Hotel' }).click();
    await expect(o.getByTestId('wifi-stock')).toContainText('1 unused · 1 given');
  } finally {
    await q(`delete from public.wifi_vouchers where restaurant_id = ${RID}`);
    await octx.close();
    await gctx.close();
  }
});

test('guest sign-in: after the owner asks for the stay code a guest needs the code reception made; a wrong code is refused', async ({ browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  await q(`update public.hotel_settings set verification_level = 'light' where restaurant_id = ${RID}`);
  const octx = await browser.newContext();
  const gctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const o = await octx.newPage();
  const g = await gctx.newPage();
  const fill = async (code: string) => {
    await g.goto(second);
    await g.getByLabel('Your name').fill('Code Guest');
    await g.getByLabel('Mobile number').fill('9866666666');
    await g.getByLabel('Room number').fill('204');
    if (code) await g.getByLabel(/Stay code/).fill(code);
    await g.getByRole('button', { name: 'Enter' }).click();
  };
  try {
    await g.goto(second);
    await g.getByRole('button', { name: 'Accept cookies' }).click();
    await expect(g.getByLabel(/Stay code/)).toHaveCount(0); // a light hotel does not ask
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('tab', { name: 'Start' }).click();
    await o.getByRole('radio', { name: /Also the 4-digit stay code/ }).click(); // saved on the server first, then ticked
    await expect(o.getByText('Guests now need the stay code from reception.')).toBeVisible();
    await o.getByText('Make a stay code').click();
    await o.locator('select').filter({ hasText: '204' }).selectOption({ label: '204' }, { timeout: 10_000 });
    await o.getByRole('button', { name: 'Make a new code' }).click();
    const code = (await o.getByTestId('stay-code').innerText()).match(/\b\d{4}\b/)![0];
    await fill(code === '0000' ? '1111' : '0000');
    await expect(g.getByText(/could not sign you in/)).toBeVisible();
    await fill(code);
    await expect(g.getByText('Namaste, Code')).toBeVisible();
  } finally {
    await q(`update public.hotel_settings set verification_level = 'light' where restaurant_id = ${RID}`);
    await octx.close();
    await gctx.close();
  }
});

test('billing: the owner sets the hotel\'s own taxes, reception checks a guest in, adds a charge, takes the payment, checks out and prints the invoice', async ({ browser }) => {
  test.setTimeout(180_000);
  const clean = async () => {
    await q(`delete from public.stays where restaurant_id = ${RID}`);
    await q(`delete from public.bill_extras where restaurant_id = ${RID}`);
    await q(`delete from public.room_tax_slabs where restaurant_id = ${RID}`);
    await q(`delete from public.tax_rates where restaurant_id = ${RID}`);
    await q(`delete from public.charge_categories where restaurant_id = ${RID}`);
    await q(`delete from public.invoice_counters where restaurant_id = ${RID}`);
    await q(`delete from public.room_types where restaurant_id = ${RID}`);
  };
  await clean();
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  await q(`update public.hotel_settings set verification_level = 'light' where restaurant_id = ${RID}`);
  const octx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const rctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const o = await octx.newPage();
  const r = await rctx.newPage();
  const card = (p: Page, title: string) => p.locator('section', { has: p.getByRole('heading', { name: title }) });
  try {
    // --- the owner: nothing is fixed, so the hotel chooses its own rates ---
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.goto('/padharosaa/billing');
    await expect(o.getByTestId('taxes-missing')).toBeVisible(); // until the owner sets them the screens say bills show no tax
    await o.getByRole('tab', { name: 'Taxes & rates' }).click();
    await o.getByRole('button', { name: /Add common rates/ }).click();
    await expect(o.getByText('Common rates added.')).toBeVisible();
    await o.getByLabel('Tax for Room rent').selectOption({ label: 'GST 5% (5%)' });
    await o.getByRole('row', { name: /Room rent/ }).getByRole('button', { name: 'Save' }).click();
    await expect(o.getByText('Room rent saved.')).toBeVisible();
    await o.getByLabel('Name on the invoice').fill('Spice Garden Pvt Ltd');
    await o.getByLabel('Hotel GSTIN').fill('08ABCDE1234F1Z5');
    await o.getByRole('button', { name: 'Save invoice details' }).click();
    await expect(o.getByText('Invoice details saved.')).toBeVisible();
    const types = card(o, 'Room types and rates');
    await types.getByLabel('New room type').fill('Deluxe');
    await types.getByLabel('Rate per night in ₹').fill('3200');
    await types.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(o.getByText('Room type added.')).toBeVisible();
    await o.getByLabel('Type of room 204').selectOption({ label: 'Deluxe' });
    await expect(o.getByText('Room 204 saved.')).toBeVisible();

    // --- reception: check-in ---
    await signIn(r, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await r.goto('/padharosaa/billing');
    await expect(r.getByRole('tab', { name: 'Taxes & rates' })).toHaveCount(0); // setup is for the owner and manager
    await r.getByRole('tab', { name: 'Check in' }).click();
    await expect(r.getByRole('option', { name: /^204/ })).toHaveCount(1, { timeout: 8000 });
    await r.getByLabel('Room', { exact: true }).selectOption({ label: '204 · Deluxe' }, { timeout: 8000 });
    await expect(r.getByLabel('Rate per night in ₹')).toHaveValue('3200'); // from the room type
    await r.getByLabel('Guest name').fill('Anita Sharma');
    await r.getByLabel('Mobile number').fill('9876543210');
    await r.getByLabel('Advance taken in ₹').fill('2000');
    await r.getByLabel('Advance paid by').selectOption('upi');
    await r.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(r.getByTestId('stay-code')).toHaveText(/^\d{4}$/);
    await r.getByRole('button', { name: 'Open the bill' }).click();
    // 1 night at 3,200 + 5% = 3,360; the advance of 2,000 leaves 1,360
    await expect(r.getByTestId('folio')).toContainText('Anita Sharma');
    await expect(r.getByTestId('folio-totals')).toContainText('CGST 2.5% + SGST 2.5%');
    await expect(r.getByTestId('folio-balance')).toHaveText('₹1,360.00');
    // a charge added at the desk (laundry has no tax set yet): 250 more
    await r.getByRole('button', { name: '+ Add a charge' }).click();
    await r.getByLabel('What for').fill('Laundry, 5 shirts');
    await r.getByLabel('Price of one, in ₹').fill('250');
    await r.getByRole('button', { name: 'Add to the bill' }).click();
    await expect(r.getByText('Charge added.')).toBeVisible();
    await expect(r.getByTestId('folio-balance')).toHaveText('₹1,610.00');
    // check-out is refused while money is due, then allowed once it is paid
    await expect(r.getByRole('button', { name: 'Check out and make the invoice' })).toBeDisabled();
    await r.getByRole('button', { name: '+ Record a payment' }).click();
    await expect(r.getByLabel('Amount in ₹')).toHaveValue('1610');
    await r.getByRole('button', { name: 'Save payment' }).click();
    await expect(r.getByText('Payment recorded.')).toBeVisible();
    await expect(r.getByTestId('folio-balance')).toHaveText('₹0.00');
    r.once('dialog', (d) => void d.accept());
    await r.getByRole('button', { name: 'Check out and make the invoice' }).click();
    await expect(r.getByText('Checked out. The invoice is ready.')).toBeVisible();
    // the invoice
    const [inv] = await Promise.all([r.context().waitForEvent('page'), r.getByRole('link', { name: /Open invoice INV\// }).click()]);
    await expect(inv.getByTestId('invoice-number')).toHaveText(/^INV\/\d{4}-\d{2}\/0001$/);
    await expect(inv.getByTestId('invoice')).toContainText('Spice Garden Pvt Ltd');
    await expect(inv.getByTestId('invoice')).toContainText('GSTIN 08ABCDE1234F1Z5');
    await expect(inv.getByTestId('invoice')).toContainText('Anita Sharma');
    await expect(inv.getByTestId('invoice-totals')).toContainText('CGST 2.5%');
    await expect(inv.getByTestId('invoice-totals')).toContainText('₹3,610.00');
    await inv.close();
    // the room is free again, the guest is in the past list, and the old quick check-out stays closed for rooms with no bill
    await r.getByRole('button', { name: '← All guests' }).click();
    await r.getByRole('tab', { name: 'Past guests' }).click();
    await expect(r.getByTestId('past-guests')).toContainText('Anita Sharma');
  } finally {
    await clean();
    await octx.close();
    await rctx.close();
  }
});

test('rooms: reception books a room, checks the booking in, sees it on the chart, marks a room clean and finds the guest with the search box', async ({ browser }) => {
  test.setTimeout(150_000);
  const clean = async () => {
    await q(`delete from public.reservations where restaurant_id = ${RID}`);
    await q(`delete from public.stays where restaurant_id = ${RID}`);
    await q(`update public.rooms set hk_status = 'clean', hk_note = null where restaurant_id = ${RID}`);
  };
  await clean();
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204'), (${RID}, '205') on conflict do nothing`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const r = await ctx.newPage();
  try {
    await signIn(r, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await r.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Rooms' }).click();
    await expect(r).toHaveURL(/\/padharosaa\/rooms$/);
    await expect(r.getByTestId('rooms-summary')).toBeVisible();
    // the status board: every room as a card, a vacant one is a tap from check-in
    const bc = r.getByTestId('board-room').filter({ hasText: '204' });
    await expect(bc).toContainText('Vacant');
    await expect(bc.getByRole('link', { name: 'Check in' })).toBeVisible();
    await r.getByRole('tab', { name: 'Calendar' }).click();
    await expect(r.getByTestId('chart-row').filter({ hasText: '204' })).toBeVisible();
    await r.getByRole('tab', { name: 'Bookings' }).click();
    // a booking for today with an advance
    await r.getByRole('button', { name: 'New booking' }).click();
    await r.getByLabel('Guest name').fill('Chart Guest');
    await r.getByLabel('Mobile number').fill('9811122233');
    await r.getByLabel('Room', { exact: true }).selectOption({ label: '204' });
    await r.getByLabel('Rate per night in ₹').fill('2500');
    await r.getByLabel('Advance taken in ₹').fill('1000');
    await r.getByLabel('Advance paid by').selectOption('upi');
    await r.getByRole('button', { name: 'Save booking' }).click();
    await expect(r.getByText(/Booking B\d+ saved\./)).toBeVisible();
    await expect(r.getByTestId('booking-row')).toContainText('Chart Guest');
    // the same room cannot be booked twice for the same night
    await r.getByRole('button', { name: 'New booking' }).click();
    await r.getByLabel('Guest name').fill('Clash Guest');
    await r.getByLabel('Room', { exact: true }).selectOption({ label: '204' });
    await r.getByLabel('Rate per night in ₹').fill('2500');
    await r.getByRole('button', { name: 'Save booking' }).click();
    await expect(r.getByText(/not free on those dates/)).toBeVisible();
    await r.getByRole('button', { name: 'Back' }).click();
    // check the booking in: the advance lands on the bill
    await r.getByRole('button', { name: 'Check in', exact: true }).click();
    await r.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(r.getByTestId('stay-code')).toHaveText(/^\d{4}$/);
    await r.getByRole('link', { name: 'Open the bill' }).click();
    await expect(r).toHaveURL(/\/padharosaa\/billing\?stay=/);
    await expect(r.getByTestId('folio')).toContainText('Chart Guest');
    await expect(r.getByTestId('folio-totals')).toContainText('₹');
    // the chart shows the guest as a bar; housekeeping: mark a room dirty, start cleaning, mark clean
    await r.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Rooms' }).click();
    await expect(r.getByTestId('board-room').filter({ hasText: '204' })).toContainText('Chart Guest'); // the status board shows who is in the room
    await expect(r.getByTestId('board-room').filter({ hasText: '204' })).toContainText('Occupied');
    await r.getByRole('tab', { name: 'Calendar' }).click();
    await expect(r.getByTestId('room-chart').getByRole('link', { name: 'Chart Guest' })).toBeVisible();
    await r.getByRole('tab', { name: /^Housekeeping/ }).click();
    const card = r.getByTestId('hk-card').filter({ hasText: '205' });
    await card.getByRole('button', { name: 'Mark dirty' }).click();
    await expect(card).toContainText('Dirty');
    await card.getByRole('button', { name: 'Start cleaning' }).click();
    await expect(card).toContainText('Being cleaned');
    await card.getByRole('button', { name: 'Mark clean' }).click();
    await expect(card).toContainText('Clean');
    // a guest asks for something in room 204: the card blinks red on the board, and a tap opens the desk on that room only
    const sid = (await q<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status)
      select ${RID}, id, 'Blink Guest', '+91', '\\x01', decode(md5(random()::text) || md5(random()::text), 'hex'), decode(md5(random()::text) || md5(random()::text), 'hex'), 'active' from public.rooms where restaurant_id = ${RID} and number = '205' returning id`))[0]!.id;
    await q(`select public.padh_guest_create_request('${sid}','housekeeping','Extra pillows',null,false,gen_random_uuid()::text)`);
    await r.getByRole('tab', { name: 'Room status' }).click();
    const blink = r.getByTestId('board-room').filter({ hasText: '205' });
    await expect(blink).toHaveAttribute('data-waiting', '1', { timeout: 20_000 });
    await blink.getByRole('link', { name: /request.* waiting/ }).click();
    await expect(r).toHaveURL(/\/padharosaa\/desk\?room=205/);
    await expect(r.getByTestId('room-filter')).toContainText('room 205 only');
    await expect(r.getByText('Extra pillows').first()).toBeVisible();
    await r.getByRole('button', { name: 'Show every room' }).click();
    await expect(r.getByTestId('room-filter')).toHaveCount(0);
    await r.goto('/padharosaa/rooms');
    // the search box in the top bar
    await r.getByLabel('Search guests, rooms, bookings, invoices').fill('chart');
    await r.getByTestId('search-results').getByRole('link', { name: /Chart Guest/ }).first().click();
    await expect(r).toHaveURL(/\/padharosaa\/billing\?stay=/);
    await expect(r.getByTestId('folio')).toContainText('Chart Guest');
  } finally {
    await clean();
    await ctx.close();
  }
});

test('inventory: the owner adds an item and stocks it, the kitchen records use and waste, low stock is flagged and an impossible use is refused', async ({ browser }) => {
  test.setTimeout(150_000);
  await q(`delete from public.inventory_items where restaurant_id = ${RID}`);
  const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const kctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const o = await octx.newPage();
  const k = await kctx.newPage();
  try {
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Inventory' }).click();
    await expect(o).toHaveURL(/\/padharosaa\/inventory$/);
    await o.getByRole('button', { name: 'Add an item' }).click();
    await o.getByLabel('Name', { exact: true }).fill('Basmati rice');
    await o.getByLabel('Counted in').fill('kg');
    await o.getByLabel('Warn me when stock is below').fill('10');
    await o.getByRole('button', { name: 'Save', exact: true }).click();
    const row = o.getByTestId('inv-row').filter({ hasText: 'Basmati rice' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Add stock' }).click();
    await o.getByLabel('How much (kg)').fill('25');
    await o.getByLabel('Total cost in ₹').fill('1500');
    await o.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row).toContainText('25 kg');
    await expect(o.getByTestId('inv-summary')).toContainText('₹1,500.00');
    // the kitchen can record use and waste, but not stock in
    await signIn(k, 'kitchen@spice-garden.demo', /\/padharosaa\/kitchen$/, '/padharosaa/kitchen');
    await k.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Inventory' }).click();
    const kr = k.getByTestId('inv-row').filter({ hasText: 'Basmati rice' });
    await expect(kr.getByRole('button', { name: 'Add stock' })).toHaveCount(0);
    await kr.getByRole('button', { name: 'Use', exact: true }).click();
    await k.getByLabel('How much (kg)').fill('100');
    await k.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(k.getByText(/Only 25 kg is in stock/)).toBeVisible();
    await k.getByLabel('How much (kg)').fill('16');
    await k.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(kr).toContainText('9 kg');
    await expect(kr).toContainText('Low');
    await expect(k.getByTestId('inv-summary')).toContainText('Running low');
    await kr.getByRole('button', { name: 'History' }).click();
    await expect(k.getByTestId('inv-log')).toContainText('Used -16 kg');
    await expect(k.getByTestId('inv-log')).toContainText('Stock added +25 kg');
  } finally {
    await q(`delete from public.inventory_items where restaurant_id = ${RID}`);
    await octx.close();
    await kctx.close();
  }
});

test('counter billing and reports: reception bills a dish and a custom item with 5% GST, the bill prints, the owner sees it in the report; a bill can be cancelled', async ({ browser }) => {
  test.setTimeout(150_000);
  const clean = async () => {
    await q(`delete from public.pos_bills where restaurant_id = ${RID}`);
    await q(`delete from public.pos_counters where restaurant_id = ${RID}`);
    await q(`update public.charge_categories set tax_rate_id = null where restaurant_id = ${RID}`);
    await q(`delete from public.tax_rates where restaurant_id = ${RID}`);
  };
  await clean();
  await q(`select private.billing_defaults(${RID}::uuid)`);
  await q(`insert into public.tax_rates (restaurant_id, name, rate_bp) values (${RID}, 'GST 5%', 500)`);
  await q(`update public.charge_categories set tax_rate_id = (select id from public.tax_rates where restaurant_id = ${RID} and name = 'GST 5%') where restaurant_id = ${RID} and kind = 'food'`);
  await q(`update public.hotel_settings set round_off = false where restaurant_id = ${RID}`);
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const r = await rctx.newPage();
  const o = await octx.newPage();
  try {
    await signIn(r, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await r.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Counter billing' }).click();
    await expect(r).toHaveURL(/\/padharosaa\/pos$/);
    await r.getByLabel('Item name').fill('Masala tea');
    await r.getByLabel('Price in ₹').fill('100');
    await r.getByRole('button', { name: 'Add', exact: true }).click();
    await r.getByLabel('Item name').fill('Cold coffee');
    await r.getByLabel('Price in ₹').fill('200');
    await r.getByRole('button', { name: 'Add', exact: true }).click();
    await r.getByRole('button', { name: 'More Masala tea' }).click(); // 2 teas
    // 2 x 100 + 200 = 400, 2.5% + 2.5% = 20, total 420
    await expect(r.getByTestId('pos-totals')).toContainText('₹400.00');
    await expect(r.getByTestId('pos-totals')).toContainText('₹420.00');
    // the desk can change the tax of this bill, add a service charge and give a discount; the screen shows the effect at once
    await r.getByLabel('GST on this bill').selectOption({ label: 'No GST' });
    await expect(r.getByTestId('pos-totals')).toContainText('₹400.00');
    await r.getByLabel('Service charge %').fill('10');
    await r.getByLabel('Discount in ₹').fill('40');
    await expect(r.getByTestId('pos-totals')).toContainText('₹396.00'); // 400 - 40 + 10% of 360
    await r.getByLabel('Service charge %').fill('');
    await r.getByLabel('Discount in ₹').fill('');
    await r.getByLabel('GST on this bill').selectOption({ index: 0 }); // the usual rate again
    await expect(r.getByTestId('pos-totals')).toContainText('₹420.00');
    // the kitchen slip: what to cook, no prices, ready for the roll printer
    await r.getByLabel('Table or note').fill('Table 4');
    await r.getByRole('button', { name: 'Print KOT for the kitchen' }).click();
    await expect(r.getByTestId('kot')).toContainText('Table 4');
    await expect(r.getByTestId('kot')).toContainText('Masala tea');
    await expect(r.getByTestId('kot')).not.toContainText('₹');
    await r.getByRole('button', { name: 'Back to billing' }).click();
    await r.getByLabel('Table or note').fill('Table 4');
    await r.getByLabel('Paid by', { exact: true }).selectOption('upi');
    await r.getByRole('button', { name: 'Make the bill' }).click();
    await expect(r.getByTestId('receipt-number')).toHaveText(/^POS\/\d{4}-\d{2}\/0001$/);
    await expect(r.getByTestId('receipt-total')).toHaveText('₹420.00');
    await expect(r.getByTestId('receipt')).toContainText('2 × ₹100.00');
    await r.getByRole('button', { name: 'Back to billing' }).click();
    await r.getByRole('tab', { name: "Today's bills" }).click();
    await expect(r.getByTestId('pos-row')).toContainText('Table 4');
    await expect(r.getByRole('button', { name: 'Cancel' })).toHaveCount(0); // only the owner and manager cancel a bill
    // the owner: reports and cancelling
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Reports' }).click();
    await o.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(o.getByTestId('report-cards')).toContainText('₹400.00'); // sales before tax
    await expect(o.getByTestId('report-cards')).toContainText('₹420.00'); // money collected
    await o.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Counter billing' }).click();
    await o.getByRole('tab', { name: "Today's bills" }).click();
    o.once('dialog', (d) => void d.accept('wrong order'));
    await o.getByRole('button', { name: 'Cancel' }).click();
    await expect(o.getByText('Bill cancelled.')).toBeVisible();
    await expect(o.getByTestId('pos-row')).toContainText('cancelled');
    await o.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Reports' }).click();
    await o.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(o.getByTestId('report-cards')).not.toContainText('₹420.00');
    // reception cannot open the reports
    await r.goto('/padharosaa/reports');
    await expect(r).not.toHaveURL(/\/padharosaa\/reports$/);
  } finally {
    await clean();
    await q(`update public.hotel_settings set round_off = true where restaurant_id = ${RID}`);
    await rctx.close();
    await octx.close();
  }
});

test('prices: the owner opens a room type, changes one day and a range, closes days for sale and puts them back; reception sees but cannot change', async ({ browser }) => {
  test.setTimeout(120_000);
  const clean = async () => {
    await q(`delete from public.room_rates where restaurant_id = ${RID}`);
    await q(`update public.rooms set room_type_id = null where restaurant_id = ${RID}`);
    await q(`delete from public.room_types where restaurant_id = ${RID}`);
  };
  await clean();
  await q(`insert into public.room_types (restaurant_id, name, rate_paise) values (${RID}, 'Deluxe', 300000)`);
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  await q(`update public.rooms set room_type_id = (select id from public.room_types where restaurant_id = ${RID} and name = 'Deluxe') where restaurant_id = ${RID} and number = '204'`);
  const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const o = await octx.newPage();
  const r = await rctx.newPage();
  try {
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Rooms', exact: true }).click();
    await o.getByRole('tab', { name: 'Prices' }).click();
    await o.getByTestId('rate-types').getByRole('button', { name: /Deluxe/ }).click();
    const grid = o.getByTestId('rate-grid');
    await expect(grid).toBeVisible();
    // the last day of the month that can still be changed
    const free = grid.getByRole('button', { disabled: false });
    const n = await free.count();
    expect(n).toBeGreaterThan(0);
    const labels = await free.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    const day1 = labels[n - 1]!.split(' ')[0]!;
    await free.nth(n - 1).click();
    await o.getByLabel('Price per night in ₹').fill('4500');
    await o.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(o.getByText('Saved.')).toBeVisible();
    await expect(grid.getByRole('button', { name: new RegExp(`^${day1} ₹4,500`) })).toBeVisible();
    // close the same day for sale
    await grid.getByRole('button', { name: new RegExp(`^${day1} `) }).click();
    await o.getByLabel('Sale').selectOption('stop');
    await o.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(grid.getByRole('button', { name: new RegExp(`^${day1} .*stop sell`) })).toBeVisible();
    await expect(grid.getByRole('button', { name: new RegExp(`^${day1} .*stop sell`) })).toContainText('Closed');
    // back to the everyday price
    await grid.getByRole('button', { name: new RegExp(`^${day1} `) }).click();
    await o.getByRole('button', { name: 'Back to everyday price' }).click();
    await expect(grid.getByRole('button', { name: new RegExp(`^${day1} ₹3,000`) })).toBeVisible();
    // reception can open it but the days are not clickable
    await signIn(r, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await r.goto('/padharosaa/rates'); // the old address lands on Rooms > Prices
    await expect(r).toHaveURL(/\/padharosaa\/rooms/);
    await r.getByTestId('rate-types').getByRole('button', { name: /Deluxe/ }).click();
    await expect(r.getByTestId('rate-grid').getByRole('button').first()).toBeDisabled();
    await expect(r.getByText('Only the owner and manager change prices.')).toBeVisible();
  } finally {
    await clean();
    await octx.close();
    await rctx.close();
  }
});

test('channels: the owner matches a room type, switches the channel manager on and sees the webhook address; reception cannot open it', async ({ browser }) => {
  test.setTimeout(120_000);
  const clean = async () => {
    await q(`delete from public.channel_outbox where restaurant_id = ${RID}`);
    await q(`delete from public.channel_maps where restaurant_id = ${RID}`);
    await q(`delete from public.channel_links where restaurant_id = ${RID}`);
    await q(`update public.rooms set room_type_id = null where restaurant_id = ${RID}`);
    await q(`delete from public.room_types where restaurant_id = ${RID}`);
  };
  await clean();
  await q(`insert into public.room_types (restaurant_id, name, rate_paise) values (${RID}, 'Deluxe', 300000)`);
  const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const o = await octx.newPage();
  const r = await rctx.newPage();
  try {
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Channels' }).click();
    await expect(o.getByTestId('channel-status')).toContainText('Switched off');
    await expect(o.getByTestId('channel-server-missing')).toBeVisible(); // the test server has no key for the service
    await expect(o.getByRole('button', { name: 'Switch on' })).toBeDisabled(); // nothing is matched yet
    await o.getByLabel('Property id').fill('cccccccc-1111-2222-3333-444444444444');
    await o.getByLabel('Room type id for Deluxe').fill('aaaaaaaa-1111-2222-3333-444444444444');
    await o.getByLabel('Rate plan id for Deluxe').fill('bbbbbbbb-1111-2222-3333-444444444444');
    await o.getByRole('row', { name: /Deluxe/ }).getByRole('button', { name: 'Save' }).click();
    await expect(o.getByText('Deluxe is matched.')).toBeVisible();
    await o.getByRole('button', { name: 'Switch on' }).click();
    await expect(o.getByText(/Switched on/).first()).toBeVisible();
    await expect(o.getByTestId('channel-status')).toContainText('Switched on');
    await expect(o.getByTestId('channel-status')).toContainText('1 change waiting'); // the first year of prices is queued for the sender
    await expect(o.getByTestId('channel-webhook')).toContainText(/\/api\/padharosaa\/v1\/channel\/webhook\/[0-9a-f]{64}$/);
    // a price change on the calendar queues too
    await o.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Rooms', exact: true }).click();
    await o.getByRole('tab', { name: 'Prices' }).click();
    await o.getByTestId('rate-types').getByRole('button', { name: /Deluxe/ }).click();
    const free = o.getByTestId('rate-grid').getByRole('button', { disabled: false });
    await free.nth((await free.count()) - 1).click();
    await o.getByLabel('Price per night in ₹').fill('3300');
    await o.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(o.getByText('Saved.')).toBeVisible();
    await o.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Channels' }).click();
    await expect(o.getByTestId('channel-status')).toContainText(/\d+ changes? waiting/);
    await o.getByRole('button', { name: 'Switch off' }).click();
    await expect(o.getByTestId('channel-status')).toContainText('Switched off');
    await signIn(r, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await r.goto('/padharosaa/channels');
    await expect(r).not.toHaveURL(/\/padharosaa\/channels$/);
  } finally {
    await q(`delete from public.room_rates where restaurant_id = ${RID}`);
    await clean();
    await octx.close();
    await rctx.close();
  }
});

test('the alarm keeps ringing when reception moves to another screen, and a waiting request shows a banner there', async ({ browser }) => {
  test.setTimeout(120_000);
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const r = await ctx.newPage();
  await r.addInitScript(() => {
    (window as unknown as { __beeps: number }).__beeps = 0;
    const proto = window.AudioContext?.prototype;
    if (proto) { const orig = proto.createOscillator; proto.createOscillator = function (this: AudioContext) { (window as unknown as { __beeps: number }).__beeps++; return orig.call(this); }; }
  });
  const beeps = () => r.evaluate(() => (window as unknown as { __beeps: number }).__beeps);
  try {
    await signIn(r, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await expect(r.getByTestId('alarm-toggle')).toHaveText(/Alarm is off/);
    await r.getByTestId('alarm-toggle').click();
    await expect(r.getByTestId('alarm-toggle')).toHaveText(/Alarm is on/);
    await r.evaluate(() => { (window as unknown as { __same: string }).__same = 'still this page'; }); // a full reload would lose this
    await r.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Billing', exact: true }).click();
    await expect(r).toHaveURL(/\/padharosaa\/billing$/);
    await expect(r.getByTestId('alarm-toggle')).toHaveText(/Alarm is on/);
    expect(await r.evaluate(() => (window as unknown as { __same?: string }).__same)).toBe('still this page');
    // a guest asks for something while reception is on the billing screen
    const sid = (await q<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status)
      select ${RID}, id, 'Alarm Guest', '+91', '\\x01', decode(md5(random()::text) || md5(random()::text), 'hex'), decode(md5(random()::text) || md5(random()::text), 'hex'), 'active' from public.rooms where restaurant_id = ${RID} and number = '204' returning id`))[0]!.id;
    const before = await beeps();
    await q(`select public.padh_guest_create_request('${sid}','housekeeping','Extra towels',null,true,gen_random_uuid()::text)`);
    await expect(r.getByTestId('alarm-banner')).toContainText('Extra towels', { timeout: 20_000 });
    await expect(r.getByTestId('alarm-banner')).toContainText('URGENT');
    await expect.poll(beeps, { timeout: 20_000 }).toBeGreaterThan(before); // it rang while on this screen
    await r.getByRole('link', { name: 'Open the desk' }).click();
    await expect(r).toHaveURL(/\/padharosaa\/desk$/);
    await expect(r.getByTestId('alarm-toggle')).toHaveText(/Alarm is on/);
    // turning it off sticks across screens too
    await r.getByTestId('alarm-toggle').click();
    await expect(r.getByTestId('alarm-toggle')).toHaveText(/Alarm is off/);
    await r.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Billing', exact: true }).click();
    await expect(r.getByTestId('alarm-toggle')).toHaveText(/Alarm is off/);
  } finally {
    await q(`delete from public.requests where restaurant_id = ${RID}`);
    await q(`delete from public.guest_sessions where restaurant_id = ${RID} and guest_name = 'Alarm Guest'`);
    await ctx.close();
  }
});

test('an offer: the manager types it, picks "Tonight", saves, and the guest sees it on the home screen; switching it off removes it', async ({ browser }) => {
  test.setTimeout(120_000);
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  await q(`update public.hotel_settings set offer_text = null, offer_until = null where restaurant_id = ${RID}`);
  const octx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const gctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const o = await octx.newPage();
  const g = await gctx.newPage();
  try {
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('tab', { name: 'Hotel' }).click();
    await o.getByLabel('Offer (e.g. Free lassi with dinner tonight)').fill('Free lassi with dinner tonight');
    await expect(o.getByLabel('Offer ends', { exact: true }).first()).not.toHaveValue(''); // a time is chosen for you, so the save cannot fail on an empty time
    await o.getByRole('button', { name: 'Tomorrow night' }).click();
    await o.getByRole('button', { name: 'Save texts' }).click();
    await expect(o.getByText('Saved. Guests see the offer now.')).toBeVisible();
    await expect(o.getByTestId('offer-live')).toContainText('Free lassi with dinner tonight');
    await g.goto(second);
    await g.getByLabel('Your name').fill('Offer Guest');
    await g.getByRole('button', { name: 'Accept cookies' }).click();
    await g.getByLabel('Mobile number').fill('9855550101');
    await g.getByLabel('Room number').fill('204');
    await g.getByRole('button', { name: 'Enter' }).click();
    await expect(g.getByText('Namaste, Offer')).toBeVisible();
    await expect(g.getByText('Free lassi with dinner tonight')).toBeVisible();
    // switching it off
    await o.getByRole('button', { name: 'Switch the offer off' }).click();
    await expect(o.getByText('The offer is switched off.')).toBeVisible();
    await g.reload();
    await expect(g.getByText('Namaste, Offer')).toBeVisible();
    await expect(g.getByText('Free lassi with dinner tonight')).toHaveCount(0);
    // a time in the past or an empty one is explained, not sent
    await o.getByLabel('Offer (e.g. Free lassi with dinner tonight)').fill('Late snack');
    await o.getByLabel('Offer ends', { exact: true }).first().fill('2020-01-01T10:00');
    await o.getByRole('button', { name: 'Save texts' }).click();
    await expect(o.getByText('The offer must end later than now.')).toBeVisible();
  } finally {
    await q(`update public.hotel_settings set offer_text = null, offer_until = null where restaurant_id = ${RID}`);
    await q(`delete from public.guest_sessions where restaurant_id = ${RID} and guest_name = 'Offer Guest'`);
    await octx.close();
    await gctx.close();
  }
});

test('local guides: the hotel adds a guide, the guest finds the tile, sees the charges and can call, WhatsApp or open Instagram; hiding the guide removes the tile', async ({ browser }) => {
  test.setTimeout(120_000);
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  await q(`delete from public.local_guides where restaurant_id = ${RID}`);
  const octx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const gctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const o = await octx.newPage();
  const g = await gctx.newPage();
  try {
    await g.goto(second);
    await g.getByLabel('Your name').fill('Guide Guest');
    await g.getByRole('button', { name: 'Accept cookies' }).click();
    await g.getByLabel('Mobile number').fill('9855550202');
    await g.getByLabel('Room number').fill('204');
    await g.getByRole('button', { name: 'Enter' }).click();
    await expect(g.getByText('Namaste, Guide')).toBeVisible();
    await expect(g.getByText('Local guides', { exact: true })).toHaveCount(0); // nothing listed: no empty tile
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('tab', { name: 'Buffet & guide' }).click();
    await o.getByRole('button', { name: '+ Add a guide' }).click();
    await o.getByLabel('Name', { exact: true }).fill('Ravi Sharma');
    await o.getByLabel('What they do').fill('Heritage walk guide');
    await o.getByLabel('Charges (optional)').fill('₹1,500 for 3 hours');
    await o.getByLabel('Phone', { exact: true }).fill('98290 11223');
    await o.getByLabel('Instagram').fill('https://www.instagram.com/ravi.walks/');
    await o.getByRole('button', { name: 'Add the guide' }).click();
    await expect(o.getByText('Guide added.')).toBeVisible();
    await expect(o.getByTestId('lguide-list')).toContainText('Ravi Sharma');
    await g.reload();
    await g.getByText('Local guides', { exact: true }).click();
    const card = g.getByTestId('local-guide');
    await expect(card).toContainText('Ravi Sharma');
    await expect(card).toContainText('Heritage walk guide');
    await expect(card).toContainText('₹1,500 for 3 hours');
    await expect(card.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+919829011223');
    expect(await card.getByRole('link', { name: 'WhatsApp' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919829011223\?text=.*Spice%20Garden.*204/);
    await expect(card.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/ravi.walks/');
    await expect(card.getByRole('link', { name: 'LinkedIn' })).toHaveCount(0); // not given: not shown
    // hide it
    await o.getByRole('button', { name: 'Hide' }).click();
    await expect(o.getByText('Ravi Sharma is hidden from guests.')).toBeVisible();
    await g.reload();
    await expect(g.getByText('Namaste, Guide')).toBeVisible();
    await expect(g.getByText('Local guides', { exact: true })).toHaveCount(0);
  } finally {
    await q(`delete from public.local_guides where restaurant_id = ${RID}`);
    await q(`delete from public.guest_sessions where restaurant_id = ${RID} and guest_name = 'Guide Guest'`);
    await octx.close();
    await gctx.close();
  }
});

test('room QR codes: the sheet has one code per room, a room link opens the guest page with the room filled in, and reception cannot open the sheet', async ({ browser }) => {
  test.setTimeout(120_000);
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204'), (${RID}, '205') on conflict do nothing`);
  const octx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const gctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const o = await octx.newPage();
  const g = await gctx.newPage();
  try {
    await signIn(o, 'owner@spice-garden.demo', /\/padharosaa\/owner$/, '/padharosaa/owner');
    await o.getByRole('tab', { name: 'Start' }).click();
    await o.getByRole('link', { name: 'Open the QR sheet' }).click();
    await expect(o).toHaveURL(/\/padharosaa\/qr$/);
    const active = Number((await q<{ n: string }>(`select count(*)::text as n from public.rooms where restaurant_id = ${RID} and active`))[0]!.n);
    await expect(o.getByTestId('qr-card')).toHaveCount(active);
    await expect(o.getByRole('img', { name: 'QR code for room 204' })).toBeVisible();
    await o.getByText(/Choose rooms/).click();
    await o.getByRole('button', { name: 'None' }).click();
    await o.getByLabel('204', { exact: true }).check();
    await expect(o.getByTestId('qr-card')).toHaveCount(1);
    await o.getByRole('radio', { name: 'One code for the hotel' }).check();
    await expect(o.getByTestId('qr-card')).toHaveCount(1);
    await expect(o.getByTestId('qr-card')).toContainText('type your room number');
    // a room link opens the login with the room already in it; the plain link does not
    await g.goto(`${second}&r=204`);
    await expect(g.getByLabel('Room number')).toHaveValue('204');
    await g.goto(second);
    await expect(g.getByLabel('Room number')).toHaveValue('');
    await g.goto(`${second}&r=%3Cscript%3E`);
    await expect(g.getByLabel('Room number')).toHaveValue(''); // a room that is not a room number is ignored
    // reception is not allowed in
    const rctx = await browser.newContext();
    const r = await rctx.newPage();
    await signIn(r, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    await o.goto('/padharosaa/qr?room=204'); // a room's own sheet: only that room
    await expect(o.getByTestId('qr-card')).toHaveCount(1);
    await expect(o.getByTestId('qr-card')).toContainText('Room 204');
    await r.goto('/padharosaa/qr');
    await expect(r).toHaveURL(/\/padharosaa\/desk$/);
    await rctx.close();
  } finally {
    await octx.close();
    await gctx.close();
  }
});

test('a public demo hotel: one link, no sign-in, and the demo answers itself; a normal hotel has no demo link', async ({ browser }) => {
  test.setTimeout(150_000); // the demo answers after about 20 seconds
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const g = await ctx.newPage();
  try {
    // not switched on: nothing to see
    const closed = await g.goto('/padharosaa/try/spice-garden');
    expect(closed?.status()).toBe(404);
    await q(`update public.hotel_settings set is_demo = true where restaurant_id = ${RID}`);
    await q(`insert into public.rooms (restaurant_id, number) select ${RID}, 'D' || n from generate_series(1, 8) n on conflict do nothing`);
    await g.goto('/padharosaa/try/spice-garden');
    await expect(g.getByRole('heading', { name: /Spice Garden/ })).toBeVisible();
    await g.getByRole('button', { name: 'Try it on this phone' }).click();
    await expect(g.getByText('Namaste, Demo')).toBeVisible();
    await g.getByRole('button', { name: 'Accept cookies' }).click();
    await g.getByText('Services', { exact: true }).click();
    await g.getByLabel('Extra towels').check();
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByRole('heading', { name: 'Sent' })).toBeVisible();
    // nobody is at a desk: the demo accepts it, then completes it
    await expect(g.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: 60_000 });
  } finally {
    await q(`update public.hotel_settings set is_demo = false where restaurant_id = ${RID}`);
    await ctx.close();
  }
});

test('guest services ask for what the team needs; a declined request is not left hanging; AC problems cannot be declined; French works', async ({ page, browser }) => {
  await q(`insert into public.rooms (restaurant_id, number) values (${RID}, '204') on conflict do nothing`);
  await q(`update public.hotel_settings set reception_phone = '9828114008' where restaurant_id = ${RID}`);
  await q(`delete from public.buffets where restaurant_id = ${RID}`); // an earlier test set one: this guest must see no empty or filled-in buffet tile
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const g = await ctx.newPage();
  try {
    await g.goto(second);
    await g.getByLabel('Your name').fill('Services Guest');
    await g.getByRole('button', { name: 'Accept cookies' }).click();
    await g.getByLabel('Mobile number').fill('9855555555');
    await g.getByLabel('Room number').fill('204');
    await g.getByRole('button', { name: 'Enter' }).click();
    await expect(g.getByText('Namaste, Services')).toBeVisible();
    // no empty tiles: nothing is set for the buffet and no plan is saved
    await expect(g.getByText("Today's buffet")).toHaveCount(0);
    await expect(g.getByText('My plan')).toHaveCount(0);
    // Services: each kind asks for what it needs
    await g.getByText('Services', { exact: true }).click();
    await expect(g.getByText(/Step 1 of 2/)).toHaveCount(0);
    await g.getByRole('button', { name: 'Wake-up call', exact: true }).click();
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByText('Please choose a time.')).toBeVisible();
    await g.getByLabel('Wake-up time').fill('06:30');
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByRole('heading', { name: 'Sent' })).toBeVisible();
    expect((await q<{ detail: string }>(`select detail from public.requests where restaurant_id = ${RID} and type = 'wake' order by created_at desc limit 1`))[0]!.detail).toBe('Wake-up call at 6:30 AM');
    await g.getByRole('button', { name: 'Back to home' }).click();
    await g.getByText('Services', { exact: true }).click();
    await g.getByRole('button', { name: 'Cab', exact: true }).click();
    await g.getByLabel('Pickup time').fill('09:15');
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByText('Please say where you want to go.')).toBeVisible();
    await g.getByLabel('Where do you want to go?').fill('Jaipur airport');
    await g.getByLabel('Car type').selectOption('SUV');
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByRole('heading', { name: 'Sent' })).toBeVisible();
    expect((await q<{ detail: string }>(`select detail from public.requests where restaurant_id = ${RID} and type = 'cab' order by created_at desc limit 1`))[0]!.detail).toBe('To: Jaipur airport · Pickup at 9:15 AM · Car: SUV');
    // laundry pick-up: housekeeping, with the time the guest wants it collected
    await g.getByRole('button', { name: 'Back to home' }).click();
    await g.getByText('Services', { exact: true }).click();
    await g.getByRole('button', { name: 'Laundry', exact: true }).click();
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByText('Please choose a time.')).toBeVisible();
    await g.getByLabel('Pickup time').fill('17:00');
    await g.getByRole('button', { name: 'Send request' }).click();
    await expect(g.getByRole('heading', { name: 'Sent' })).toBeVisible();
    const lau = (await q<{ label: string; detail: string; team: string }>(`select label, detail, team from public.requests where restaurant_id = ${RID} and label like '%Laundry pick-up' order by created_at desc limit 1`))[0]!;
    expect(lau).toEqual({ label: 'Housekeeping: Laundry pick-up', detail: 'Pickup time: 5:00 PM', team: 'housekeeping' });
    // a problem the team must fix: AC
    await g.getByRole('button', { name: 'Back to home' }).click();
    await g.getByText('Help / problem').first().click();
    await g.getByRole('button', { name: 'AC or electrical' }).click();
    await g.getByRole('button', { name: 'Send to reception' }).click();
    await expect(g.getByRole('heading', { name: 'Sent' })).toBeVisible();
    // reception: the cab can be declined with cab-shaped reasons; the AC problem cannot be declined at all
    await signIn(page, 'waiter@spice-garden.demo', /\/padharosaa\/desk$/, '/padharosaa/desk');
    const ac = page.locator('li', { hasText: 'AC or electrical' }).first();
    await expect(ac).toBeVisible();
    await ac.getByRole('button', { name: /^More/ }).click();
    await expect(ac.getByRole('button', { name: /Decline/ })).toHaveCount(0);
    const cab = page.locator('li', { hasText: 'To: Jaipur airport' }).first();
    await cab.getByRole('button', { name: /^More/ }).click();
    await cab.getByRole('button', { name: /Decline/ }).click();
    await expect(cab.getByRole('button', { name: 'Fully booked, please choose another time' })).toHaveCount(0);
    await cab.getByRole('button', { name: 'We will call you' }).click();
    await cab.getByRole('button', { name: 'Send to guest' }).click();
    // the guest is not left hanging: Try again and Call reception, and no "Done" step waiting
    await g.reload();
    await g.getByText('Cab', { exact: false }).first().click();
    const actions = g.getByTestId('declined-actions');
    await expect(actions.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(actions.getByRole('link', { name: 'Call reception' })).toBeVisible();
    await expect(g.getByRole('listitem').filter({ hasText: /^Done/ })).toHaveCount(0);
    await actions.getByRole('button', { name: 'Try again' }).click();
    await expect(g.getByRole('heading', { name: 'Services' })).toBeVisible();
    // French
    await g.getByRole('button', { name: 'Back' }).click();
    await g.getByLabel('Language').selectOption('fr');
    await expect(g.getByText('Bonjour, Services')).toBeVisible();
    expect(await g.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await ctx.close();
    await q(`update public.hotel_settings set reception_phone = null where restaurant_id = ${RID}`);
  }
});
