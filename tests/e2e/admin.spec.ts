import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { completeSignIn, q } from './helpers';
import { DEMO_PASSWORD } from '../../supabase/tests/helpers/local-supabase';
const openMore = (page: Page) => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); // the less used buttons of a hotel sit under "More"

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const SHOTS = 'test-results/shots';
const dialog = (page: Page) => page.getByRole('dialog');
let adminCookies: Awaited<ReturnType<ReturnType<Page['context']>['cookies']>> | null = null;

async function asAdmin(page: Page, path = '/admin') {
  if (adminCookies) await page.context().addCookies(adminCookies);
  else {
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@gotomenu.demo');
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await completeSignIn(page, undefined, /\/admin$/);
    adminCookies = await page.context().cookies();
  }
  await page.goto(path);
}
const suffix = () => `${test.info().project.name === 'mobile' ? 'm' : 't'}${Math.random().toString(36).slice(2, 7)}`;
const card = (page: Page, slug: string) => page.getByTestId(`restaurant-${slug}`);
const card_ = card;

test.describe('/admin access', () => {
  test('signed-out visitors are sent to sign-in; restaurant owners cannot even tell /admin exists', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
    // an owner (second factor done) gets an ordinary not-found page
    await page.goto('/login');
    await page.getByLabel('Email').fill('owner@spice-garden.demo');
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await completeSignIn(page);
    const auth = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name));
    expect(auth.length).toBeGreaterThan(0);
    for (const c of auth) expect(c.sameSite).toBe('Lax');
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(404);
    expect((await page.request.get('/api/admin/restaurants')).status()).toBe(403);
  });

  test('the admin API refuses calls without a session', async ({ request }) => {
    expect((await request.get('/api/admin/restaurants')).status()).toBe(401);
  });
});

