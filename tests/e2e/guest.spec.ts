import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// @axe-core/playwright ships its own copy of Playwright's types; the runtime object is the same.
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
import { newTable, ordersOf, q, sessionOf, staff } from './helpers';

const SHOTS = 'test-results/shots';
const KITCHEN = 'kitchen@spice-garden.demo';
const WAITER = 'waiter@spice-garden.demo';
const OWNER = 'owner@spice-garden.demo';

async function open(page: Page, t: { slug: string; token: string }) {
  await page.goto(`/${t.slug}?k=${t.token}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
const card = (page: Page, name: string) => page.locator('li', { has: page.getByRole('heading', { name, level: 3 }) });
const add = (page: Page, name: string) => page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
const more = (page: Page, name: string) => page.getByRole('button', { name: `Add one more ${name}` }).click();
const dialog = (page: Page) => page.getByRole('dialog');
// each sheet has a header (X) and a footer Close button; both do the same thing
const closeSheet = (page: Page) => dialog(page).getByRole('button', { name: 'Close', exact: true }).last().click();
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

async function placeOrderFromCart(page: Page) {
  await page.getByRole('button', { name: /View cart/ }).click();
  await dialog(page).getByRole('button', { name: 'Place order' }).click();
}

test.describe('room service', () => {
  const LINK = 'e'.repeat(64);
  const setup = (rooms: string) => q(`update public.restaurants set room_token = $1, room_numbers = $2::text[] where slug = 'spice-garden'`, [LINK, rooms]);
  const teardown = () => q(`update public.restaurants set room_token = null, room_numbers = '{}' where slug = 'spice-garden'`);

  test('the shared link asks for the room, then the order arrives as that room', async ({ page }) => {
    await setup('{101,204}');
    try {
      await page.goto(`/spice-garden?k=${LINK}`);
      await expect(page.getByRole('heading', { name: 'Order to your room' })).toBeVisible();
      // the menu can be read but nothing can be ordered yet, and there is no "invalid QR" warning
      await expect(page.getByRole('button', { name: 'Add Masala Chai', exact: true })).toHaveCount(0);
      await expect(page.getByText('no longer valid')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-room-1-ask.png` });

      await page.getByLabel('Room number').selectOption('204');
      await page.getByRole('button', { name: 'Continue to the menu' }).click();
      await expect(page).not.toHaveURL(new RegExp(LINK));
      await expect(page).toHaveURL(/\/spice-garden\?k=[0-9a-f]{64}$/);
      await expect(page.getByText('Room 204', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Order to your room' })).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-room-2-menu.png` });

      await add(page, 'Masala Chai');
      await placeOrderFromCart(page);
      await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
      const [row] = await q<{ label: string; session_id: string }>(
        `select t.label, o.session_id from public.orders o join public.dining_tables t on t.id = o.table_id where t.label = 'Room 204' and t.restaurant_id = (select id from public.restaurants where slug = 'spice-garden') order by o.created_at desc limit 1`,
      );
      expect(row?.label).toBe('Room 204');
      await staff(OWNER, 'staff_close_session', { p_session_id: row!.session_id, p_force: true, p_reason: 'test' });
    } finally {
      await teardown();
    }
  });

  test('with no room list a typed room number is accepted; a junk one is refused politely', async ({ page }) => {
    await setup('{}');
    try {
      await page.goto(`/spice-garden?k=${LINK}`);
      await page.getByLabel('Room number').fill('<b>');
      await page.getByRole('button', { name: 'Continue to the menu' }).click();
      await expect(alertWith(page, 'Please enter a room number')).toBeVisible();
      await page.getByLabel('Room number').fill('suite 7');
      await page.getByRole('button', { name: 'Continue to the menu' }).click();
      await expect(page.getByText('Room SUITE 7', { exact: true })).toBeVisible();
    } finally {
      await teardown();
    }
  });
});

