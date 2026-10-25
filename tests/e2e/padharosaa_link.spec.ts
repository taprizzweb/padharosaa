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
    await expect(nav.getByRole('link', { name: 'Menu (sold-out switches)' })).toBeVisible();
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
  await expect(nav.getByRole('link')).toHaveText(['Desk', 'Menu', 'Settings']);
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
    await expect(g.getByText('Namaste, Demo guest')).toBeVisible();
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
    await expect(ac.getByRole('button', { name: /Decline/ })).toHaveCount(0);
    const cab = page.locator('li', { hasText: 'To: Jaipur airport' }).first();
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