test.describe('platform admin', () => {
  test('lists restaurants with plan, payment and last activity; passes accessibility and tap-size checks', async ({ page }) => {
    await asAdmin(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Restaurants' })).toBeVisible();
    await expect(card(page, 'spice-garden')).toContainText('Spice Garden');
    await expect(card(page, 'spice-garden')).toContainText('Last order:');
    await page.getByLabel('Search').fill('aroma');
    await expect(card(page, 'cafe-aroma')).toBeVisible();
    await expect(card(page, 'spice-garden')).toHaveCount(0);
    await page.getByLabel('Search').fill('');
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"])')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ t: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
        .filter((s) => s.h < 44 || s.w < 44),
    );
    expect(small).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-admin-list.png`, fullPage: true });
  });

  test('creates a restaurant; the owner must change the temporary password, then signs in with email + password only', async ({ page, browser }) => {
    const slug = `e2e-${suffix()}`;
    const mail = `${slug}@owner.test`;
    await asAdmin(page);
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await dialog(page).getByLabel('Restaurant name').fill(`Cafe ${slug}`);
    await dialog(page).getByLabel('Web address (after the domain)').fill(slug);
    await dialog(page).getByLabel('Owner name').fill('Olive Owner');
    await dialog(page).getByLabel('Owner email').fill(mail);
    await dialog(page).getByRole('button', { name: 'Create restaurant and owner login' }).click();
    await expect(dialog(page)).toContainText('shown only once');
    const temp = (await dialog(page).getByTestId('temp-password').textContent())!;
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    await expect(card(page, slug)).toContainText('Active');
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-admin-created.png` });

    const ctx = await browser.newContext(test.info().project.use as never);
    const p = await ctx.newPage();
    try {
      await p.goto('/login');
      await p.getByLabel('Email').fill(mail);
      await p.getByLabel('Password').fill(temp);
      await p.getByRole('button', { name: 'Sign in' }).click();
      await expect(p).toHaveURL(/\/account\/password$/);
      await p.goto('/staff');
      await expect(p).toHaveURL(/\/account\/password$/); // the temporary password cannot be used for anything else
      const pw = `Owner-${suffix()}-long-pass!`;
      await p.getByLabel('New password', { exact: true }).fill(pw);
      await p.getByLabel('Type it again').fill(pw);
      await p.getByRole('button', { name: 'Save password' }).click();

      // no authenticator step for restaurant owners: straight to the live screen and the dashboard
      await expect(p).toHaveURL(/\/staff$/);
      await expect(p.getByRole('heading', { level: 1 })).toContainText(`Cafe ${slug}`);
      await p.goto('/dash/menu');
      await expect(p.getByRole('heading', { level: 1, name: 'Menu' })).toBeVisible();
      expect((await p.request.get('/api/dash/menu')).status()).toBe(200);

      // signing in again: email + password, nothing else
      await p.request.post('/api/auth/logout', { headers: { origin: new URL(p.url()).origin }, data: { scope: 'local' } });
      await p.goto('/login');
      await p.getByLabel('Email').fill(mail);
      await p.getByLabel('Password').fill(pw);
      await p.getByRole('button', { name: 'Sign in' }).click();
      await expect(p).toHaveURL(/\/staff$/);
      // ...but this account is not a platform admin and cannot reach /admin
      expect((await p.goto('/admin'))?.status()).toBe(404);
    } finally {
      await ctx.close();
    }
  });

  test('forgotten password and wrong email: the admin resets the password and corrects the email from Logins', async ({ page, browser }) => {
    const slug = `e2e-${suffix()}`;
    const wrong = `${slug}@gamil.test`;
    const right = `${slug}@gmail.test`;
    await asAdmin(page);
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await dialog(page).getByLabel('Restaurant name').fill(`Cafe ${slug}`);
    await dialog(page).getByLabel('Web address (after the domain)').fill(slug);
    await dialog(page).getByLabel('Owner name').fill('Olive Owner');
    await dialog(page).getByLabel('Owner email').fill(wrong);
    await dialog(page).getByRole('button', { name: 'Create restaurant and owner login' }).click();
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();

    await openMore(page);
    await page.getByLabel(`Logins of Cafe ${slug}`).click();
    await expect(dialog(page)).toContainText(wrong);
    await dialog(page).getByRole('button', { name: 'Change email of Olive Owner' }).click();
    await dialog(page).getByLabel('New email').fill(right);
    await dialog(page).getByRole('button', { name: 'Save email' }).click();
    await expect(dialog(page)).toContainText(right);
    await dialog(page).getByRole('button', { name: 'Reset password of Olive Owner' }).click();
    await expect(dialog(page)).toContainText('shown only once');
    const temp = (await dialog(page).getByTestId('temp-password').textContent())!;

    // add a kitchen login from the same screen
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    await openMore(page);
    await page.getByLabel(`Logins of Cafe ${slug}`).click();
    await dialog(page).getByRole('button', { name: 'Add login' }).click();
    await dialog(page).getByLabel('Name', { exact: true }).fill('Kim Kitchen');
    await dialog(page).getByLabel('Email', { exact: true }).fill(`${slug}@kitchen.test`);
    await dialog(page).getByLabel('Role').selectOption('kitchen');
    await dialog(page).getByRole('button', { name: 'Create login' }).click();
    await expect(dialog(page)).toContainText('shown only once');
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    await openMore(page);
    await page.getByLabel(`Logins of Cafe ${slug}`).click();
    await expect(dialog(page)).toContainText('Kim Kitchen · kitchen');

    const ctx = await browser.newContext(test.info().project.use as never);
    const p = await ctx.newPage();
    try {
      await p.goto('/login');
      await p.getByLabel('Email').fill(right);
      await p.getByLabel('Password').fill(temp);
      await p.getByRole('button', { name: 'Sign in' }).click();
      await expect(p).toHaveURL(/\/account\/password$/);
    } finally {
      await ctx.close();
    }
  });

  test('the platform admin signs in with email + password only and opens /admin', async ({ browser }) => {
    const ctx = await browser.newContext(test.info().project.use as never);
    const p = await ctx.newPage();
    try {
      await p.goto('/login');
      await p.getByLabel('Email').fill('admin@gotomenu.demo');
      await p.getByLabel('Password').fill(DEMO_PASSWORD);
      await p.getByRole('button', { name: 'Sign in' }).click();
      await expect(p).toHaveURL(/\/admin$/);
      expect((await p.request.get('/api/admin/restaurants')).status()).toBe(200);
    } finally {
      await ctx.close();
    }
  });

  test('plans page: the admin writes plans (name, points, prices); one is assigned with its own price and dates, shown on the card and in the owner\'s dashboard', async ({ page, browser }) => {
    const slug = `e2e-${suffix()}`;
    const planName = `Signature ${suffix()}`;
    await asAdmin(page, '/admin/plans');
    await page.getByRole('button', { name: 'Add plan' }).click();
    await dialog(page).getByLabel('Plan name').fill(planName);
    await dialog(page).getByLabel('Setup (₹)').fill('15000');
    await dialog(page).getByLabel('Per month (₹)').fill('2499');
    await dialog(page).getByLabel('Per year (₹)').fill('24,999');
    await dialog(page).getByLabel(/Plan points/).fill('Premium menu\n\nQR ordering\nSmart QR link');
    await dialog(page).getByRole('button', { name: 'Save plan' }).click();
    const card = page.getByTestId(`plan-${planName}`);
    await expect(card).toContainText('₹15,000');
    await expect(card).toContainText('₹2,499');
    await expect(card).toContainText('₹24,999');
    await expect(card.getByRole('listitem')).toHaveCount(3);
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-admin-plans.png` });

    // a restaurant to assign it to
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await dialog(page).getByLabel('Restaurant name').fill(`Cafe ${slug}`);
    await dialog(page).getByLabel('Web address (after the domain)').fill(slug);
    await dialog(page).getByLabel('Owner name').fill('Olive');
    await dialog(page).getByLabel('Owner email').fill(`${slug}@owner.test`);
    await dialog(page).getByRole('button', { name: 'Create restaurant and owner login' }).click();
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    const c = card_(page, slug);
    await c.getByRole('button', { name: /Plan and billing for/ }).click();
    await dialog(page).locator('select').first().selectOption({ label: planName });
    await expect(dialog(page).getByLabel('Price (₹)')).toHaveValue('2499'); // filled from the plan, still editable
    await expect(dialog(page).getByLabel('Setup fee (₹)')).toHaveValue('15000');
    await dialog(page).getByLabel('Price (₹)').fill('1999'); // this client's own price
    await dialog(page).getByLabel('Starts on').fill('2026-11-01');
    await dialog(page).getByRole('button', { name: '+ 1 year' }).click();
    await expect(dialog(page).getByLabel('Ends on')).toHaveValue('2027-11-01');
    await dialog(page).getByLabel(/Pause the menu automatically/).check();
    await dialog(page).getByLabel(/Grace days/).fill('5');
    await dialog(page).getByLabel(/Note/).fill('Founding client');
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-admin-billing.png` });
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(c).toContainText(`Plan: ${planName}`);
    await expect(c).toContainText('₹1,999 per month');
    await expect(c).toContainText('setup ₹15,000');
    await expect(c).toContainText('pauses itself after 5 grace days');
    const row = (await q<any>(`select price_paise, billing_period, setup_fee_paise, auto_pause, grace_days, billing_note from public.restaurants where slug = $1`, [slug]))[0];
    expect(row).toMatchObject({ price_paise: 199900, billing_period: 'monthly', setup_fee_paise: 1500000, auto_pause: true, grace_days: 5, billing_note: 'Founding client' });

    // a plan in use cannot be deleted
    await page.goto('/admin/plans');
    await page.getByRole('button', { name: `Delete plan ${planName}` }).click();
    await expect(dialog(page).getByRole('button', { name: 'Delete plan' })).toBeDisabled();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    // the owner sees a warning when the end date is near
    await q(`update public.restaurants set paid_until = now() + interval '5 days' where slug = $1`, [slug]);
    const [pw] = await q<{ id: string }>(`select id from auth.users where email = $1`, [`${slug}@owner.test`]);
    await q(`update auth.users set password = 'OwnerPass#2025x!', app_metadata = '{}'::jsonb where id = $1`, [pw!.id]);
    const ctx = await browser.newContext(test.info().project.use as never);
    const p = await ctx.newPage();
    try {
      await p.goto('/login');
      await p.getByLabel('Email').fill(`${slug}@owner.test`);
      await p.getByLabel('Password').fill('OwnerPass#2025x!');
      await p.getByRole('button', { name: 'Sign in' }).click();
      await expect(p).toHaveURL(/\/staff$/);
      await p.goto('/dash/menu');
      await expect(p.getByTestId('plan-notice')).toContainText(/Ends in [45] days|ends on/i);
    } finally {
      await ctx.close();
    }
  });

  test('rename a restaurant and a login, and duplicate a restaurant with its menu', async ({ page }) => {
    const slug = `e2e-${suffix()}`;
    await asAdmin(page);
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await dialog(page).getByLabel('Restaurant name').fill(`Cafe ${slug}`);
    await dialog(page).getByLabel('Web address (after the domain)').fill(slug);
    await dialog(page).getByLabel('Owner name').fill('Olive');
    await dialog(page).getByLabel('Owner email').fill(`${slug}@owner.test`);
    await dialog(page).getByRole('button', { name: 'Create restaurant and owner login' }).click();
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    // give it a small menu so the copy has something to copy
    const [r0] = await q<{ id: string }>(`select id from public.restaurants where slug = $1`, [slug]);
    const [cat] = await q<{ id: string }>(`insert into public.categories (restaurant_id, name_en) values ($1, 'Starters') returning id`, [r0!.id]);
    await q(`insert into public.items (restaurant_id, category_id, name_en, price_paise, diet) values ($1, $2, 'Tikka', 28000, 'veg'), ($1, $2, 'Kebab', 24000, 'nonveg')`, [r0!.id, cat!.id]);
    const c = card_(page, slug);

    await openMore(page);
    await c.getByRole('button', { name: /^Rename Cafe/ }).click();
    await dialog(page).getByLabel('Restaurant name').fill(`Renamed ${slug}`);
    await dialog(page).getByRole('button', { name: 'Save name' }).click();
    await expect(c).toContainText(`Renamed ${slug}`);
    expect((await q<{ slug: string }>(`select slug from public.restaurants where id = $1`, [r0!.id]))[0]!.slug).toBe(slug); // address unchanged

    await openMore(page);
    await c.getByLabel(/^Logins of/).click();
    await dialog(page).getByRole('button', { name: 'Rename Olive' }).click();
    await dialog(page).getByLabel('New name').fill('Olive Owner');
    await dialog(page).getByRole('button', { name: 'Save name' }).click();
    await expect(dialog(page)).toContainText('Olive Owner · owner');
    await dialog(page).getByRole('button', { name: 'Close' }).first().click();

    await c.getByRole('button', { name: /^Duplicate/ }).click();
    await dialog(page).getByLabel('New restaurant name').fill(`Copy ${slug}`);
    await dialog(page).getByLabel('New web address').fill(`copy-${slug}`);
    await dialog(page).getByLabel('New owner name').fill('Cora');
    await dialog(page).getByLabel('New owner email').fill(`copy-${slug}@owner.test`);
    await dialog(page).getByRole('button', { name: 'Create the copy' }).click();
    await expect(dialog(page)).toContainText('shown only once');
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    const copy = card_(page, `copy-${slug}`);
    await expect(copy).toContainText(`Copy ${slug}`);
    const items = await q<{ name_en: string; price_paise: number }>(`select i.name_en, i.price_paise from public.items i join public.restaurants r on r.id = i.restaurant_id where r.slug = $1 order by i.name_en`, [`copy-${slug}`]);
    expect(items).toEqual([{ name_en: 'Kebab', price_paise: 24000 }, { name_en: 'Tikka', price_paise: 28000 }]);
    expect((await q(`select 1 from public.dining_tables t join public.restaurants r on r.id = t.restaurant_id where r.slug = $1`, [`copy-${slug}`])).length).toBe(0);
    // the copy shows on the public menu
    await page.goto(`/copy-${slug}`);
    await expect(page.getByText('Tikka').first()).toBeVisible();
  });

  test('suspends and reactivates, edits plan and payment, shows the activity log, exports data and deletes with a typed confirmation', async ({ page, request }) => {
    const slug = `e2e-${suffix()}`;
    await asAdmin(page);
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await dialog(page).getByLabel('Restaurant name').fill(`Cafe ${slug}`);
    await dialog(page).getByLabel('Web address (after the domain)').fill(slug);
    await dialog(page).getByLabel('Owner name').fill('Olive');
    await dialog(page).getByLabel('Owner email').fill(`${slug}@owner.test`);
    await dialog(page).getByRole('button', { name: 'Create restaurant and owner login' }).click();
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    const c = card(page, slug);

    await c.getByRole('button', { name: /^Suspend/ }).click();
    await expect(c).toContainText('Suspended');
    expect((await q<{ status: string }>(`select status from public.restaurants where slug = $1`, [slug]))[0]!.status).toBe('suspended');
    await c.getByRole('button', { name: /^Activate/ }).click();
    await expect(c).toContainText('Active');

    await c.getByRole('button', { name: /Plan and billing for/ }).click();
    await dialog(page).getByLabel('Plan name shown').fill('standard');
    await dialog(page).getByLabel('Ends on').fill('2020-01-31');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(c).toContainText('Plan: standard');
    await expect(c.getByTestId('expiry')).toContainText('Ended');

    await openMore(page);
    await c.getByRole('button', { name: /Activity log for/ }).click();
    await expect(dialog(page)).toContainText('restaurant created');
    await expect(dialog(page)).toContainText('restaurant status');
    await expect(dialog(page)).toContainText('restaurant plan');
    await dialog(page).getByRole('button', { name: 'Close' }).click();

    await openMore(page);
    const [download] = await Promise.all([page.waitForEvent('download'), c.getByRole('link', { name: /Export data of/ }).click()]);
    const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(data.restaurant.slug).toBe(slug);
    expect(data.staff).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('qr_token');

    await c.getByRole('button', { name: /^Delete / }).click();
    const del = dialog(page).getByRole('button', { name: 'Delete forever' });
    await expect(del).toBeDisabled();
    await dialog(page).getByLabel(/to confirm/).fill(`${slug}x`);
    await expect(del).toBeDisabled();
    await dialog(page).getByLabel(/to confirm/).fill(slug);
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-admin-delete.png` });
    await del.click();
    await expect(c).toHaveCount(0);
    expect((await q(`select 1 from public.restaurants where slug = $1`, [slug])).length).toBe(0);
    expect((await request.get(`/${slug}`)).status()).toBe(404);
    expect((await q(`select 1 from auth.users where email = $1`, [`${slug}@owner.test`])).length).toBe(0);
  });

  test('a suspended restaurant cannot take orders', async ({ request }) => {
    await q(`update public.restaurants set status = 'suspended' where slug = 'cafe-aroma'`);
    try {
      const [t] = await q<{ qr_token: string }>(`select qr_token from public.dining_tables where restaurant_id = (select id from public.restaurants where slug = 'cafe-aroma') limit 1`);
      const [it] = await q<{ id: string }>(`select id from public.items where restaurant_id = (select id from public.restaurants where slug = 'cafe-aroma') limit 1`);
      const res = await request.post('/api/guest/order', { headers: { origin: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3100').origin }, data: { slug: 'cafe-aroma', token: t!.qr_token, items: [{ item_id: it!.id, qty: 1 }], idempotency_key: `susp-${suffix()}` } });
      expect(res.status()).toBe(403);
      expect((await res.json()).error.key).toBe('restaurant_suspended');
    } finally {
      await q(`update public.restaurants set status = 'active' where slug = 'cafe-aroma'`);
    }
  });
});
