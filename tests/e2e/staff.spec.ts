import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { clearBoard, completeSignIn, newTable, q } from './helpers';
import { DEMO_PASSWORD } from '../../supabase/tests/helpers/local-supabase';

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const SHOTS = 'test-results/shots';
const email = (role: string, slug = 'spice-garden') => `${role}@${slug}.demo`;

async function login(page: Page, who: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await completeSignIn(page);
}
// Sign in through the real form once per account, then reuse that session's cookies. (Sign-in is deliberately throttled:
// 20 per address and 8 per account in a few minutes, so tests must not sign in over and over.)
const sessions = new Map<string, Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>>();
async function loginAs(page: Page, role: 'owner' | 'manager' | 'waiter' | 'kitchen', slug = 'spice-garden') {
  const key = `${role}@${slug}`;
  const cached = sessions.get(key);
  if (cached) {
    await page.context().addCookies(cached);
    await page.goto('/staff');
  } else {
    await login(page, email(role, slug));
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(slug === 'spice-garden' ? 'Spice Garden' : 'Cafe Aroma');
  if (!cached) sessions.set(key, await page.context().cookies());
}

const itemId = async (name: string, slug = 'spice-garden') =>
  (await q<{ id: string }>(`select i.id from public.items i join public.restaurants r on r.id = i.restaurant_id where r.slug = $1 and i.name_en = $2`, [slug, name]))[0]!.id;

type Table = Awaited<ReturnType<typeof newTable>>;
const guest = {
  async order(request: APIRequestContext, t: Table, items: [string, number][], note?: string) {
    const lines = await Promise.all(items.map(async ([n, qty]) => ({ item_id: await itemId(n, t.slug), qty })));
    const res = await request.post('/api/guest/order', {
      headers: { origin: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3100').origin },
      data: { slug: t.slug, token: t.token, items: lines, note, idempotency_key: `e2e-${t.label}-${Math.random().toString(36).slice(2)}` },
    });
    expect(res.status(), await res.text()).toBe(200);
  },
  async call(request: APIRequestContext, t: Table, body: Record<string, unknown>) {
    const res = await request.post('/api/guest/request', {
      headers: { origin: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3100').origin },
      data: { slug: t.slug, token: t.token, ...body },
    });
    expect(res.status(), await res.text()).toBe(200);
  },
};
const orderCardFor = (page: Page, tableLabel: string) => page.locator('li[data-testid^="order-"]', { hasText: `Table ${tableLabel}` });

test.describe('sign in', () => {
  test('signed-out visitors are sent to the sign-in page; wrong details give one generic message', async ({ page }) => {
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/login\?next=%2Fstaff/);
    await page.getByLabel('Email').fill(email('owner'));
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const a = await page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' }).textContent();
    await page.getByLabel('Email').fill('nobody@nowhere.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Incorrect email or password.' })).toBeVisible();
    expect(a).toBe('Incorrect email or password.');
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-staff-login.png` });
  });

  test('signing in lands on the staff screen; an outside "next" address is ignored; sign out ends the session', async ({ page }) => {
    await page.goto('/login?next=https://evil.example/');
    await page.getByLabel('Email').fill(email('waiter'));
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Spice Garden');
    await expect(page.getByText('Waiter · Waiter')).toBeVisible();
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the API refuses staff calls without a session', async ({ request }) => {
    expect((await request.get('/api/staff/board')).status()).toBe(401);
    expect((await request.get('/api/staff/items')).status()).toBe(401);
  });
});

test.describe('live orders', () => {
  test('a guest order appears, moves through the stages, and leaves the board when served', async ({ page, request }, info) => {
    const t = await newTable();
    await loginAs(page, 'waiter');
    await guest.order(request, t, [['Paneer Tikka', 2], ['Sweet Lassi', 1]], 'Less spicy please');
    const c = orderCardFor(page, t.label);
    await expect(c).toBeVisible({ timeout: 12_000 });
    await expect(c).toContainText('2 × Paneer Tikka');
    await expect(c).toContainText('1 × Sweet Lassi');
    await expect(c).toContainText('Kitchen note: Less spicy please');
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-staff-1-new.png`, fullPage: true });

    await c.getByRole('button', { name: 'Accept & start' }).click();
    await expect(page.getByRole('heading', { name: /Preparing/ }).locator('..').locator('..')).toContainText(`Table ${t.label}`);
    await orderCardFor(page, t.label).getByRole('button', { name: 'Mark ready' }).click();
    await expect(page.getByRole('heading', { name: /Ready to serve/ }).locator('..').locator('..')).toContainText(`Table ${t.label}`);
    await orderCardFor(page, t.label).getByRole('button', { name: 'Mark served' }).click();
    await expect(orderCardFor(page, t.label)).toHaveCount(0);
    expect((await q<{ status: string }>(`select status from public.orders where table_id = $1`, [t.id]))[0]!.status).toBe('served');
  });

  test('waiting orders turn amber, then red, using the server clock and the restaurant thresholds', async ({ page, request }) => {
    const t = await newTable();
    await loginAs(page, 'owner');
    await guest.order(request, t, [['Masala Chai', 1]]);
    const c = orderCardFor(page, t.label);
    await expect(c).toBeVisible({ timeout: 12_000 });
    await expect(c).not.toContainText('Late');
    await q(`update public.orders set created_at = now() - interval '6 minutes' where table_id = $1`, [t.id]);
    await expect(c).toContainText('Late', { timeout: 12_000 });
    await expect(c).not.toContainText('Very late');
    await q(`update public.orders set created_at = now() - interval '11 minutes' where table_id = $1`, [t.id]);
    await expect(c).toContainText('Very late', { timeout: 12_000 });
  });

  test('cancelling needs a reason, tells the guest, and removes the card', async ({ page, request }) => {
    const t = await newTable();
    await loginAs(page, 'manager');
    await guest.order(request, t, [['Masala Chai', 1]]);
    const c = orderCardFor(page, t.label);
    await expect(c).toBeVisible({ timeout: 12_000 });
    await c.getByRole('button', { name: 'Cancel', exact: true }).click();
    const d = page.getByRole('dialog');
    await expect(d.getByRole('button', { name: 'Cancel order', exact: true })).toBeDisabled(); // no reason yet
    await d.getByRole('button', { name: 'Sold out' }).click();
    await d.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(orderCardFor(page, t.label)).toHaveCount(0);
    const [o] = await q<{ status: string; cancel_reason: string }>(`select status, cancel_reason from public.orders where table_id = $1`, [t.id]);
    expect(o).toEqual({ status: 'cancelled', cancel_reason: 'Sold out' });
  });

  test('the kitchen sees orders only: no cancel, no calls or bills, no tables, no payment', async ({ page, request }) => {
    const t = await newTable();
    await loginAs(page, 'kitchen');
    await guest.order(request, t, [['Masala Chai', 1]]);
    const c = orderCardFor(page, t.label);
    await expect(c).toBeVisible({ timeout: 12_000 });
    await expect(c.getByRole('button', { name: 'Accept & start' })).toBeVisible();
    await expect(c.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Calls & bills/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Open tables/ })).toHaveCount(0);
    await expect(page.getByText('Mark paid')).toHaveCount(0);
  });

  test('waiters cannot cancel-force a table; managers and owners can (with a reason)', async ({ browser, request }) => {
    const t = await newTable();
    await guest.order(request, t, [['Masala Chai', 1]]);
    const waiter = await (await browser.newContext()).newPage();
    await loginAs(waiter, 'waiter');
    const row = waiter.locator(`li[data-testid="table-${t.label}"]`);
    await expect(row).toBeVisible({ timeout: 12_000 });
    await expect(row).toContainText('1 order is not served yet');
    await expect(row.getByRole('button')).toBeDisabled();
    await waiter.context().close();

    const mgr = await (await browser.newContext()).newPage();
    await loginAs(mgr, 'manager');
    const mrow = mgr.locator(`li[data-testid="table-${t.label}"]`);
    await expect(mrow).toBeVisible({ timeout: 12_000 });
    await mrow.getByRole('button', { name: 'Force close…' }).click();
    const d = mgr.getByRole('dialog');
    await expect(d.getByRole('button', { name: 'Force close table' })).toBeDisabled();
    await d.getByLabel('Reason (required)').fill('Guests left without paying');
    await d.getByRole('button', { name: 'Force close table' }).click();
    await expect(mrow).toHaveCount(0);
    const [s] = await q<{ close_reason: string }>(`select close_reason from public.table_sessions where table_id = $1`, [t.id]);
    expect(s!.close_reason).toBe('forced');
    await mgr.context().close();
  });
});