test.describe('shared table link and footer', () => {
  const LINK = 'f'.repeat(64);
  const on = () => q(`update public.restaurants set table_token = $1, room_token = null where slug = 'spice-garden'`, [LINK]);
  const off = () => q(`update public.restaurants set table_token = null where slug = 'spice-garden'`);

  test('the shared table link asks which table, offers tables only, and the order lands on that table', async ({ page }) => {
    const t = await newTable();
    await q(`insert into public.dining_tables (restaurant_id, label, kind) select id, 'Room 9', 'room' from public.restaurants where slug = 'spice-garden' on conflict do nothing`);
    await on();
    try {
      await page.goto(`/spice-garden?k=${LINK}`);
      await expect(page.getByRole('heading', { name: 'Which table are you at?' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Order to your room' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Add Masala Chai', exact: true })).toHaveCount(0);
      const options = await page.getByLabel('Table number').locator('option').allTextContents();
      expect(options).toContain(t.label);
      expect(options.some((o) => o.startsWith('Room'))).toBe(false);

      await page.getByLabel('Table number').selectOption(t.label);
      await page.getByRole('button', { name: 'Continue to the menu' }).click();
      await expect(page).not.toHaveURL(new RegExp(LINK));
      await expect(page).toHaveURL(new RegExp(`k=${t.token}$`));
      await expect(page.getByText(`Table ${t.label}`, { exact: true })).toBeVisible();
      await add(page, 'Masala Chai');
      await placeOrderFromCart(page);
      await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
      expect((await ordersOf(t.id)).length).toBe(1);
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-tablelink-menu.png` });
    } finally {
      await off();
    }
  });

  test('every menu ends with "Powered by Taprizz"', async ({ page }) => {
    const t = await newTable();
    await open(page, t);
    await expect(page.getByText('Powered by')).toBeVisible();
    await expect(page.getByText('Taprizz', { exact: true })).toBeVisible();
    const ig = page.getByRole('link', { name: '@taprizz.in' });
    await expect(ig).toHaveAttribute('href', 'https://www.instagram.com/taprizz.in');
    await expect(ig).toHaveAttribute('target', '_blank');
    await expect(ig).toHaveAttribute('rel', /noopener/);
  });
});

test.describe('sizes and options', () => {
  async function seedShake() {
    const name = `Oreo Shake ${Math.random().toString(36).slice(2, 5)}`;
    const [cat] = await q<{ id: string; restaurant_id: string }>(`select id, restaurant_id from public.categories where restaurant_id = (select id from public.restaurants where slug = 'spice-garden') and active order by sort_order limit 1`);
    const [it] = await q<{ id: string }>(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1, $2, $3, 12000) returning id`, [cat!.restaurant_id, cat!.id, name]);
    await q(`insert into public.item_variants (restaurant_id, item_id, name, price_paise, sort_order, is_available) values ($1, $2, 'Small', 12000, 1, true), ($1, $2, 'Large', 20000, 2, true), ($1, $2, 'XL', 25000, 3, false)`, [cat!.restaurant_id, it!.id]);
    const [g] = await q<{ id: string }>(`insert into public.item_option_groups (restaurant_id, item_id, name, required, max_select, sort_order) values ($1, $2, 'Topping', true, 1, 1) returning id`, [cat!.restaurant_id, it!.id]);
    await q(`insert into public.item_options (restaurant_id, group_id, name, price_delta_paise, sort_order) values ($1, $2, 'Oreo', 0, 1), ($1, $2, 'Choco', 1500, 2)`, [cat!.restaurant_id, g!.id]);
    const [g2] = await q<{ id: string }>(`insert into public.item_option_groups (restaurant_id, item_id, name, required, max_select, sort_order) values ($1, $2, 'Extras', false, 2, 2) returning id`, [cat!.restaurant_id, it!.id]);
    await q(`insert into public.item_options (restaurant_id, group_id, name, price_delta_paise, sort_order) values ($1, $2, 'Cream', 1000, 1), ($1, $2, 'Nuts', 2000, 2), ($1, $2, 'Syrup', 500, 3)`, [cat!.restaurant_id, g2!.id]);
    return { id: it!.id, name };
  }

  test('tap a dish, choose a size and options, see the price, order; staff get the full name', async ({ page }) => {
    const dish = await seedShake();
    const t = await newTable();
    try {
      await open(page, t);
      const dishCard = page.locator('li', { has: page.getByRole('heading', { name: dish.name, level: 3 }) });
      await expect(dishCard).toContainText('from ₹120');
      await page.getByRole('button', { name: `Add ${dish.name}`, exact: true }).click();
      await expect(dialog(page).getByRole('group', { name: /Choose a size/ })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-choose-1-sheet.png` });

      // nothing is pre-selected: adding without choosing explains what is missing
      await dialog(page).getByRole('button', { name: /^Add to cart/ }).click({ force: true }); // aria-disabled, not disabled: it must still explain
      await expect(dialog(page).getByText('Please choose a size.')).toBeVisible();
      await expect(dialog(page).getByRole('radio', { name: /XL/ })).toBeDisabled(); // sold-out size
      await dialog(page).getByRole('radio', { name: /^Large/ }).check();
      await dialog(page).getByRole('button', { name: /^Add to cart/ }).click({ force: true });
      await expect(dialog(page).getByText('Please choose from "Topping".')).toBeVisible();
      await dialog(page).getByRole('radio', { name: /^Choco/ }).check();
      await dialog(page).getByRole('checkbox', { name: /^Cream/ }).check();
      await dialog(page).getByRole('checkbox', { name: /^Nuts/ }).check();
      await expect(dialog(page).getByRole('checkbox', { name: /^Syrup/ })).toBeDisabled(); // at most 2 extras
      // 200 + 15 + 10 + 20 = 245
      await expect(dialog(page).getByRole('button', { name: 'Add to cart · ₹245' })).toBeVisible();
      await dialog(page).getByRole('button', { name: `Add one more ${dish.name}` }).click();
      await expect(dialog(page).getByRole('button', { name: 'Add to cart · ₹490' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-choose-2-chosen.png` });
      await dialog(page).getByRole('button', { name: /^Add to cart/ }).click();
      await expect(dialog(page)).toHaveCount(0);

      // the card shows how many are in the cart; a second, different choice is its own line
      await expect(dishCard.getByLabel('2 in your cart')).toBeVisible();
      await page.getByRole('button', { name: `Add ${dish.name}`, exact: true }).click();
      await dialog(page).getByRole('radio', { name: /^Small/ }).check();
      await dialog(page).getByRole('radio', { name: /^Oreo/ }).check();
      await dialog(page).getByRole('button', { name: 'Add to cart · ₹120' }).click();

      await page.getByRole('button', { name: /View cart/ }).click();
      await expect(dialog(page)).toContainText('Large · Choco, Cream, Nuts');
      await expect(dialog(page)).toContainText('Small · Oreo');
      await expect(dialog(page)).toContainText('₹610'); // 2 x 245 + 120
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-choose-3-cart.png` });
      await dialog(page).getByRole('button', { name: 'Place order' }).click();
      await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();

      const rows = await q<{ n: string; p: number; qty: number }>(`select name_en_snapshot n, unit_price_paise p, qty from public.order_items oi join public.orders o on o.id = oi.order_id where o.table_id = $1 order by p desc`, [t.id]);
      expect(rows).toEqual([
        { n: `${dish.name} (Large) + Choco, Cream, Nuts`, p: 24500, qty: 2 },
        { n: `${dish.name} (Small) + Oreo`, p: 12000, qty: 1 },
      ]);
      // the guest's own order list shows the full name too
      await expect(page.getByText(`${dish.name} (Large) + Choco, Cream, Nuts`)).toBeVisible();
      await staff(OWNER, 'staff_close_session', { p_session_id: (await sessionOf(t.id))!, p_force: true, p_reason: 'test' });
    } finally {
      await q(`delete from public.items where id = $1`, [dish.id]);
    }
  });

  test('the choose sheet has no accessibility violations and works with the keyboard', async ({ page }) => {
    const dish = await seedShake();
    try {
      await open(page, await newTable());
      const opener = page.getByRole('button', { name: `Add ${dish.name}`, exact: true });
      await opener.focus();
      await page.keyboard.press('Enter');
      await expect(dialog(page)).toBeVisible();
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toHaveCount(0);
      await expect(opener).toBeFocused();
    } finally {
      await q(`delete from public.items where id = $1`, [dish.id]);
    }
  });
});

test.describe('call for problems page', () => {
  const LINK = 'd4'.repeat(32);
  const on = (rooms = '{}') => q(`update public.restaurants set help_token = $1, room_numbers = $2::text[], help_topics = '{Towel or bedsheet,Water not coming,WiFi not working}' where slug = 'spice-garden'`, [LINK, rooms]);
  const off = async () => {
    await q(`update public.restaurants set help_token = null, room_numbers = '{}' where slug = 'spice-garden'`);
    await q(`delete from public.help_requests where restaurant_id = (select id from public.restaurants where slug = 'spice-garden')`);
  };

  test('a guest types the room, taps the problems, adds a note and sends; it is saved for reception', async ({ page }) => {
    await on();
    try {
      await page.goto(`/spice-garden/help?k=${LINK}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Call for problems' })).toBeVisible();
      await expect(page.getByText('Powered by')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-help-1-form.png`, fullPage: true });

      // an empty form explains itself, nothing is sent
      await page.getByRole('button', { name: 'Send to reception' }).click();
      await expect(alertWith(page, 'Please enter your room number')).toBeVisible();
      await page.getByLabel('Your room number').fill('201');
      await page.getByRole('button', { name: 'Send to reception' }).click();
      await expect(alertWith(page, 'Please tap a problem or write a few words')).toBeVisible();

      await page.getByLabel('Towel or bedsheet').check({ force: true });
      await page.getByLabel('WiFi not working').check({ force: true });
      await page.getByLabel('Anything else? (optional)').fill('The router light is red');
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-help-2-filled.png`, fullPage: true });
      await page.getByRole('button', { name: 'Send to reception' }).click();
      await expect(page.getByRole('heading', { name: 'Sent to reception' })).toBeVisible();
      await expect(page.getByText('Room 201: the team has been told')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-help-3-sent.png`, fullPage: true });

      const [row] = await q<{ room: string; topics: string[]; note: string; status: string }>(`select room, topics, note, status from public.help_requests where restaurant_id = (select id from public.restaurants where slug = 'spice-garden') order by created_at desc limit 1`);
      expect(row).toEqual({ room: '201', topics: ['Towel or bedsheet', 'WiFi not working'], note: 'The router light is red', status: 'open' });

      await page.getByRole('button', { name: 'Report another problem' }).click();
      await expect(page.getByRole('button', { name: 'Send to reception' })).toBeVisible();
    } finally {
      await off();
    }
  });

  test('a note alone is enough; with a room list the guest picks from it', async ({ page }) => {
    await on('{101,102,201}');
    try {
      await page.goto(`/spice-garden/help?k=${LINK}`);
      await page.getByLabel('Your room number').selectOption('102');
      await page.getByLabel('Anything else? (optional)').fill('The window will not close');
      await page.getByRole('button', { name: 'Send to reception' }).click();
      await expect(page.getByRole('heading', { name: 'Sent to reception' })).toBeVisible();
      const [row] = await q<{ room: string; topics: string[]; note: string }>(`select room, topics, note from public.help_requests where restaurant_id = (select id from public.restaurants where slug = 'spice-garden') order by created_at desc limit 1`);
      expect(row).toEqual({ room: '102', topics: [], note: 'The window will not close' });
    } finally {
      await off();
    }
  });

  test('a wrong, missing or switched-off link shows a friendly message and a wrong restaurant is not found', async ({ page }) => {
    await on();
    try {
      await page.goto(`/spice-garden/help?k=${'e5'.repeat(32)}`);
      await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
      await page.goto('/spice-garden/help');
      await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
      await page.goto(`/spice-garden/help?k=not-hex`);
      await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
      expect((await page.goto(`/no-such-place/help?k=${LINK}`))!.status()).toBe(404);
    } finally {
      await off();
    }
    await page.goto(`/spice-garden/help?k=${LINK}`);
    await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
  });

  test('the help page has no accessibility violations and every control is at least 44px tall', async ({ page }) => {
    await on();
    try {
      await page.goto(`/spice-garden/help?k=${LINK}`);
      await expect(page.getByRole('button', { name: 'Send to reception' })).toBeVisible();
      const r = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      for (const c of await page.locator('label:has(input[type=checkbox]), button, input[type=text], input:not([type]), select, textarea').all()) {
        const b = await c.boundingBox();
        if (b) expect(b.height, await c.innerText().catch(() => 'control')).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await off();
    }
  });
});

test.describe('guest journey', () => {
  test('scan → order → live status → call waiter → ask bill → paid → thank-you', async ({ page }, info) => {
    const t = await newTable();
    await open(page, t);
    await expect(page.getByText(`Table ${t.label}`)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-1-menu.png` });

    // sold-out dishes are greyed and cannot be added
    const sold = card(page, 'Chana Masala');
    await expect(sold).toContainText('Sold out');
    await expect(sold.getByRole('button')).toHaveCount(0);

    await add(page, 'Paneer Tikka');
    await more(page, 'Paneer Tikka');
    await add(page, 'Sweet Lassi');
    await expect(page.getByRole('button', { name: /View cart/ })).toContainText('₹650');

    await page.getByRole('button', { name: /View cart/ }).click();
    await dialog(page).getByLabel('Note for the kitchen').fill('Less spicy please');
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-2-cart.png` });
    await dialog(page).getByRole('button', { name: 'Place order' }).click();

    // status screen: not accepted yet
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    await expect(page.getByText('Waiting for the team to accept')).toBeVisible();
    await expect(page.getByText('2 ×')).toBeVisible();
    const orders = await ordersOf(t.id);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ total_paise: 65000, note: 'Less spicy please', status: 'placed' });
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-3-status-placed.png` });

    // staff accept → the guest's screen follows (polled every 4 s)
    const id = orders[0]!.id;
    await staff(KITCHEN, 'staff_set_order_status', { p_order_id: id, p_new: 'preparing' });
    await expect(page.locator('[aria-current="step"]')).toContainText('Preparing');
    await expect(page.getByText('Waiting for the team to accept')).toHaveCount(0);
    await staff(KITCHEN, 'staff_set_order_status', { p_order_id: id, p_new: 'ready' });
    await expect(page.locator('[aria-current="step"]')).toContainText('Ready');
    await staff(WAITER, 'staff_set_order_status', { p_order_id: id, p_new: 'served' });
    await expect(page.locator('[aria-current="step"]')).toContainText('Served');
    await expect(page.getByText('Table total').locator('..')).toContainText('₹650');
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-4-status-served.png` });

    // call waiter
    await page.getByRole('button', { name: 'Call waiter' }).click();
    await dialog(page).getByRole('button', { name: 'Water' }).click();
    await expect(dialog(page)).toContainText('Waiter is on the way');
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-5-waiter.png` });
    await closeSheet(page);
    const reqs = await q<{ type: string; reason: string; status: string }>(`select type, reason, status from public.service_requests where table_id = $1`, [t.id]);
    expect(reqs).toEqual([{ type: 'waiter', reason: 'water', status: 'open' }]);

    // ask for the bill, then change the payment method while it is open
    await page.getByRole('button', { name: 'Ask for bill' }).click();
    await dialog(page).getByRole('button', { name: 'UPI' }).click();
    await expect(dialog(page)).toContainText('The bill is on its way');
    await expect(dialog(page)).toContainText('Paying by UPI');
    await dialog(page).getByRole('button', { name: 'Change payment method' }).click();
    await dialog(page).getByRole('button', { name: 'Card' }).click();
    await expect(dialog(page)).toContainText('Paying by Card', { timeout: 1500 }); // shown at once, not after the next 4-5 s refresh
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-6-bill.png` });
    await closeSheet(page);
    const bill = await q<{ pay_mode: string; n: number }>(`select pay_mode, count(*) over ()::int n from public.service_requests where table_id = $1 and type = 'bill' and status = 'open'`, [t.id]);
    expect(bill).toEqual([{ pay_mode: 'card', n: 1 }]);
    await expect(page.getByText('Waiter is on the way · The bill is on its way')).toBeVisible();

    // staff mark the table paid → thank-you with total and the review button
    const sid = (await sessionOf(t.id))!;
    await staff(WAITER, 'staff_close_session', { p_session_id: sid, p_force: false });
    await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await expect(page.getByText('Total: ₹650')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-7-thanks.png` });

    // no Google-review button any more; without an explore link the thank-you screen has no outside button at all
    await expect(page.getByRole('link', { name: 'Rate us on Google' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Explore more before leaving' })).toHaveCount(0);
  });

  test('after the table is paid the thank-you screen offers the one "Explore more before leaving" button', async ({ page }) => {
    await q(`update public.restaurants set explore_code = 'spice-garden_1' where slug = 'spice-garden'`);
    try {
      const t = await newTable();
      await open(page, t);
      await add(page, 'Masala Chai');
      await placeOrderFromCart(page);
      await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
      await staff(OWNER, 'staff_close_session', { p_session_id: (await sessionOf(t.id))!, p_force: true, p_reason: 'test' });
      await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
      const go = page.getByRole('link', { name: 'Explore more before leaving' });
      await expect(go).toHaveAttribute('href', 'https://smarty.taprizz.in/sq/spice-garden_1');
      await expect(go).toHaveAttribute('target', '_blank');
      await expect(go).toHaveAttribute('rel', /noopener/);
      await expect(page.getByRole('link', { name: 'Rate us on Google' })).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-7-thanks-explore.png` });
    } finally {
      await q(`update public.restaurants set explore_code = null where slug = 'spice-garden'`);
    }
  });

  test('the guest can reorder after paying: a new scan starts a fresh table session', async ({ page }) => {
    const t = await newTable();
    await open(page, t);
    await add(page, 'Masala Chai');
    await placeOrderFromCart(page);
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    const sid = (await sessionOf(t.id))!;
    await staff(OWNER, 'staff_close_session', { p_session_id: sid, p_force: true, p_reason: 'e2e' });
    await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to menu' }).click();
    await add(page, 'Masala Chai');
    await placeOrderFromCart(page);
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    await expect(page.getByText('Thank you!')).toHaveCount(0);
    expect(await sessionOf(t.id)).not.toBe(sid);
  });
});

test.describe('menu behaviour', () => {
  test('cart survives a refresh; search and filters work; categories scroll', async ({ page }) => {
    const t = await newTable();
    await open(page, t);
    await add(page, 'Butter Naan');
    await page.reload();
    await expect(page.getByRole('button', { name: /View cart/ })).toContainText('₹60');

    await page.getByLabel('Search the menu').fill('biryani');
    await expect(card(page, 'Veg Biryani')).toBeVisible();
    await expect(card(page, 'Chicken Biryani')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Paneer Tikka', level: 3 })).toHaveCount(0);
    await page.getByLabel('Search the menu').fill('');

    await page.getByRole('button', { name: 'Veg', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Chicken Tikka', level: 3 })).toHaveCount(0);
    await expect(card(page, 'Jain Dal Tadka')).toBeVisible(); // Jain is vegetarian
    await page.getByRole('button', { name: 'Jain', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Paneer Tikka', level: 3 })).toHaveCount(0);
    await expect(card(page, 'Jain Mix Veg')).toBeVisible();
    await page.getByRole('button', { name: 'Veg', exact: true }).click();
    await page.getByRole('button', { name: 'Jain', exact: true }).click();

    await page.getByRole('button', { name: 'Bestsellers' }).click();
    await expect(card(page, 'Paneer Tikka')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hara Bhara Kebab', level: 3 })).toHaveCount(0);
    await page.getByRole('button', { name: 'Bestsellers' }).click();

    await page.getByRole('navigation', { name: 'Menu categories' }).getByRole('button', { name: 'Beverages' }).click();
    await expect(page.getByRole('heading', { name: 'Beverages', level: 2 })).toBeInViewport();
    await expect(page.getByRole('navigation', { name: 'Menu categories' }).getByRole('button', { name: 'Beverages' })).toHaveAttribute('aria-current', 'true');
  });
});

test.describe('friendly states', () => {
  test('invalid, rotated and missing QR codes cannot order', async ({ page }) => {
    const t = await newTable();
    await page.goto(`/${t.slug}?k=${'f'.repeat(64)}`);
    await expect(alertWith(page, 'This QR is no longer valid')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Call waiter' })).toHaveCount(0);
    await page.goto(`/${t.slug}?k=not-a-token`);
    await expect(alertWith(page, 'This QR is no longer valid')).toBeVisible();
    await page.goto(`/${t.slug}`);
    await expect(page.getByRole('status').first()).toContainText('Scan your table QR to order');
    await expect(page.getByRole('heading', { name: 'Paneer Tikka', level: 3 })).toBeVisible(); // menu still readable
    // rotating the QR kills the printed one
    await staff(OWNER, 'mgr_rotate_table_token', { p_table_id: t.id });
    await page.goto(`/${t.slug}?k=${t.token}`);
    await expect(alertWith(page, 'This QR is no longer valid')).toBeVisible();
  });

  test('suspended restaurant shows a clear message and takes no orders', async ({ page }) => {
    const t = await newTable('cafe-aroma');
    await q(`update public.restaurants set status = 'suspended' where slug = 'cafe-aroma'`);
    try {
      await page.goto(`/${t.slug}?k=${t.token}`);
      await expect(page.getByRole('heading', { name: 'Ordering is paused' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(0);
    } finally {
      await q(`update public.restaurants set status = 'active' where slug = 'cafe-aroma'`);
    }
  });

  test('unknown restaurant gives a 404 page', async ({ page }) => {
    const res = await page.goto('/no-such-place');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('We could not find this restaurant')).toBeVisible();
  });

  test('privacy notice is readable', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();
    await expect(page.getByText('We do not ask for your name')).toBeVisible();
  });
});

test.describe('reliability', () => {
  test('offline: the order fails politely, the cart is kept, and the retry creates exactly one order', async ({ page, context }) => {
    const t = await newTable();
    await open(page, t);
    await add(page, 'Masala Chai');
    await page.getByRole('button', { name: /View cart/ }).click();
    await context.setOffline(true);
    await expect(page.getByText("You're offline", { exact: false }).first()).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Place order' }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('No connection. Your cart is saved.');
    expect(await ordersOf(t.id)).toHaveLength(0);
    await context.setOffline(false);
    await dialog(page).getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    expect(await ordersOf(t.id)).toHaveLength(1);
  });

  test('double-tapping Place order never creates two orders', async ({ page }) => {
    const t = await newTable();
    await open(page, t);
    await add(page, 'Masala Chai');
    await page.getByRole('button', { name: /View cart/ }).click();
    await dialog(page).getByRole('button', { name: 'Place order' }).dblclick();
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    expect(await ordersOf(t.id)).toHaveLength(1);
  });

  test('a dish that sold out while the guest was choosing is explained and removed', async ({ page }) => {
    const t = await newTable();
    await open(page, t);
    await add(page, 'Paneer Tikka');
    await add(page, 'Sweet Lassi');
    const [item] = await q<{ id: string }>(`select i.id from public.items i join public.restaurants r on r.id = i.restaurant_id where r.slug = 'spice-garden' and i.name_en = 'Paneer Tikka'`);
    await staff(KITCHEN, 'staff_set_item_availability', { p_item_ids: [item!.id], p_available: false });
    try {
      await page.getByRole('button', { name: /View cart/ }).click();
      await dialog(page).getByRole('button', { name: 'Place order' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('just sold out');
      expect(await ordersOf(t.id)).toHaveLength(0);
      // the menu refreshed: the sold-out dish left the cart, the other one stayed
      await expect(dialog(page).getByText('Paneer Tikka')).toHaveCount(0);
      await expect(dialog(page).getByText('Sweet Lassi')).toBeVisible();
      await expect(dialog(page)).toContainText('We updated your cart');
    } finally {
      await staff(KITCHEN, 'staff_set_item_availability', { p_item_ids: [item!.id], p_available: true });
    }
  });
});

test.describe('security on the real server', () => {
  test('API refuses cross-site posts, prices from the client, and bad content types', async ({ page, request }) => {
    const t = await newTable();
    const body = { slug: t.slug, token: t.token, idempotency_key: 'e2e-key-0001-abcd', items: [{ item_id: '00000000-0000-4000-8000-000000000000', qty: 1 }] };
    // no Origin header at all (what a cross-site form post or a script sends) -> refused
    expect((await request.post('/api/guest/order', { data: body })).status()).toBe(403);
    const base = page.context().request;
    const evil = await base.post('/api/guest/order', { data: body, headers: { origin: 'https://evil.example' } });
    expect(evil.status()).toBe(403);
    expect(((await evil.json()) as { error: { key: string } }).error.key).toBe('origin_not_allowed');
    const origin = new URL(page.url() === 'about:blank' ? (process.env.E2E_BASE_URL ?? 'http://localhost:3100') : page.url()).origin;
    const tamper = await base.post('/api/guest/order', { data: { ...body, total_paise: 1 }, headers: { origin } });
    expect(tamper.status()).toBe(400);
    const form = await base.post('/api/guest/order', { form: { a: '1' }, headers: { origin } });
    expect(form.status()).toBe(415);
    expect((await base.get('/api/guest/status?slug=spice-garden')).status()).toBe(401);
    expect(await ordersOf(t.id)).toHaveLength(0);
  });

  test('security headers and nonce are present on guest pages', async ({ page }) => {
    const t = await newTable();
    const res = await page.goto(`/${t.slug}?k=${t.token}`);
    const h = res!.headers();
    expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['cache-control'] ?? '').not.toContain('public');
  });

  test('no console errors or CSP violations while using the page', async ({ page }) => {
    const bad: string[] = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) bad.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
    const t = await newTable();
    await open(page, t);
    await add(page, 'Masala Chai');
    await placeOrderFromCart(page);
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    await page.getByRole('button', { name: 'Call waiter' }).click();
    await dialog(page).getByRole('button', { name: 'Water' }).click();
    await expect(dialog(page)).toContainText('Waiter is on the way');
    expect(bad).toEqual([]);
  });
});

test.describe('orders only near the cafe', () => {
  const CAFE = { latitude: 26.9124, longitude: 75.7873 };
  test('a guest far away or without location access is told why; a guest at the cafe orders normally', async ({ page, context, browser }) => {
    await q(`update public.restaurants set geo_required = true, geo_lat = $1, geo_lng = $2, geo_radius_m = 150 where slug = 'spice-garden'`, [CAFE.latitude, CAFE.longitude]);
    try {
      // no location permission at all
      const noPerm = await browser.newContext(test.info().project.use as never);
      const p2 = await noPerm.newPage();
      try {
        const t2 = await newTable();
        await open(p2, t2);
        await add(p2, 'Paneer Tikka');
        await placeOrderFromCart(p2);
        // a refusal answers at once; a browser that never answers the permission prompt ends after our 12 s timeout
        await expect(dialog(p2).getByRole('alert')).toContainText(/Location access was not allowed|could not share its location/, { timeout: 25_000 });
        expect(await ordersOf(t2.id)).toHaveLength(0);
      } finally {
        await noPerm.close();
      }

      const t = await newTable();
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({ latitude: CAFE.latitude + 0.05, longitude: CAFE.longitude, accuracy: 20 });
      await open(page, t);
      await add(page, 'Paneer Tikka');
      await placeOrderFromCart(page);
      await expect(dialog(page).getByRole('alert')).toContainText('too far away');
      expect(await ordersOf(t.id)).toHaveLength(0);

      await context.setGeolocation({ latitude: CAFE.latitude + 0.0004, longitude: CAFE.longitude, accuracy: 25 });
      await dialog(page).getByRole('button', { name: 'Place order' }).click();
      await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
      expect(await ordersOf(t.id)).toHaveLength(1);
    } finally {
      await q(`update public.restaurants set geo_required = false, geo_lat = null, geo_lng = null where slug = 'spice-garden'`);
    }
  });
});

test.describe('dish details', () => {
  test('a dish with a photo opens a details sheet with the full description and an Add button; favourites show bestsellers', async ({ page }) => {
    const t = await newTable();
    const [it] = await q<{ id: string; rid: string; name_en: string }>(`select i.id, i.restaurant_id rid, i.name_en from public.items i join public.restaurants r on r.id = i.restaurant_id where r.slug = 'spice-garden' and i.is_available and i.name_en = 'Paneer Tikka'`);
    const path = `${it!.rid}/00000000-0000-4000-8000-0000000000aa.webp`;
    await q(`update public.items set image_path = $2 where id = $1`, [it!.id, path]);
    try {
      await open(page, t);
      await expect(page.getByRole('heading', { name: 'Our favourites' })).toBeVisible();
      await page.getByRole('button', { name: 'View Paneer Tikka' }).last().click();
      await expect(dialog(page).getByRole('button', { name: 'Add Paneer Tikka', exact: true })).toBeVisible();
      await dialog(page).getByRole('button', { name: 'Add Paneer Tikka', exact: true }).click();
      await expect(dialog(page).getByRole('button', { name: 'Add one more Paneer Tikka' })).toBeVisible();
      await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /View cart/ })).toContainText('₹280');
      await page.getByLabel('Search the menu').fill('tikka');
      await expect(page.getByRole('heading', { name: 'Our favourites' })).toHaveCount(0); // favourites only while browsing
    } finally {
      await q(`update public.items set image_path = null where id = $1`, [it!.id]);
    }
  });
});

test.describe('accessibility (axe, WCAG 2 A/AA)', () => {
  const scan = async (page: Page, label: string) => {
    // Sheets fade in over 220 ms; scanning mid-fade measures colours against the dimmed backdrop and reports false contrast failures.
    await page.waitForTimeout(400);
    const r = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    expect(summary, `${label}: ${summary.join('\n')}`).toEqual([]);
  };
  test('menu, cart, help sheets, status, thank-you and state pages have no violations', async ({ page }) => {
    const t = await newTable();
    await open(page, t);
    await scan(page, 'menu');
    await add(page, 'Paneer Tikka');
    await page.getByRole('button', { name: /View cart/ }).click();
    await scan(page, 'cart');
    await dialog(page).getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    await scan(page, 'status');
    await page.getByRole('button', { name: 'Call waiter' }).click();
    await scan(page, 'waiter sheet');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Ask for bill' }).click();
    await scan(page, 'bill sheet');
    await page.keyboard.press('Escape');
    await staff(OWNER, 'staff_close_session', { p_session_id: (await sessionOf(t.id))!, p_force: true, p_reason: 'a11y' });
    await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
    await scan(page, 'thank you');
    await page.goto(`/${t.slug}?k=${'f'.repeat(64)}`);
    await scan(page, 'invalid qr');
    await page.goto('/privacy');
    await scan(page, 'privacy');
  });

  test('sheets are keyboard operable: Escape closes and focus returns to the opener', async ({ page }) => {
    const t = await newTable();
    await open(page, t);
    const opener = page.getByRole('button', { name: 'Call waiter' });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('every interactive control is at least 44px tall', async ({ page }) => {
    const t = await newTable();
    await open(page, t);
    await add(page, 'Paneer Tikka');
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    expect(small).toEqual([]);
  });
});
