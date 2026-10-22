import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { completeSignIn, newTable, q } from './helpers';
import { DEMO_PASSWORD } from '../../supabase/tests/helpers/local-supabase';

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const SHOTS = 'test-results/shots';
const email = (role: string, slug = 'spice-garden') => `${role}@${slug}.demo`;
const sessions = new Map<string, Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>>();

// Sign in through the real form once per account; later tests reuse the cookies (sign-in is deliberately throttled).
async function loginAs(page: Page, role: 'owner' | 'manager' | 'waiter', path = '/dash/menu') {
  const cached = sessions.get(role);
  if (cached) await page.context().addCookies(cached);
  else {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email(role));
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await completeSignIn(page);
    sessions.set(role, await page.context().cookies());
  }
  await page.goto(path);
}
const uniq = (p: string) => `${p}${test.info().project.name === 'mobile' ? 'M' : 'T'}${Math.random().toString(36).slice(2, 6)}`;
const dialog = (page: Page) => page.getByRole('dialog');
const rid = async () => (await q<{ id: string }>(`select id from public.restaurants where slug = 'spice-garden'`))[0]!.id;
const dishRow = (page: Page, name: string) => page.locator('li', { has: page.getByText(name, { exact: true }) });

async function bigPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2000;
    const x = c.getContext('2d')!;
    x.fillStyle = '#c2410c'; x.fillRect(0, 0, 3000, 2000);
    x.fillStyle = '#facc15'; x.fillRect(500, 400, 2000, 1200);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const n of buf) s += String.fromCharCode(n);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

test.describe('access', () => {
  test('signed-out visitors go to sign-in; waiters never see the dashboard', async ({ page }) => {
    await page.goto('/dash/menu');
    await expect(page).toHaveURL(/\/login\?next=%2Fdash%2Fmenu/);
    await loginAs(page, 'waiter', '/dash/menu');
    await expect(page).toHaveURL(/\/staff$/);
    expect((await page.request.get('/api/dash/menu')).status()).toBe(403);
  });
  test('the dashboard API refuses calls without a session', async ({ request }) => {
    expect((await request.get('/api/dash/menu')).status()).toBe(401);
  });
});