test.describe('guest problems (call for problems)', () => {
  const LINK = 'c3'.repeat(32);
  const post = (request: APIRequestContext, body: Record<string, unknown>) =>
    request.post('/api/guest/help', { headers: { origin: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3100').origin }, data: { slug: 'spice-garden', token: LINK, ...body } });
  test.beforeEach(async () => {
    await q(`update public.restaurants set help_token = $1, room_numbers = '{}', help_topics = '{Towel or bedsheet,WiFi not working,Light not working}' where slug = 'spice-garden'`, [LINK]);
    await q(`delete from public.help_requests where restaurant_id = (select id from public.restaurants where slug = 'spice-garden')`);
  });
  test.afterEach(async () => {
    await q(`update public.restaurants set help_token = null where slug = 'spice-garden'`);
    await q(`delete from public.help_requests where restaurant_id = (select id from public.restaurants where slug = 'spice-garden')`);
  });

  test('a problem sent from the help link appears live on the reception screen, and Done removes it; the kitchen never sees it', async ({ page, request }, info) => {
    await loginAs(page, 'waiter');
    const res = await post(request, { room: '201', topics: ['Towel or bedsheet', 'WiFi not working'], note: 'The router light is red' });
    expect(res.status(), await res.text()).toBe(200);
    const card = page.locator('[data-testid="help-201"]');
    await expect(card).toContainText('Room 201', { timeout: 12_000 });
    await expect(card).toContainText('Towel or bedsheet');
    await expect(card).toContainText('WiFi not working');
    await expect(card).toContainText('The router light is red');
    await expect(page.getByRole('heading', { name: /Guest problems/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-staff-help.png`, fullPage: true });

    // a second problem from another room is its own card; the same message twice is one card
    await post(request, { room: '305', topics: ['Light not working'] });
    await post(request, { room: '305', topics: ['Light not working'] });
    await expect(page.locator('[data-testid="help-305"]')).toHaveCount(1, { timeout: 12_000 });

    await card.getByRole('button', { name: 'Done' }).click();
    await expect(card).toHaveCount(0);
    const [r] = await q<{ status: string; resolved_by: string | null }>(`select status, resolved_by from public.help_requests where room = '201'`);
    expect(r!.status).toBe('done');
    expect(r!.resolved_by).toBeTruthy();
    await expect(page.locator('[data-testid="help-305"]')).toHaveCount(1);
  });

  test('the kitchen screen does not show guest problems', async ({ page, request }) => {
    await post(request, { room: '410', topics: ['WiFi not working'] });
    await loginAs(page, 'kitchen');
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.locator('[data-testid="help-410"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Guest problems/ })).toHaveCount(0);
  });

  test('the board with a guest problem has no accessibility violations and its Done button is large enough', async ({ page, request }) => {
    await loginAs(page, 'waiter');
    await post(request, { room: '502', topics: ['Towel or bedsheet'], note: 'Two please' });
    await expect(page.locator('[data-testid="help-502"]')).toBeVisible({ timeout: 12_000 });
    await page.waitForTimeout(400);
    const r = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    const box = await page.locator('[data-testid="help-502"]').getByRole('button', { name: 'Done' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('calls, bills and marking tables paid', () => {
  test('waiter calls and bill requests show exactly what to bring for each payment mode', async ({ page, request }, info) => {
    const calls = await Promise.all([newTable(), newTable(), newTable(), newTable()]);
    await loginAs(page, 'waiter');
    await guest.call(request, calls[0]!, { type: 'waiter', reason: 'water' });
    await guest.order(request, calls[1]!, [['Masala Chai', 1]]);
    await guest.call(request, calls[1]!, { type: 'bill', pay_mode: 'upi' });
    await guest.order(request, calls[2]!, [['Masala Chai', 1]]);
    await guest.call(request, calls[2]!, { type: 'bill', pay_mode: 'card' });
    await guest.order(request, calls[3]!, [['Masala Chai', 1]]);
    await guest.call(request, calls[3]!, { type: 'bill', pay_mode: 'cash' });

    const req = (type: string, t: Table) => page.locator(`[data-testid="request-${type}-${t.label}"]`);
    await expect(req('waiter', calls[0]!)).toContainText('Water', { timeout: 12_000 });
    await expect(req('bill', calls[1]!)).toContainText('Bring bill + payment QR');
    await expect(req('bill', calls[2]!)).toContainText('Bring bill + card machine');
    await expect(req('bill', calls[3]!)).toContainText('Bring bill (cash payment)');
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-staff-2-calls.png`, fullPage: true });

    await req('waiter', calls[0]!).getByRole('button', { name: 'Done' }).click();
    await expect(req('waiter', calls[0]!)).toHaveCount(0);
    const [r] = await q<{ status: string }>(`select status from public.service_requests where table_id = $1`, [calls[0]!.id]);
    expect(r!.status).toBe('done');
  });

  test('Mark paid: blocked until everything is served, then a confirm names the table and total, then the guest is thanked', async ({ page, request }, info) => {
    const t = await newTable();
    await loginAs(page, 'waiter');
    await guest.order(request, t, [['Paneer Tikka', 1], ['Masala Chai', 1]]);
    const row = page.locator(`li[data-testid="table-${t.label}"]`);
    await expect(row).toBeVisible({ timeout: 12_000 });
    await expect(row).toContainText('₹320');
    await expect(row.getByRole('button')).toBeDisabled();
    const oc = orderCardFor(page, t.label);
    await oc.getByRole('button', { name: 'Accept & start' }).click();
    await orderCardFor(page, t.label).getByRole('button', { name: 'Mark ready' }).click();
    await orderCardFor(page, t.label).getByRole('button', { name: 'Mark served' }).click();
    await expect(row.getByRole('button', { name: 'Mark paid' })).toBeEnabled();
    await row.getByRole('button', { name: 'Mark paid' }).click();
    const d = page.getByRole('dialog');
    await expect(d).toContainText(`Mark Table ${t.label} as paid?`);
    await expect(d).toContainText('₹320');
    await d.getByRole('button', { name: 'UPI' }).click();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-staff-3-markpaid.png` });
    await d.getByRole('button', { name: 'Confirm paid' }).click();
    await expect(row).toHaveCount(0);
    const [s] = await q<{ close_reason: string; final_total_paise: number; pay_mode: string }>(`select close_reason, final_total_paise, pay_mode from public.table_sessions where table_id = $1`, [t.id]);
    expect(s).toEqual({ close_reason: 'paid', final_total_paise: 32000, pay_mode: 'upi' });
  });
});

test.describe('sold-out list', () => {
  test('search, switch a dish off and on; guests see it straight away', async ({ page, request }, info) => {
    const t = await newTable();
    await loginAs(page, 'kitchen');
    await page.getByRole('tab', { name: 'Sold out' }).click();
    await page.getByLabel('Search dishes').fill('paneer tikka');
    const sw = page.getByRole('switch', { name: 'Paneer Tikka: available' });
    await expect(sw).toBeVisible();
    await expect(page.getByRole('switch', { name: /Hara Bhara/ })).toHaveCount(0);
    await sw.click();
    await expect(page.getByRole('switch', { name: 'Paneer Tikka: sold out' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-staff-4-soldout.png` });
    const guestRes = await request.get(`/${t.slug}?k=${t.token}`);
    expect(await guestRes.text()).toMatch(/Sold out/);
    const row = await q<{ is_available: boolean }>(`select is_available from public.items where id = $1`, [await itemId('Paneer Tikka')]);
    expect(row[0]!.is_available).toBe(false);
    await page.getByRole('switch', { name: 'Paneer Tikka: sold out' }).click();
    await expect(page.getByRole('switch', { name: 'Paneer Tikka: available' })).toBeVisible();
    await page.getByLabel('Search dishes').fill('');
    await page.getByRole('button', { name: /Sold out only/ }).click();
    await expect(page.getByRole('switch', { name: 'Chana Masala: sold out' })).toBeVisible(); // already sold out in the demo menu
    await expect(page.getByRole('switch', { name: /Paneer Tikka/ })).toHaveCount(0);
  });
});

test.describe('alerts: sound, wake lock, connection', () => {
  test.beforeEach(async ({ page }) => {
    // record every tone the page plays, and every screen-wake-lock request
    await page.addInitScript(() => {
      const w = window as unknown as { __tones: number[]; __wake: number };
      w.__tones = [];
      w.__wake = 0;
      const orig = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (this: AudioContext) {
        const o = orig.call(this);
        const desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value')!;
        const f = o.frequency;
        Object.defineProperty(f, 'value', { set(v: number) { w.__tones.push(v); desc.set!.call(f, v); }, get() { return desc.get!.call(f); } });
        return o;
      };
      Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { w.__wake++; return { release: async () => undefined }; } }, configurable: true });
    });
  });
  const tones = (page: Page) => page.evaluate(() => (window as unknown as { __tones: number[] }).__tones.slice());
  const firstNotes = (all: number[], first: number) => all.filter((f) => f === first).length;

  test('a banner asks for one tap to enable sound; each alert type has its own tone; it repeats until accepted', async ({ page, request }) => {
    await clearBoard(); // earlier tests leave un-accepted orders behind, which would (correctly) keep the alert repeating
    const t = await newTable();
    await loginAs(page, 'owner');
    await expect(page.getByText('Sound is off')).toBeVisible();
    await page.getByRole('button', { name: 'Enable sound' }).click();
    await expect(page.getByText('Sound is off')).toHaveCount(0);
    await expect(page.getByText('Sound on')).toBeVisible();
    expect((await tones(page)).length).toBeGreaterThan(0); // the confirmation chime

    const before = (await tones(page)).length;
    await guest.order(request, t, [['Masala Chai', 1]]);
    await expect(orderCardFor(page, t.label)).toBeVisible({ timeout: 12_000 });
    await expect.poll(async () => firstNotes((await tones(page)).slice(before), 880), { timeout: 8000 }).toBeGreaterThanOrEqual(1); // order chime
    // still un-accepted => it repeats about every 6 s
    await expect.poll(async () => firstNotes((await tones(page)).slice(before), 880), { timeout: 12_000 }).toBeGreaterThanOrEqual(2);

    // accepting acknowledges it: no further order chimes
    await orderCardFor(page, t.label).getByRole('button', { name: 'Accept & start' }).click();
    await page.waitForTimeout(1500);
    const settled = firstNotes(await tones(page), 880);
    await page.waitForTimeout(8000);
    expect(firstNotes(await tones(page), 880)).toBe(settled);

    // different tones for a waiter call (1100 Hz) and a bill request (523 Hz)
    const t2 = await newTable();
    await guest.call(request, t2, { type: 'waiter', reason: 'help' });
    await expect.poll(async () => firstNotes(await tones(page), 1100), { timeout: 12_000 }).toBeGreaterThanOrEqual(3); // triple beep
    const t3 = await newTable();
    await guest.order(request, t3, [['Masala Chai', 1]]);
    await guest.call(request, t3, { type: 'bill', pay_mode: 'cash' });
    await expect.poll(async () => firstNotes(await tones(page), 523), { timeout: 12_000 }).toBeGreaterThanOrEqual(1);
  });

  test('the screen is kept awake', async ({ page }) => {
    await loginAs(page, 'waiter');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: number }).__wake)).toBeGreaterThanOrEqual(1);
  });

  test('a loud "Connection lost" banner appears when the network drops and clears itself when it returns', async ({ page, context, request }) => {
    const t = await newTable();
    await loginAs(page, 'waiter');
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    await expect(page.getByText('Connection lost')).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByRole('alert').filter({ hasText: 'Connection lost' })).toBeVisible({ timeout: 25_000 });
    await context.setOffline(false);
    await guest.order(request, t, [['Masala Chai', 1]]);
    await expect(page.getByText('Connection lost')).toHaveCount(0, { timeout: 15_000 });
    await expect(orderCardFor(page, t.label)).toBeVisible({ timeout: 12_000 }); // caught up on what it missed
  });

  test('a suspended restaurant is announced and changes are refused', async ({ page, request }) => {
    const t = await newTable('cafe-aroma');
    await loginAs(page, 'owner', 'cafe-aroma');
    await guest.order(request, t, [['Cold Coffee', 1]]);
    await expect(orderCardFor(page, t.label)).toBeVisible({ timeout: 12_000 });
    await q(`update public.restaurants set status = 'suspended' where slug = 'cafe-aroma'`);
    try {
      await page.reload();
      await expect(page.getByRole('alert').filter({ hasText: 'This restaurant is suspended' })).toBeVisible();
      await orderCardFor(page, t.label).getByRole('button', { name: 'Accept & start' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'not taking orders' })).toBeVisible();
    } finally {
      await q(`update public.restaurants set status = 'active' where slug = 'cafe-aroma'`);
    }
  });
});

test.describe('tablet app (PWA)', () => {
  test('is installable: manifest, icons, service worker, and a friendly offline page', async ({ page, context }) => {
    await loginAs(page, 'waiter');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/manifest.webmanifest');
    const m = await (await page.request.get(href!)).json();
    expect(m).toMatchObject({ name: 'Taprizz Staff', start_url: '/staff', display: 'standalone', scope: '/' });
    for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
      const r = await page.request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type']).toBe('image/png');
    }
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);

    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
    // Make every network request for the staff page fail (including the service worker's own request), as if the Wi-Fi were down.
    await context.route('**/staff', (r) => r.abort('internetdisconnected'));
    await page.goto('/staff').catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'No internet connection' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/staff');
    await context.unroute('**/staff');
  });

  test('the service worker never stores orders or API data', async ({ page }) => {
    await loginAs(page, 'waiter');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
      return out.sort();
    });
    expect(cached).toEqual(['/offline.css', '/offline.html']);
  });

  test('larger text mode scales everything and is remembered', async ({ page }) => {
    await loginAs(page, 'waiter');
    const size = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(await size()).toBe('16px');
    await page.getByRole('button', { name: 'Larger text' }).click();
    expect(await size()).toBe('20px');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await size()).toBe('20px');
  });
});

test.describe('accessibility (staff)', () => {
  const scan = async (page: Page, label: string) => {
    // Sheets fade in over 220 ms; scanning mid-fade measures half-transparent text and reports false contrast failures.
    await page.waitForTimeout(400);
    const r = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    expect(summary, `${label}: ${summary.join('\n')}`).toEqual([]);
  };
  test('login, live board with data (late order, call, bill, table), dialogs and sold-out list have no violations', async ({ page, request }) => {
    await page.goto('/login');
    await scan(page, 'login');
    const [a, b] = await Promise.all([newTable(), newTable()]);
    await loginAs(page, 'owner');
    await guest.order(request, a, [['Paneer Tikka', 1]], 'No onion');
    await guest.order(request, b, [['Masala Chai', 1]]);
    await guest.call(request, b, { type: 'bill', pay_mode: 'upi' });
    await guest.call(request, a, { type: 'waiter', reason: 'water' });
    await expect(orderCardFor(page, a.label)).toBeVisible({ timeout: 12_000 });
    await q(`update public.orders set created_at = now() - interval '6 minutes' where table_id = $1`, [a.id]);
    await expect(orderCardFor(page, a.label)).toContainText('Late', { timeout: 12_000 });
    await q(`update public.orders set created_at = now() - interval '12 minutes' where table_id = $1`, [b.id]);
    await expect(orderCardFor(page, b.label)).toContainText('Very late', { timeout: 12_000 });
    await scan(page, 'live board');
    await orderCardFor(page, a.label).getByRole('button', { name: 'Cancel', exact: true }).click();
    await scan(page, 'cancel dialog');
    await page.keyboard.press('Escape');
    await page.locator(`li[data-testid="table-${a.label}"]`).getByRole('button', { name: 'Force close…' }).click();
    await scan(page, 'force close dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Sold out' }).click();
    await expect(page.getByRole('switch').first()).toBeVisible();
    await scan(page, 'sold out list');
  });

  test('every control on the staff screen is at least 44px', async ({ page, request }) => {
    const t = await newTable();
    await loginAs(page, 'owner');
    await guest.order(request, t, [['Masala Chai', 1]]);
    await guest.call(request, t, { type: 'waiter', reason: 'water' });
    await expect(orderCardFor(page, t.label)).toBeVisible({ timeout: 12_000 });
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="tab"], [role="switch"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    expect(small).toEqual([]);
  });
});