test.describe('menu manager', () => {
  test('owner adds a category and a dish with a photo that is shrunk to 1600px WebP, edits, duplicates, sells out and deletes it', async ({ page }) => {
    await loginAs(page, 'owner');
    const cat = uniq('Cat');
    const dish = uniq('Dish');
    await page.getByRole('button', { name: 'Add category' }).click();
    await dialog(page).getByLabel('Category name').fill(cat);
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: cat })).toBeVisible();

    await page.getByRole('region', { name: cat }).getByRole('button', { name: 'Add dish' }).click();
    await dialog(page).getByLabel('Dish name').fill(dish);
    await dialog(page).getByLabel('Price (₹)').fill('249.50');
    await dialog(page).getByRole('radio', { name: 'Non-veg' }).check();
    await dialog(page).getByLabel('Bestseller badge').check();
    await dialog(page).getByLabel('Choose a photo').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: await bigPng(page) });
    await expect(dialog(page).getByAltText('Dish photo preview')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-item-dialog.png` });
    await dialog(page).getByRole('button', { name: 'Save dish' }).click();
    await expect(dishRow(page, dish)).toContainText('₹249.50');
    await expect(dishRow(page, dish)).toContainText('Bestseller');

    const [row] = await q<{ price_paise: number; diet: string; image_path: string }>(`select price_paise, diet, image_path from public.items where name_en = $1`, [dish]);
    expect(row).toMatchObject({ price_paise: 24950, diet: 'nonveg' });
    expect(row!.image_path).toMatch(new RegExp(`^${await rid()}/[0-9a-f-]{36}\\.webp$`));

    // the stored photo really is a WebP no larger than 1600px
    const src = (await dishRow(page, dish).locator('img').getAttribute('src'))!;
    const type = (await page.request.get(src)).headers()['content-type'];
    const dims = await page.evaluate(async (u) => {
      const img = new Image(); img.src = u; await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight };
    }, src);
    expect(type).toBe('image/webp');
    expect(Math.max(dims.w, dims.h)).toBe(1600);

    await dishRow(page, dish).getByRole('button', { name: `Edit ${dish}` }).click();
    await dialog(page).getByLabel('Price (₹)').fill('260');
    await dialog(page).getByRole('button', { name: 'Save dish' }).click();
    await expect(dishRow(page, dish)).toContainText('₹260');

    await dishRow(page, dish).getByRole('switch').click();
    await expect(dishRow(page, dish)).toContainText('Sold out');
    expect((await q(`select 1 from public.items where name_en = $1 and not is_available`, [dish])).length).toBe(1);

    await dishRow(page, dish).getByRole('button', { name: `Duplicate ${dish}` }).click();
    await expect(page.getByText(`${dish} (copy)`, { exact: true })).toBeVisible();

    await dishRow(page, dish).getByRole('button', { name: `Delete ${dish}` }).click();
    await expect(dialog(page)).toContainText(`Delete “${dish}”?`);
    await dialog(page).getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page.getByText(dish, { exact: true })).toHaveCount(0);
    expect((await q(`select 1 from public.items where name_en = $1`, [dish])).length).toBe(0);
    await page.getByRole('region', { name: cat }).getByRole('button', { name: 'Delete' }).first().click(); // category: asks first
    await expect(dialog(page)).toContainText(`Delete category “${cat}”?`);
  });

  test('reorder with the move buttons, bulk sold-out and bulk price change', async ({ page }) => {
    await loginAs(page, 'owner');
    const cat = uniq('Order');
    const [a, b] = [uniq('Alpha'), uniq('Beta')];
    await page.getByRole('button', { name: 'Add category' }).click();
    await dialog(page).getByLabel('Category name').fill(cat);
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    for (const [n, price] of [[a, '100'], [b, '200']] as const) {
      await page.getByRole('region', { name: cat }).getByRole('button', { name: 'Add dish' }).first().click();
      await dialog(page).getByLabel('Dish name').fill(n);
      await dialog(page).getByLabel('Price (₹)').fill(price);
      await dialog(page).getByRole('button', { name: 'Save dish' }).click();
      await expect(dishRow(page, n)).toBeVisible();
    }
    const names = () => page.getByRole('region', { name: cat }).locator('li p.font-semibold').allTextContents();
    expect(await names()).toEqual([a, b]);
    await page.getByRole('button', { name: `Move ${b} up` }).click();
    await expect.poll(names).toEqual([b, a]);
    expect((await q<{ n: string }>(`select name_en n from public.items where name_en in ($1,$2) order by sort_order`, [a, b])).map((r) => r.n)).toEqual([b, a]);

    await page.getByLabel(`Select ${a}`).check();
    await page.getByLabel(`Select ${b}`).check();
    await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Mark sold out' }).click();
    await expect(dishRow(page, a)).toContainText('Sold out');
    await page.getByLabel(`Select ${a}`).check();
    await page.getByLabel(`Select ${b}`).check();
    await page.getByRole('button', { name: 'Change prices' }).click();
    await dialog(page).getByRole('textbox', { name: 'Percent' }).fill('10');
    await dialog(page).getByRole('button', { name: /Apply to 2 dishes/ }).click();
    await expect(dishRow(page, a)).toContainText('₹110');
    await expect(dishRow(page, b)).toContainText('₹220');
    expect((await q<{ p: number }>(`select price_paise p from public.items where name_en = $1`, [a]))[0]!.p).toBe(11000);
  });

  test('CSV import shows per-row errors, imports only when all rows are right, and export protects formulas', async ({ page }) => {
    await loginAs(page, 'owner');
    const tag = uniq('Csv');
    await page.getByRole('button', { name: 'Import CSV' }).click();
    const bad = `category,name,description,price,diet,spice,bestseller,chef_pick,available\r\n${tag},Good ${tag},Nice,120,veg,1,no,no,yes\r\n${tag},Bad ${tag},Oops,abc,veg,1,no,no,yes\r\n`;
    await dialog(page).getByLabel('Choose your CSV file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
    await expect(dialog(page)).toContainText('1 with problems');
    await expect(dialog(page).locator('tr', { hasText: `Bad ${tag}` })).toContainText(/price/i);
    await expect(dialog(page).locator('tr', { hasText: `Bad ${tag}` })).toContainText('3');
    await expect(dialog(page).getByRole('button', { name: /Fix the rows/ })).toBeDisabled();
    expect((await q(`select 1 from public.items where name_en = 'Good ${tag}'`)).length).toBe(0);

    const good = `category,name,description,price,diet,spice,bestseller,chef_pick,available\r\n${tag},Good ${tag},Nice,120,veg,1,no,no,yes\r\n${tag},=Evil(1),Formula,99,egg,0,yes,no,yes\r\n`;
    await dialog(page).getByLabel('Choose your CSV file').setInputFiles({ name: 'good.csv', mimeType: 'text/csv', buffer: Buffer.from(good) });
    await expect(dialog(page)).toContainText('all look good');
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-csv-preview.png` });
    await dialog(page).getByRole('button', { name: 'Import menu' }).click();
    await expect(page.getByText('Imported: 2 added, 0 updated.')).toBeVisible();
    await expect(page.getByRole('heading', { name: tag })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    const text = await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8');
    expect(text.split('\r\n')[0]).toBe('category,name,description,price,diet,spice,bestseller,chef_pick,available,sizes');
    expect(text).toContain(`${tag},Good ${tag},Nice,120,veg,1,no,no,yes`);
    expect(text).toContain("'=Evil(1)"); // a spreadsheet would otherwise run it as a formula
  });
});

test.describe('dish sizes and options', () => {
  test('add sizes and an option group to a dish, see them in the list, change them, and remove them', async ({ page }) => {
    await loginAs(page, 'owner');
    const cat = uniq('SizeCat');
    const dish = uniq('Shake');
    await page.getByRole('button', { name: 'Add category' }).click();
    await dialog(page).getByLabel('Category name').fill(cat);
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: cat })).toBeVisible();

    await page.getByRole('region', { name: cat }).getByRole('button', { name: 'Add dish' }).click();
    await dialog(page).getByLabel('Dish name').fill(dish);
    // ready-made size names, the owner only adds prices
    await dialog(page).getByRole('button', { name: 'S / M / L / XL' }).click();
    await expect(dialog(page).getByLabel('Size 4 name')).toHaveValue('XL');
    await expect(dialog(page).getByLabel('Price (₹)')).toBeDisabled();
    // a size without a price is explained, nothing is saved
    await dialog(page).getByRole('button', { name: 'Save dish' }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('price of "Small"');
    for (const [i, price] of [['1', '120'], ['2', '160'], ['3', '200'], ['4', '240']] as const) await dialog(page).getByLabel(`Size ${i} price in rupees`).fill(price);
    await dialog(page).getByLabel('Size 4 available').uncheck();

    await dialog(page).getByRole('button', { name: 'Add an option group' }).click();
    await dialog(page).getByLabel('Group 1 title').fill('Choose your topping');
    await dialog(page).getByLabel('Group 1 is required').check();
    await dialog(page).getByLabel('Group 1 choice 1 name').fill('Oreo');
    await dialog(page).getByRole('button', { name: 'Add a choice' }).click();
    await dialog(page).getByLabel('Group 1 choice 2 name').fill('Choco chips');
    await dialog(page).getByLabel('Group 1 choice 2 extra price in rupees').fill('15');
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-sizes-editor.png`, fullPage: true });
    await dialog(page).getByRole('button', { name: 'Save dish' }).click();
    await expect(dishRow(page, dish)).toContainText('from ₹120 · 4 sizes');
    await expect(dishRow(page, dish)).toContainText('1 option group');

    const [d] = await q<{ id: string; price_paise: number }>(`select id, price_paise from public.items where name_en = $1`, [dish]);
    expect(d!.price_paise).toBe(12000);
    const v = await q<{ name: string; price_paise: number; is_available: boolean }>(`select name, price_paise, is_available from public.item_variants where item_id = $1 order by sort_order`, [d!.id]);
    expect(v).toEqual([{ name: 'Small', price_paise: 12000, is_available: true }, { name: 'Medium', price_paise: 16000, is_available: true }, { name: 'Large', price_paise: 20000, is_available: true }, { name: 'XL', price_paise: 24000, is_available: false }]);
    const o = await q<{ name: string; required: boolean; max_select: number; options: string }>(`select g.name, g.required, g.max_select, (select string_agg(o.name || ':' || o.price_delta_paise, ',' order by o.sort_order) from public.item_options o where o.group_id = g.id) as options from public.item_option_groups g where g.item_id = $1`, [d!.id]);
    expect(o).toEqual([{ name: 'Choose your topping', required: true, max_select: 1, options: 'Oreo:0,Choco chips:1500' }]);

    // reopen: everything is there; change a price and remove the group; the other sizes keep their rows
    const before = await q<{ id: string }>(`select id from public.item_variants where item_id = $1 order by sort_order`, [d!.id]);
    await dishRow(page, dish).getByRole('button', { name: `Edit ${dish}` }).click();
    await expect(dialog(page).getByLabel('Size 2 name')).toHaveValue('Medium');
    await expect(dialog(page).getByLabel('Group 1 choice 2 extra price in rupees')).toHaveValue('15');
    await dialog(page).getByLabel('Size 2 price in rupees').fill('170');
    await dialog(page).getByRole('button', { name: 'Remove this group' }).click();
    await dialog(page).getByRole('button', { name: 'Save dish' }).click();
    await expect(dishRow(page, dish)).not.toContainText('option group');
    const after = await q<{ id: string; price_paise: number }>(`select id, price_paise from public.item_variants where item_id = $1 order by sort_order`, [d!.id]);
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));
    expect(after[1]!.price_paise).toBe(17000);
    expect((await q<{ n: number }>(`select count(*)::int n from public.item_option_groups where item_id = $1`, [d!.id]))[0]!.n).toBe(0);

    // the guest menu shows the dish "from" its cheapest size
    await page.goto('/spice-garden');
    await expect(page.locator('li', { has: page.getByRole('heading', { name: dish, level: 3 }) })).toContainText('from ₹120');

    // removing all sizes makes it a plain dish again, at the price typed in the Price field
    await page.goto('/dash/menu');
    await dishRow(page, dish).getByRole('button', { name: `Edit ${dish}` }).click();
    for (let i = 0; i < 4; i++) await dialog(page).getByLabel('Size 1 name').locator('xpath=ancestor::li').getByRole('button', { name: 'Remove size 1' }).click();
    await dialog(page).getByLabel('Price (₹)').fill('99');
    await dialog(page).getByRole('button', { name: 'Save dish' }).click();
    await expect(dishRow(page, dish)).toContainText('₹99');
    await expect(dishRow(page, dish)).not.toContainText('sizes');
  });
});

test.describe('tables and QR codes', () => {
  test('call for problems: turn on, edit the problems, see link and QR, print the card, new link, turn off', async ({ page }) => {
    await q(`update public.restaurants set help_token = null where slug = 'spice-garden'`);
    try {
      await loginAs(page, 'owner', '/dash/tables');
      const section = page.getByRole('region', { name: 'Call for problems link' });
      await expect(section).toContainText('Off');
      await expect(section.getByLabel('Problems guests can tap (one per line)')).toHaveValue(/WiFi not working/);
      await section.getByLabel('Problems guests can tap (one per line)').fill('Towel\nWiFi down\n  Minibar empty  \n');
      await section.getByRole('button', { name: 'Turn on call for problems' }).click();
      await expect(page.getByText('Call for problems is on.')).toBeVisible();
      await expect(section.getByRole('img', { name: 'QR code for the call for problems link' })).toBeVisible();
      const read = async () => (await q<{ help_token: string | null; help_topics: string[] }>(`select help_token, help_topics from public.restaurants where slug = 'spice-garden'`))[0]!;
      const first = await read();
      expect(first.help_token).toMatch(/^[0-9a-f]{64}$/);
      expect(first.help_topics).toEqual(['Towel', 'WiFi down', 'Minibar empty']);
      await expect(section.getByLabel('Problems link')).toHaveValue(new RegExp(`/spice-garden/help\\?k=${first.help_token}$`));
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-help-link.png`, fullPage: true });

      page.once('dialog', (d) => void d.accept());
      await section.getByRole('button', { name: 'New link' }).click();
      await expect(page.getByText('New link created.').first()).toBeVisible();
      expect((await read()).help_token).not.toBe(first.help_token);

      await page.goto('/dash/print?layout=help');
      await expect(page.getByRole('heading', { name: 'Call for problems card' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'QR code to call for problems' })).toBeVisible();

      await page.goto('/dash/tables');
      await section.getByRole('button', { name: 'Turn off' }).click();
      await expect(page.getByText('Call for problems is off.')).toBeVisible();
      expect((await read()).help_token).toBeNull();
    } finally {
      await q(`update public.restaurants set help_token = null, help_topics = array['Towel or bedsheet','Room cleaning','Water not coming','Hot water not coming','Light not working','AC or heater problem','TV not working','WiFi not working','Room service','Door lock or key problem','Noise or other guests','Medical help'] where slug = 'spice-garden'`);
    }
  });

  test('shared table link: turn on, see link and QR, print the card, new link, turn off', async ({ page }) => {
    await q(`update public.restaurants set table_token = null where slug = 'spice-garden'`);
    try {
      await loginAs(page, 'owner', '/dash/tables');
      const section = page.getByRole('region', { name: 'Shared table link' });
      await expect(section).toContainText('Off');
      await section.getByRole('button', { name: 'Turn on shared table link' }).click();
      await expect(page.getByText('Shared table link is on.')).toBeVisible();
      await expect(section.getByRole('img', { name: 'QR code for the shared table link' })).toBeVisible();
      const tok = async () => (await q<{ table_token: string | null }>(`select table_token from public.restaurants where slug = 'spice-garden'`))[0]!.table_token;
      const first = await tok();
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      await expect(section.getByLabel('Table link')).toHaveValue(new RegExp(`/spice-garden\\?k=${first}$`));

      page.once('dialog', (d) => void d.accept());
      await section.getByRole('button', { name: 'New link' }).click();
      await expect(page.getByText('New link created.').first()).toBeVisible();
      expect(await tok()).not.toBe(first);

      await page.goto('/dash/print?layout=tablelink');
      await expect(page.getByRole('heading', { name: 'Shared table card' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'QR code to order at your table' })).toBeVisible();

      await page.goto('/dash/tables');
      await section.getByRole('button', { name: 'Turn off' }).click();
      await expect(page.getByText('Shared table link is off.')).toBeVisible();
      expect(await tok()).toBeNull();
    } finally {
      await q(`update public.restaurants set table_token = null where slug = 'spice-garden'`);
    }
  });

  test('room service: turn on with a room list, see the link and QR, print the card, turn off', async ({ page }) => {
    await q(`update public.restaurants set room_token = null, room_numbers = '{}' where slug = 'spice-garden'`);
    try {
      await loginAs(page, 'owner', '/dash/tables');
      const section = page.getByRole('region', { name: 'Room service link' });
      await expect(section).toContainText('Off');
      await section.getByLabel('Rooms (optional)').fill('101-103, 201');
      await section.getByRole('button', { name: 'Turn on room service' }).click();
      await expect(page.getByText('Room service is on.')).toBeVisible();
      await expect(section.getByRole('img', { name: 'QR code for the room service link' })).toBeVisible();
      const [row] = await q<{ room_token: string; room_numbers: string[] }>(`select room_token, room_numbers from public.restaurants where slug = 'spice-garden'`);
      expect(row!.room_token).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.room_numbers).toEqual(['101', '102', '103', '201']);
      await expect(section.getByLabel('Link')).toHaveValue(new RegExp(`/spice-garden\\?k=${row!.room_token}$`));
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-room-service.png`, fullPage: true });

      // a wrong list is explained, nothing changes
      await section.getByLabel('Rooms (optional)').fill('110-101');
      await section.getByRole('button', { name: 'Save rooms' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'not a valid range' })).toBeVisible();

      await page.goto('/dash/print?layout=room');
      await expect(page.getByRole('heading', { name: 'Room service card' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'QR code to order room service' })).toBeVisible();

      await page.goto('/dash/tables');
      await section.getByRole('button', { name: 'Turn off' }).click();
      await expect(page.getByText('Room service is off.')).toBeVisible();
      expect((await q<{ room_token: string | null }>(`select room_token from public.restaurants where slug = 'spice-garden'`))[0]!.room_token).toBeNull();
    } finally {
      await q(`update public.restaurants set room_token = null, room_numbers = '{}' where slug = 'spice-garden'`);
    }
  });

  test('create tables, rotate a QR code with a warning, and print both layouts', async ({ page }) => {
    await loginAs(page, 'owner', '/dash/tables');
    const base = test.info().project.name === 'mobile' ? 810 : 820;
    await page.getByLabel('From', { exact: true }).fill(String(base));
    await page.getByLabel('To', { exact: true }).fill(String(base + 2));
    await page.getByRole('button', { name: 'Create tables' }).click();
    await expect(page.getByText('Tables created.')).toBeVisible();
    await expect(page.getByRole('img', { name: `QR code for table ${base + 1}` })).toBeVisible();

    const tokenOf = async () => (await q<{ qr_token: string }>(`select qr_token from public.dining_tables where label = $1 and restaurant_id = $2`, [String(base), await rid()]))[0]!.qr_token;
    const before = await tokenOf();
    await page.getByRole('button', { name: `New QR code for table ${base}` }).click();
    await expect(dialog(page)).toContainText('stop working immediately');
    expect(await tokenOf()).toBe(before); // nothing changes until confirmed
    await dialog(page).getByRole('button', { name: 'Yes, make a new QR' }).click();
    await expect(page.getByText(`Table ${base} has a new QR code`)).toBeVisible();
    expect(await tokenOf()).not.toBe(before);
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-tables.png`, fullPage: true });

    // the QR really encodes this table's address
    const svg = decodeURIComponent((await page.getByRole('img', { name: `QR code for table ${base}` }).getAttribute('src'))!.replace('data:image/svg+xml;utf8,', ''));
    expect(svg).toContain('<svg');

    for (const layout of ['sheet', 'tent'] as const) {
      await page.goto(`/dash/print?layout=${layout}`);
      await expect(page.getByText('Spice Garden').first()).toBeVisible();
      await expect(page.getByText('Scan to order').first()).toBeVisible();
      await expect(page.getByRole('img', { name: `QR code for table ${base}` })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Dashboard' })).toBeHidden({ timeout: 100 }).catch(() => undefined);
    }
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
    await page.pdf({ path: `${SHOTS}/${test.info().project.name}-qr-tent.pdf`, format: 'A4', landscape: true, printBackground: true });
  });
});

test.describe('staff accounts', () => {
  test('owner adds a waiter; the temporary password forces a new one; deactivation locks them out; managers only view', async ({ page, browser }) => {
    await loginAs(page, 'owner', '/dash/staff');
    const mail = `${uniq('new').toLowerCase()}@spice-garden.demo`;
    await page.getByRole('button', { name: 'Add staff member' }).click();
    await dialog(page).getByLabel('Name').fill('Test Waiter');
    await dialog(page).getByLabel(/Email/).fill(mail);
    await dialog(page).getByLabel('Role').selectOption('waiter');
    await dialog(page).getByRole('button', { name: 'Create account' }).click();
    await expect(dialog(page)).toContainText('shown only once');
    const temp = (await dialog(page).getByTestId('temp-password').textContent())!;
    expect(temp.length).toBeGreaterThanOrEqual(14);
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    await expect(page.getByText(mail)).toBeVisible();

    // the new person: temporary password -> must choose their own before anything else
    const ctx = await browser.newContext(test.info().project.use as never);
    const p2 = await ctx.newPage();
    await p2.goto('/login');
    await p2.getByLabel('Email').fill(mail);
    await p2.getByLabel('Password').fill(temp);
    await p2.getByRole('button', { name: 'Sign in' }).click();
    await expect(p2).toHaveURL(/\/account\/password$/);
    await p2.goto('/staff');
    await expect(p2).toHaveURL(/\/account\/password$/); // cannot skip it
    expect((await p2.request.get('/api/staff/board')).status()).toBe(403);
    await p2.getByLabel('New password', { exact: true }).fill('short');
    await p2.getByLabel('Type it again').fill('short');
    await p2.getByRole('button', { name: 'Save password' }).click();
    const newPass = `Brand-new-${Math.random().toString(36).slice(2, 10)}-pw!`;
    await p2.getByLabel('New password', { exact: true }).fill(newPass);
    await p2.getByLabel('Type it again').fill(newPass);
    await p2.getByRole('button', { name: 'Save password' }).click();
    await expect(p2).toHaveURL(/\/staff$/);
    await expect(p2.getByRole('heading', { level: 1 })).toContainText('Spice Garden');
    await p2.goto('/dash/menu');
    await expect(p2).toHaveURL(/\/staff$/); // a waiter has no dashboard

    // deactivate: their next request is refused
    await page.getByRole('button', { name: 'Deactivate Test Waiter' }).click();
    await expect(page.getByText('Deactivated')).toBeVisible();
    expect((await p2.request.get('/api/staff/board')).status()).toBe(403);
    await ctx.close();

    // reset password shows a new one-time password
    await page.getByRole('button', { name: 'Reset password for Test Waiter' }).click();
    await dialog(page).getByRole('button', { name: 'Yes, reset it' }).click();
    await expect(dialog(page).getByTestId('temp-password')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'I have saved it' }).click();
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-staff.png`, fullPage: true });
    // cleanup so reruns stay tidy
    await q(`delete from auth.users where email = $1`, [mail]).catch(() => undefined);
  });

  test('a manager sees the list but has no controls to change it', async ({ page }) => {
    await loginAs(page, 'manager', '/dash/staff');
    await expect(page.getByText('Only the owner can add or change staff accounts')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add staff member' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Deactivate|Reset password/ })).toHaveCount(0);
    expect((await page.request.post('/api/dash/staff-add', { headers: { origin: new URL(page.url()).origin }, data: { email: 'x@y.test', name: 'X', role: 'waiter' } })).status()).toBe(403);
  });
});

test.describe('settings', () => {
  test('owner changes name and colour and the guest and staff screens follow; managers cannot edit', async ({ page }) => {
    await loginAs(page, 'owner', '/dash/settings');
    const [orig] = await q<{ name: string; accent: string; amber_minutes: number; red_minutes: number; review_url: string | null }>(`select name, accent, amber_minutes, red_minutes, review_url from public.restaurants where slug = 'spice-garden'`);
    const renamed = uniq('Spice Garden ');
    try {
      await page.getByLabel('Restaurant name').fill(renamed);
      await page.getByText('indigo', { exact: true }).click();
      await page.getByLabel('Turn amber after (minutes)').fill('7');
      await page.getByLabel('Turn red after (minutes)').fill('14');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(page.getByText('Settings saved.')).toBeVisible();
      await page.goto('/spice-garden');
      await expect(page.getByRole('heading', { level: 1 })).toContainText(renamed.trim());
      await expect(page.locator('[data-accent="indigo"]').first()).toBeAttached();
      expect((await q<{ a: number; r: number }>(`select amber_minutes a, red_minutes r from public.restaurants where slug = 'spice-garden'`))[0]).toEqual({ a: 7, r: 14 });
      await page.goto('/dash/settings');
      await page.getByLabel('Google review link (optional)').fill('http://not-secure.example');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(page.locator('p[role="alert"]')).toBeVisible();
    } finally {
      // put the demo restaurant back exactly as it was, so other tests see the same settings
      await q(`update public.restaurants set name = $1, accent = $2, amber_minutes = $3, red_minutes = $4, review_url = $5 where slug = 'spice-garden'`, [orig!.name, orig!.accent, orig!.amber_minutes, orig!.red_minutes, orig!.review_url]);
    }
  });
  test('owner crops a logo and banner and sets the explore link; the guest menu shows the identity and one "Explore more before leaving" button, no contact buttons', async ({ page }) => {
    await loginAs(page, 'owner', '/dash/settings');
    await page.goto('/spice-garden');
    await expect(page.getByRole('link', { name: 'Explore more before leaving' })).toHaveCount(0);
    await page.goto('/dash/settings');
    try {
      // logo: choose a file, then choose the visible part
      await page.getByLabel('Choose logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await bigPng(page) });
      await expect(dialog(page).getByText('Drag the photo to choose what shows')).toBeVisible();
      await dialog(page).getByLabel('Zoom', { exact: true }).fill('2');
      await dialog(page).getByRole('group', { name: /Crop area/ }).focus();
      await page.keyboard.press('ArrowLeft');
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-crop.png` });
      await dialog(page).getByRole('button', { name: 'Use this crop' }).click();
      await expect(page.getByAltText('Current logo')).toBeVisible();
      // banner: cancelling keeps nothing
      await page.getByLabel('Choose banner picture').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: await bigPng(page) });
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByAltText('Current banner picture')).toHaveCount(0);
      await page.getByLabel('Choose banner picture').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: await bigPng(page) });
      await dialog(page).getByRole('button', { name: 'Use this crop' }).click();
      await expect(page.getByAltText('Current banner picture')).toBeVisible();

      await page.getByLabel('Short tagline').fill('Garden-fresh North Indian');
      await page.getByLabel('Address').fill('12 Garden Road, Jaipur');
      await page.getByLabel('Opening hours').fill('Daily 11 am - 11 pm');
      await page.getByLabel('Explore link code').fill('https://evil.example/x');
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.locator('p[role="alert"]').first()).toBeVisible(); // a foreign link is refused
      await page.getByLabel('Explore link code').fill('spice-garden_1');
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.getByText('Profile saved.')).toBeVisible();

      await page.goto('/spice-garden');
      await expect(page.getByText('Garden-fresh North Indian')).toBeVisible();
      await expect(page.getByAltText('Spice Garden logo')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Explore more before leaving' })).toHaveAttribute('href', 'https://smarty.taprizz.in/sq/spice-garden_1');
      await expect(page.getByRole('link', { name: 'Explore more before leaving' })).toHaveAttribute('rel', /noopener/);
      for (const gone of ['Call', 'WhatsApp', 'Directions', 'Instagram', 'Review us on Google']) await expect(page.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
      await expect(page.getByText('Daily 11 am - 11 pm')).toBeVisible();
      expect((await q<{ b: string | null }>(`select banner_path b from public.restaurants where slug = 'spice-garden'`))[0]!.b).toMatch(/\.webp$/);
      await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-guest-profile.png` });
    } finally {
      await q(`update public.restaurants set tagline = null, description = null, logo_path = null, banner_path = null, address = null, hours_text = null, explore_code = null where slug = 'spice-garden'`);
    }
  });
  test('owner switches on "orders only near the cafe" with the cafe position; it needs a position', async ({ page }) => {
    await loginAs(page, 'owner', '/dash/settings');
    try {
      await page.getByLabel('Only take orders from guests near the cafe').check();
      await page.getByRole('button', { name: 'Save', exact: true }).first().click();
      await expect(page.locator('p[role="alert"]').first()).toBeVisible(); // no position yet
      await page.getByLabel('Latitude').fill('26.9124');
      await page.getByLabel('Longitude').fill('75.7873');
      await page.getByLabel('How near is “near”').selectOption('250');
      await page.getByRole('button', { name: 'Save', exact: true }).first().click();
      await expect(page.getByText('Saved.')).toBeVisible();
      expect((await q<any>(`select geo_required, geo_lat, geo_lng, geo_radius_m from public.restaurants where slug = 'spice-garden'`))[0]).toEqual({ geo_required: true, geo_lat: 26.9124, geo_lng: 75.7873, geo_radius_m: 250 });
    } finally {
      await q(`update public.restaurants set geo_required = false, geo_lat = null, geo_lng = null, geo_radius_m = 150 where slug = 'spice-garden'`);
    }
  });
  test('a manager sees settings read-only', async ({ page }) => {
    await loginAs(page, 'manager', '/dash/settings');
    await expect(page.getByText('Only the owner can change settings')).toBeVisible();
    await expect(page.getByLabel('Restaurant name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  });
});

test.describe('analytics', () => {
  test('a guest visit shows up as a menu open and a table QR scan; the numbers are explained and can be downloaded', async ({ page }) => {
    const t = await newTable();
    const beacon = page.waitForResponse((r) => r.url().includes('/api/guest/event') && r.request().method() === 'POST');
    await page.goto(`/spice-garden?k=${t.token}`);
    expect((await beacon).status()).toBe(200);
    await page.getByRole('navigation', { name: 'Menu categories' }).getByRole('button').first().click();
    await page.waitForTimeout(500);
    await loginAs(page, 'owner', '/dash/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Menu analytics' })).toBeVisible();
    await expect(page.getByText(`Table ${t.label}`)).toBeVisible();
    await expect(page.getByText('How to read these numbers')).toBeVisible();
    const opens = page.locator('div', { has: page.getByText('Menu opens', { exact: true }) }).last();
    await expect(opens).toContainText(/[1-9]/);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download as CSV' }).click();
    expect((await dl).suggestedFilename()).toBe('menu-analytics-7d.csv');
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('report and activity log', () => {
  test('report switches ranges and the activity log lists who did what', async ({ page }) => {
    await loginAs(page, 'owner', '/dash/report');
    await expect(page.getByText('Average order')).toBeVisible();
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await expect(page.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Top 10 dishes' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-report.png`, fullPage: true });
    await page.goto('/dash/audit');
    await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
    await expect(page.locator('ul li').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-dash-audit.png`, fullPage: true });
  });
});

test.describe('quality', () => {
  for (const [name, path] of [['menu', '/dash/menu'], ['tables', '/dash/tables'], ['staff', '/dash/staff'], ['settings', '/dash/settings'], ['report', '/dash/report'], ['analytics', '/dash/analytics'], ['activity log', '/dash/audit']] as const) {
    test(`the ${name} page has no accessibility violations and every control is at least 44px`, async ({ page }) => {
      await loginAs(page, 'owner', path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('button, a[href], select, [role="switch"], input:not([type="hidden"])')]
          .filter((el) => el.offsetParent !== null && !el.closest('dialog:not([open])'))
          .map((el) => {
            const target = el.matches('input[type="checkbox"], input[type="radio"]') ? (el.closest('label') ?? el) : el;
            const b = target.getBoundingClientRect();
            return { text: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40), w: Math.round(b.width), h: Math.round(b.height), inline: getComputedStyle(el).display === 'inline' && el.tagName === 'A' && !el.className };
          })
          .filter((s) => (s.w < 44 || s.h < 44) && !s.inline),
      );
      expect(small).toEqual([]);
    });
  }
});
