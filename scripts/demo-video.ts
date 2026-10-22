/**
 * Records a narrated demo video of the REAL app: the staff tablet (left) and a guest's phone (right) side by side.
 *   npm run demo:video        (needs a production build: `npm run build` first, or set DEMO_BUILD=1)
 * Output: demo-video/GoToMenu-demo.mp4 (+ the raw per-screen recordings in demo-video/raw).
 * Only what is built is shown. Nothing is mocked: every click goes through the real pages, API and database.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, type Locator, type Page } from '@playwright/test';
import { DEMO_TOTP_SECRET, totp } from '../supabase/tests/helpers/totp';

const INFO = '/tmp/gotomenu-demo-stack.json';
const PORT = process.env.E2E_PORT ?? '3100';
const BASE = `http://localhost:${PORT}`;
const OUT = 'demo-video';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPass#2025!';

// ---------------------------------------------------------------- infrastructure (start the local stack, then record)
const children: ChildProcess[] = [];
const start = (cmd: string, args: string[], env: Record<string, string | undefined> = {}) => {
  const c = spawn(cmd, args, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  children.push(c);
};
const stopAll = () => children.forEach((c) => { try { process.kill(-c.pid!, 'SIGTERM'); } catch { /* gone */ } });
const waitFor = async (ok: () => Promise<boolean>, what: string) => {
  for (let i = 0; i < 240; i++) {
    if (await ok().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${what}`);
};

async function main() {
  if (process.argv[2] === 'record') return record();
  if (process.argv[2] === 'compose') return compose(); // re-render captions from the saved recordings
  rmSync(INFO, { force: true });
  let code = 1;
  try {
    start('node_modules/.bin/tsx', ['scripts/dev-stack.ts'], { DEV_STACK_INFO: INFO });
    await waitFor(async () => existsSync(INFO), 'dev stack');
    start('scripts/start-app-local.sh', [], { PORT, SKIP_BUILD: process.env.DEMO_BUILD === '1' ? '' : '1' });
    await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok, 'app');
    code = await new Promise<number>((res) => {
      const p = spawn('node_modules/.bin/tsx', ['scripts/demo-video.ts', 'record'], { stdio: 'inherit', env: { ...process.env, DEV_STACK_INFO: INFO } });
      p.on('exit', (c) => res(c ?? 1));
    });
  } finally {
    stopAll();
    await new Promise((r) => setTimeout(r, 1500));
  }
  process.exit(code);
}

// ---------------------------------------------------------------- on-screen helpers (visible cursor, click ripple)
const overlay = (t0: number) => `(() => {
  const css = \`
  #__cur{position:fixed;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:rgba(239,68,68,.5);border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.4);z-index:2147483647;pointer-events:none;transition:transform .12s linear;opacity:0}
  .__rip{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:5px solid rgba(239,68,68,.95);z-index:2147483646;pointer-events:none;animation:__rip .7s ease-out forwards}
  @keyframes __rip{to{transform:scale(3.4);opacity:0}}\`;
  const T0 = ${t0};
  const clock = () => {
    // 11 black/white squares in the top-left corner encode elapsed half-seconds; compose() reads them back from the
    // recording to line the captions up with what is really on screen, then crops the strip away.
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;top:0;width:110px;height:10px;z-index:2147483647;display:flex;pointer-events:none;background:#000';
    const cells = Array.from({ length: 11 }, () => { const c = document.createElement('div'); c.style.cssText = 'width:10px;height:10px'; bar.appendChild(c); return c; });
    document.documentElement.appendChild(bar);
    const tick = () => { const v = Math.floor((Date.now() - T0) / 500); cells.forEach((c, i) => { c.style.background = (v >> (10 - i)) & 1 ? '#fff' : '#000'; }); };
    tick(); setInterval(tick, 100);
  };
  const init = () => {
    clock();
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const cur = document.createElement('div'); cur.id = '__cur'; document.body.appendChild(cur);
    addEventListener('mousemove', (e) => { cur.style.opacity = '1'; cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 800); }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();`;

const cues: { t: number; text: string }[] = [];
let videoZero = 0;
const say = (text: string) => cues.push({ t: (Date.now() - videoZero) / 1000, text });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tap(page: Page, loc: Locator, after = 700) {
  await loc.first().scrollIntoViewIfNeeded();
  const b = await loc.first().boundingBox();
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 });
    await sleep(250);
  }
  await loc.first().click();
  await sleep(after);
}
async function typeInto(page: Page, loc: Locator, text: string) {
  await tap(page, loc, 150);
  await loc.first().pressSequentially(text, { delay: 70 });
  await sleep(400);
}
const scrollTo = async (page: Page, loc: Locator) => {
  await loc.first().evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(900);
};

const card = (html: string) => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box">${html}</body>`;

// ---------------------------------------------------------------- the story
async function record() {
  const info = JSON.parse(readFileSync(process.env.DEV_STACK_INFO ?? INFO, 'utf8')) as { db: string; seeded: { restaurants: { slug: string; tables: { label: string; token: string }[] }[] } };
  const table = info.seeded.restaurants.find((r) => r.slug === 'spice-garden')!.tables[6]!; // "Table 7"
  const aromaTable = info.seeded.restaurants.find((r) => r.slug === 'cafe-aroma')!.tables[0]!;
  const { Pool } = await import('pg');
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://gm_test:gm_test@127.0.0.1:5432/postgres');
  url.pathname = `/${info.db}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  const sql = (q: string, p: unknown[] = []) => pool.query(q, p);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(`${OUT}/raw/staff`, { recursive: true });
  mkdirSync(`${OUT}/raw/guest`, { recursive: true });
  const pre = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({ executablePath: existsSync(pre) ? pre : undefined, args: ['--no-sandbox'] });
  const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 880 }, bypassCSP: true, hasTouch: true, recordVideo: { dir: `${OUT}/raw/staff`, size: { width: 1280, height: 880 } } });
  const guestCtx = await browser.newContext({ // A roomy phone-shaped screen: the recording is captured at CSS-pixel size, so a bigger screen is what makes it sharp.
    viewport: { width: 480, height: 1040 }, isMobile: true, hasTouch: true, bypassCSP: true, recordVideo: { dir: `${OUT}/raw/guest`, size: { width: 480, height: 1040 } } });
  const T0 = Date.now();
  await staffCtx.addInitScript(overlay(T0));
  await guestCtx.addInitScript(overlay(T0));
  const staff = await staffCtx.newPage();
  const guest = await guestCtx.newPage();
  videoZero = T0;

  // wait helpers
  const orderCard = () => staff.locator('li[data-testid^="order-"]', { hasText: 'Table 7' }).first();
  const dlg = (p: Page) => p.getByRole('dialog');
  const addDish = async (name: string, times = 1) => {
    const btn = guest.getByRole('button', { name: `Add ${name}`, exact: true });
    await scrollTo(guest, btn);
    await tap(guest, btn, 500);
    for (let i = 1; i < times; i++) await tap(guest, guest.getByRole('button', { name: `Add one more ${name}` }), 450);
  };
  const guestChip = (name: string) => guest.getByRole('navigation', { name: 'Menu categories' }).getByRole('button', { name });

  try {
    // ---------------------------------------------------------------- 0. title
    await staff.setContent(card(`<div><p style="letter-spacing:.2em;font-size:14px;color:#fbbf24;font-weight:800">LIVE DEMO · REAL APP, REAL DATABASE</p><h1 style="font-size:64px;margin:12px 0">GoToMenu</h1><p style="font-size:24px;color:#cbd5e1;max-width:760px;margin:0 auto">QR ordering and table service for cafes and restaurants.<br>Left: the restaurant's staff tablet. Right: a guest's phone.</p></div>`));
    await guest.setContent(card(`<div><p style="font-size:44px;margin:0 0 8px">📱</p><h2 style="margin:0;font-size:26px">Guest's phone</h2><p style="color:#cbd5e1">No app. No login.</p></div>`));
    say('GoToMenu demo. Left: the restaurant staff tablet. Right: a guest at Table 7 on their own phone.');
    await sleep(5500);

    // ---------------------------------------------------------------- 1. staff sign in
    say('STAFF - The waiter signs in with email and password (wrong details show one generic message).');
    await staff.goto(`${BASE}/login`);
    await typeInto(staff, staff.getByLabel('Email'), 'waiter@spice-garden.demo');
    await typeInto(staff, staff.getByLabel('Password'), PASSWORD);
    await tap(staff, staff.getByRole('button', { name: 'Sign in' }), 1500);
    await staff.getByRole('heading', { level: 1 }).waitFor();
    say('STAFF - The live board is empty. A banner asks for one tap to turn on sound alerts.');
    await sleep(2500);
    await tap(staff, staff.getByRole('button', { name: 'Enable sound' }), 1500);
    say('STAFF - Sound is on: a chime for new orders, a triple beep for waiter calls, a rising tone for bills. They repeat until handled.');
    await sleep(3000);

    // ---------------------------------------------------------------- 2. guest browses
    say('GUEST - Scans the QR on the table. The menu opens in the browser: no app, no sign-up. The table is already known.');
    await guest.goto(`${BASE}/spice-garden?k=${table.token}`);
    await guest.getByRole('heading', { level: 1 }).waitFor();
    await sleep(3500);
    say('GUEST - Veg / non-veg / egg / Jain marks, spice level, Bestseller and Chef\'s pick badges, prices in rupees.');
    await guest.evaluate(() => window.scrollTo({ top: 520, behavior: 'smooth' }));
    await sleep(2800);
    say('GUEST - The category bar sticks to the top and highlights as you scroll. Tap a category to jump.');
    await tap(guest, guestChip('Breads & Rice'), 1800);
    await tap(guest, guestChip('Desserts'), 1800);
    await tap(guest, guestChip('Starters'), 1500);
    await guest.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(900);
    say('GUEST - Search the menu...');
    await typeInto(guest, guest.getByLabel('Search the menu'), 'biryani');
    await sleep(1800);
    await guest.getByLabel('Search the menu').fill('');
    say('GUEST - ...or filter: Veg, Jain, Bestsellers.');
    await tap(guest, guest.getByRole('button', { name: 'Veg', exact: true }), 1500);
    await tap(guest, guest.getByRole('button', { name: 'Jain', exact: true }), 1700);
    await tap(guest, guest.getByRole('button', { name: 'Jain', exact: true }), 500);
    await tap(guest, guest.getByRole('button', { name: 'Bestsellers' }), 1700);
    await tap(guest, guest.getByRole('button', { name: 'Bestsellers' }), 600);
    await tap(guest, guest.getByRole('button', { name: 'Veg', exact: true }), 600);
    say('GUEST - A dish the kitchen has run out of is greyed out with "Sold out" and cannot be added.');
    await tap(guest, guestChip('Main Course (Veg)'), 1500);
    await scrollTo(guest, guest.getByRole('heading', { name: 'Chana Masala', level: 3 }));
    await sleep(2500);

    // ---------------------------------------------------------------- 3. guest builds the cart and orders
    say('GUEST - Adds dishes. Quantity steppers appear, and a cart bar shows the running total.');
    await addDish('Paneer Butter Masala', 2);
    await tap(guest, guestChip('Breads & Rice'), 1200);
    await addDish('Butter Naan', 2);
    await tap(guest, guestChip('Beverages'), 1200);
    await addDish('Sweet Lassi');
    await sleep(900);
    say('GUEST - The cart opens as a sheet: change quantities, add a note per dish and a note for the kitchen.');
    await tap(guest, guest.getByRole('button', { name: /View cart/ }), 1200);
    await tap(guest, dlg(guest).getByRole('button', { name: '+ Note for this dish' }).first(), 600);
    await typeInto(guest, dlg(guest).getByLabel('Note for this dish').first(), 'Less spicy, please');
    await typeInto(guest, dlg(guest).getByLabel('Note for the kitchen'), 'Serve the lassi first');
    await sleep(1500);
    say('GUEST - The price is always decided by the server, never by the phone. One big button places the order.');
    await tap(guest, dlg(guest).getByRole('button', { name: 'Place order' }), 800);
    await guest.getByRole('heading', { name: 'Your orders' }).waitFor();
    say('GUEST - Order sent. The status screen shows "Waiting for the team to accept".');
    await sleep(2500);

    // ---------------------------------------------------------------- 4. staff handles the order
    say('STAFF - The order appears on the board within seconds, with items, notes and a waiting timer. The tablet chimes.');
    await orderCard().waitFor({ timeout: 20000 });
    await sleep(4000);
    say('STAFF - Accept and start...');
    await tap(staff, orderCard().getByRole('button', { name: 'Accept & start' }), 500);
    await guest.getByText('Preparing').first().waitFor({ timeout: 15000 });
    say('GUEST - ...and the guest\'s phone updates live: "Preparing".');
    await sleep(3500);
    say('STAFF - Mark ready.');
    await tap(staff, orderCard().getByRole('button', { name: 'Mark ready' }), 500);
    await guest.locator('[aria-current="step"]', { hasText: 'Ready' }).waitFor({ timeout: 15000 });
    say('GUEST - "Ready". The guest knows food is coming.');
    await sleep(3000);
    say('STAFF - Mark served.');
    await tap(staff, orderCard().getByRole('button', { name: 'Mark served' }), 500);
    await guest.locator('[aria-current="step"]', { hasText: 'Served' }).waitFor({ timeout: 15000 });
    say('GUEST - "Served". The running table total is shown at the bottom.');
    await sleep(3500);

    // ---------------------------------------------------------------- 5. call waiter
    say('GUEST - Needs something? Tap "Call waiter" and pick a reason.');
    await tap(guest, guest.getByRole('button', { name: 'Call waiter' }), 900);
    await tap(guest, dlg(guest).getByRole('button', { name: 'Water' }), 1500);
    await dlg(guest).getByText('Waiter is on the way').first().waitFor();
    await sleep(1800);
    await tap(guest, dlg(guest).getByRole('button', { name: 'Close', exact: true }).last(), 600);
    say('STAFF - A "Waiter call" card appears in the Calls & bills area: Table 7 wants water. Tap Done when handled.');
    await staff.locator('[data-testid="request-waiter-7"]').waitFor({ timeout: 15000 });
    await sleep(4000);
    await tap(staff, staff.locator('[data-testid="request-waiter-7"]').getByRole('button', { name: 'Done' }), 1500);

    // ---------------------------------------------------------------- 6. bill
    say('GUEST - Ready to pay? "Ask for bill" - and choose how: Cash, UPI or Card.');
    await tap(guest, guest.getByRole('button', { name: 'Ask for bill' }), 900);
    await tap(guest, dlg(guest).getByRole('button', { name: 'UPI' }), 1500);
    await dlg(guest).getByText('The bill is on its way').waitFor();
    await sleep(1500);
    say('STAFF - The counter is told exactly what to bring: UPI means "Bring bill + payment QR".');
    await staff.locator('[data-testid="request-bill-7"]').getByText('Bring bill + payment QR').waitFor({ timeout: 15000 });
    await sleep(4000);
    say('GUEST - Changed their mind? The payment method can be changed while the request is open.');
    await tap(guest, dlg(guest).getByRole('button', { name: 'Change payment method' }), 700);
    await tap(guest, dlg(guest).getByRole('button', { name: 'Card' }), 1500);
    await guest.getByRole('dialog').getByText('Paying by Card').waitFor();
    await sleep(900);
    await tap(guest, dlg(guest).getByRole('button', { name: 'Close', exact: true }).last(), 500);
    say('STAFF - The card updates: "Bring bill + card machine". (Cash shows "Bring bill (cash payment)".)');
    await staff.locator('[data-testid="request-bill-7"]').getByText('Bring bill + card machine').waitFor({ timeout: 15000 });
    await sleep(4500);

    // ---------------------------------------------------------------- 7. mark paid
    await tap(staff, staff.locator('[data-testid="request-bill-7"]').getByRole('button', { name: 'Done' }), 1200);
    say('STAFF - After payment at the table: "Mark paid". It names the table and total and asks to confirm.');
    await scrollTo(staff, staff.locator('li[data-testid="table-7"]'));
    await tap(staff, staff.locator('li[data-testid="table-7"]').getByRole('button', { name: 'Mark paid' }), 1500);
    await dlg(staff).getByText('Mark Table 7 as paid?').waitFor();
    await sleep(2500);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Card' }), 1000);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Confirm paid' }), 800);
    say('GUEST - The phone shows a thank-you with the total, and one button to review the restaurant on Google.');
    await guest.getByRole('heading', { name: 'Thank you!' }).waitFor({ timeout: 15000 });
    await sleep(5500);

    // ---------------------------------------------------------------- 8. sold out
    say('STAFF - Sold-out list: any role can switch a dish off in two taps. Search, then tap the switch.');
    await tap(staff, staff.getByRole('tab', { name: 'Sold out' }), 1200);
    await typeInto(staff, staff.getByLabel('Search dishes'), 'paneer butter');
    await tap(staff, staff.getByRole('switch', { name: 'Paneer Butter Masala: available' }), 1500);
    say('GUEST - Back on the menu, the dish is now greyed out: guests can no longer order it.');
    await tap(guest, guest.getByRole('button', { name: 'Back to menu' }), 800);
    await guest.reload();
    await guest.getByRole('heading', { level: 1 }).waitFor();
    await tap(guest, guest.getByRole('button', { name: 'Back to menu' }), 900); // the paid table's thank-you shows again after a reload
    await tap(guest, guestChip('Main Course (Veg)'), 1200);
    await scrollTo(guest, guest.getByRole('heading', { name: 'Paneer Butter Masala', level: 3 }));
    await sleep(3500);
    await tap(staff, staff.getByRole('switch', { name: 'Paneer Butter Masala: sold out' }), 1500);
    await staff.getByLabel('Search dishes').fill('');
    await tap(staff, staff.getByRole('tab', { name: 'Live' }), 800);

    // ---------------------------------------------------------------- 9. cancel with reason
    say('GUEST - A new group at the same table starts a fresh bill. They order a Masala Chai.');
    await tap(guest, guestChip('Beverages'), 1200);
    await addDish('Masala Chai');
    await tap(guest, guest.getByRole('button', { name: /View cart/ }), 800);
    await tap(guest, dlg(guest).getByRole('button', { name: 'Place order' }), 800);
    await guest.getByRole('heading', { name: 'Your orders' }).waitFor();
    await orderCard().waitFor({ timeout: 20000 });
    say('STAFF - Cancelling needs a reason, and the guest is told. (The kitchen role cannot cancel at all.)');
    await sleep(2500);
    await tap(staff, orderCard().getByRole('button', { name: 'Cancel', exact: true }), 1000);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Sold out' }), 800);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Cancel order', exact: true }), 800);
    await guest.getByText('Cancelled').first().waitFor({ timeout: 15000 });
    say('GUEST - The phone shows "Cancelled" with the reason.');
    await sleep(3500);

    // ---------------------------------------------------------------- 10. late order colours
    say('GUEST - Another order is placed: Hara Bhara Kebab.');
    await tap(guest, guest.getByRole('button', { name: 'Add more items' }), 800);
    await tap(guest, guestChip('Starters'), 1200);
    await addDish('Hara Bhara Kebab');
    await tap(guest, guest.getByRole('button', { name: /View cart/ }), 800);
    await tap(guest, dlg(guest).getByRole('button', { name: 'Place order' }), 800);
    await orderCard().waitFor({ timeout: 20000 });
    say('STAFF - Waiting orders turn amber, then red. (Time is sped up here for the demo; limits are set per restaurant.)');
    await sleep(2500);
    await sql(`update public.orders set created_at = now() - interval '6 minutes' where status = 'placed' and table_id = (select id from public.dining_tables where qr_token = $1)`, [table.token]);
    await orderCard().getByText('Late', { exact: true }).waitFor({ timeout: 15000 });
    await sleep(3500);
    await sql(`update public.orders set created_at = now() - interval '11 minutes' where status = 'placed' and table_id = (select id from public.dining_tables where qr_token = $1)`, [table.token]);
    await orderCard().getByText('Very late').waitFor({ timeout: 15000 });
    await sleep(3500);
    await tap(staff, orderCard().getByRole('button', { name: 'Accept & start' }), 1500);

    // ---------------------------------------------------------------- 11. role difference (kitchen)
    say('STAFF - Different roles see different things. Signing out, then in as the KITCHEN...');
    await tap(staff, staff.getByRole('button', { name: 'Account' }), 1000);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Sign out', exact: true }), 1500);
    await staff.getByLabel('Email').waitFor();
    await typeInto(staff, staff.getByLabel('Email'), 'kitchen@spice-garden.demo');
    await typeInto(staff, staff.getByLabel('Password'), PASSWORD);
    await tap(staff, staff.getByRole('button', { name: 'Sign in' }), 1500);
    await staff.getByRole('heading', { level: 1 }).waitFor();
    say('STAFF (kitchen) - Orders only: no cancel, no bills, no payments. Owners and managers also get force-close.');
    await sleep(6000);
    await tap(staff, staff.getByRole('button', { name: 'Larger text' }), 1500);
    say('STAFF - Larger-text mode for noisy, busy kitchens. The screen also stays awake and can be installed on a tablet.');
    await sleep(4500);
    await tap(staff, staff.getByRole('button', { name: 'Larger text' }), 800);

    // ---------------------------------------------------------------- 12. owner dashboard
    const onCode = async (secret: string) => {
      await staff.getByLabel('6-digit code').waitFor();
      await typeInto(staff, staff.getByLabel('6-digit code'), totp(secret));
      await tap(staff, staff.getByRole('button', { name: 'Confirm' }), 1500);
    };
    const signInStaff = async (mail: string, pass: string) => {
      await staff.goto(`${BASE}/login`);
      await typeInto(staff, staff.getByLabel('Email'), mail);
      await typeInto(staff, staff.getByLabel('Password'), pass);
      await tap(staff, staff.getByRole('button', { name: 'Sign in' }), 1200);
    };
    say('OWNER - Now the restaurant owner. Signing out of the kitchen account and signing in as the OWNER.');
    await tap(staff, staff.getByRole('button', { name: 'Account' }), 800);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Sign out', exact: true }), 1500);
    await signInStaff('owner@spice-garden.demo', PASSWORD);
    say('OWNER - Owners, managers and the platform admin must also type a 6-digit code from an authenticator app. A stolen password alone is useless.');
    await sleep(3500);
    await onCode(DEMO_TOTP_SECRET);
    await staff.getByRole('heading', { level: 1 }).waitFor();
    await tap(staff, staff.getByRole('button', { name: 'Account' }), 800);
    await tap(staff, dlg(staff).getByRole('link', { name: 'Open dashboard' }), 1800);
    await staff.getByRole('heading', { level: 1, name: 'Menu' }).waitFor();
    say('OWNER DASHBOARD - Menu manager: categories, dishes, photos, prices, veg / non-veg / egg / Jain, spice, badges, availability.');
    await sleep(4500);
    say('OWNER - Adding a new dish: Cold Coffee, Rs 120, Beverages, Bestseller badge.');
    await tap(staff, staff.getByRole('button', { name: 'Add dish' }).first(), 900);
    await typeInto(staff, dlg(staff).getByLabel('Dish name'), 'Cold Coffee');
    await dlg(staff).getByLabel('Category').selectOption({ label: 'Beverages' });
    await typeInto(staff, dlg(staff).getByLabel('Price (₹)'), '120');
    await tap(staff, dlg(staff).getByLabel('Bestseller badge'), 600);
    await sleep(1200);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Save dish' }), 1500);
    await staff.getByText('Cold Coffee', { exact: true }).first().waitFor();
    say('GUEST - The guest\'s menu already shows the new dish after a refresh.');
    await guest.goto(`${BASE}/spice-garden?k=${table.token}`);
    await guest.getByRole('heading', { level: 1 }).waitFor();
    await tap(guest, guest.getByRole('button', { name: 'Back to menu' }), 600).catch(() => undefined);
    await tap(guest, guestChip('Beverages'), 1200);
    await scrollTo(guest, guest.getByRole('heading', { name: 'Cold Coffee', level: 3 }));
    await sleep(3500);
    say('OWNER - Out of coffee? One switch marks it sold out. The guest cannot order it.');
    await tap(staff, staff.locator('li', { has: staff.getByText('Cold Coffee', { exact: true }) }).getByRole('switch'), 1500);
    await guest.reload();
    await guest.getByRole('heading', { level: 1 }).waitFor();
    await tap(guest, guest.getByRole('button', { name: 'Back to menu' }), 600).catch(() => undefined);
    await tap(guest, guestChip('Beverages'), 1200);
    await scrollTo(guest, guest.getByRole('heading', { name: 'Cold Coffee', level: 3 }));
    await sleep(3000);
    say('OWNER - Bulk tools: select many dishes to change prices by a percentage or mark them sold out; drag or use arrows to reorder.');
    await staff.getByLabel('Select Cold Coffee').check();
    await sleep(1200);
    await tap(staff, staff.getByRole('button', { name: 'Change prices' }), 900);
    await typeInto(staff, dlg(staff).getByRole('textbox', { name: 'Percent' }), '10');
    await sleep(1500);
    await tap(staff, dlg(staff).getByRole('button', { name: /Apply to 1 dishes/ }), 1800);
    say('OWNER - Import a whole menu from Excel / Google Sheets as CSV. Every row is checked first, with row numbers; nothing changes unless all rows are right.');
    await tap(staff, staff.getByRole('button', { name: 'Import CSV' }), 900);
    const csv = 'category,name,description,price,diet,spice,bestseller,chef_pick,available\r\nBeverages,Mango Shake,Fresh mango,150,veg,0,no,no,yes\r\nBeverages,Broken Row,Oops,abc,veg,0,no,no,yes\r\n';
    await dlg(staff).getByLabel('Choose your CSV file').setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await sleep(5500);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Close' }).first(), 800);

    say('OWNER - Tables & QR: create tables 1 to N, switch off or rename, and make a new QR if one is leaked (the old code dies at once).');
    await tap(staff, staff.getByRole('link', { name: 'Tables & QR' }), 1800);
    await staff.getByRole('heading', { level: 1 }).waitFor();
    await sleep(4500);
    say('OWNER - Print-ready A4 table tents with the restaurant name and "Scan to order". The QR is drawn on the server.');
    await staff.goto(`${BASE}/dash/print?layout=tent`);
    await staff.getByText('Scan to order').first().waitFor();
    await sleep(5500);
    await staff.goto(`${BASE}/dash/print?layout=sheet`);
    await sleep(4500);

    say('OWNER - Staff accounts: add a waiter. A temporary password is shown once and must be changed at first sign-in. Only the owner can do this.');
    await staff.goto(`${BASE}/dash/staff`);
    await staff.getByRole('button', { name: 'Add staff member' }).waitFor();
    await sleep(2500);
    await tap(staff, staff.getByRole('button', { name: 'Add staff member' }), 800);
    await typeInto(staff, dlg(staff).getByLabel('Name'), 'Ravi');
    await typeInto(staff, dlg(staff).getByLabel(/Email/), 'ravi@spice-garden.demo');
    await tap(staff, dlg(staff).getByRole('button', { name: 'Create account' }), 1500);
    await sleep(4500);
    await tap(staff, dlg(staff).getByRole('button', { name: 'I have saved it' }), 900);
    await sleep(1500);

    say('OWNER - Settings: restaurant name, Google review link, accent colour and how long before an order turns amber or red.');
    await staff.goto(`${BASE}/dash/settings`);
    await staff.getByLabel('Restaurant name').waitFor();
    await sleep(2500);
    await tap(staff, staff.getByText('indigo', { exact: true }), 900);
    await tap(staff, staff.getByRole('button', { name: 'Save settings' }), 1500);
    say('GUEST - The guest menu now wears the restaurant\'s new colour.');
    await guest.reload();
    await guest.getByRole('heading', { level: 1 }).waitFor();
    await tap(guest, guest.getByRole('button', { name: 'Back to menu' }), 600).catch(() => undefined);
    await sleep(4000);
    await staff.getByText('saffron', { exact: true }).click();
    await tap(staff, staff.getByRole('button', { name: 'Save settings' }), 800);

    say('OWNER - Report: orders, average order value, top 10 dishes, busiest hours and review-button taps for today, 7 or 30 days.');
    await staff.goto(`${BASE}/dash/report`);
    await staff.getByRole('heading', { name: 'Top 10 dishes' }).waitFor();
    await sleep(3500);
    await tap(staff, staff.getByRole('button', { name: 'Last 7 days' }), 3500);
    say('OWNER - Activity log: who changed what, newest first. It cannot be edited or deleted by anyone.');
    await staff.goto(`${BASE}/dash/audit`);
    await staff.getByRole('heading', { name: 'Activity log' }).waitFor();
    await sleep(6000);
    await tap(staff, staff.getByRole('button', { name: 'Sign out' }), 1500);

    // ---------------------------------------------------------------- 13. platform admin
    await staff.getByLabel('Email').waitFor();
    say('PLATFORM ADMIN - This is the app owner\'s private panel. It always needs the authenticator code too.');
    await signInStaff('admin@gotomenu.demo', PASSWORD);
    await sleep(2500);
    await onCode(DEMO_TOTP_SECRET);
    await staff.getByRole('heading', { level: 1, name: 'Restaurants' }).waitFor();
    say('ADMIN - Every restaurant with its plan, paid-until date, last order and total orders.');
    await sleep(5000);
    say('ADMIN - Creating a new restaurant and its owner login: Chai Point.');
    await tap(staff, staff.getByRole('button', { name: 'Create restaurant' }), 900);
    await typeInto(staff, dlg(staff).getByLabel('Restaurant name'), 'Chai Point');
    await typeInto(staff, dlg(staff).getByLabel('Web address (after the domain)'), 'chai-point');
    await typeInto(staff, dlg(staff).getByLabel('Owner name'), 'Meera');
    await typeInto(staff, dlg(staff).getByLabel('Owner email'), 'owner@chai-point.demo');
    await tap(staff, dlg(staff).getByRole('button', { name: 'Create restaurant and owner login' }), 1500);
    const temp = ((await dlg(staff).getByTestId('temp-password').textContent()) ?? '').trim();
    say('ADMIN - The owner gets a one-time temporary password. It is shown once and never stored.');
    await sleep(5500);
    await tap(staff, dlg(staff).getByRole('button', { name: 'I have saved it' }), 900);

    say('ADMIN - Suspending a restaurant (for example, an unpaid month) blocks guest ordering and staff changes immediately.');
    const aroma = staff.getByTestId('restaurant-cafe-aroma');
    await tap(staff, aroma.getByRole('button', { name: /^Suspend/ }), 1500);
    await guest.goto(`${BASE}/cafe-aroma?k=${aromaTable.token}`);
    await guest.getByText('Ordering is paused').waitFor();
    say('GUEST - A guest at the suspended restaurant sees a friendly "Ordering is paused" message.');
    await sleep(4500);
    await tap(staff, aroma.getByRole('button', { name: /^Activate/ }), 1500);
    say('ADMIN - Plan and paid-until date, per-restaurant activity log, data export and permanent delete (type the address to confirm).');
    await tap(staff, aroma.getByRole('button', { name: /Plan and payment for/ }), 900);
    await sleep(3500);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Close' }).first(), 700);
    await tap(staff, aroma.getByRole('button', { name: /Activity log for/ }), 900);
    await sleep(4000);
    await tap(staff, dlg(staff).getByRole('button', { name: 'Close' }).first(), 700);
    await tap(staff, staff.getByRole('button', { name: 'Sign out' }), 1500);

    // ---------------------------------------------------------------- 14. the new owner's first sign-in
    await staff.getByLabel('Email').waitFor();
    say('NEW OWNER - Meera signs in for the first time with the temporary password...');
    await signInStaff('owner@chai-point.demo', temp);
    await staff.getByRole('heading', { name: 'Choose your password' }).waitFor();
    say('NEW OWNER - ...and cannot do anything until she chooses her own password.');
    await sleep(3000);
    const newPass = 'Chai-Point-Owner-2025!';
    await typeInto(staff, staff.getByLabel('New password', { exact: true }), newPass);
    await typeInto(staff, staff.getByLabel('Type it again'), newPass);
    await tap(staff, staff.getByRole('button', { name: 'Save password' }), 1500);
    await staff.getByRole('heading', { name: 'Two-step sign-in' }).waitFor();
    say('NEW OWNER - Next she must set up an authenticator app: scan the QR picture (or type the key) and enter the 6-digit code.');
    await tap(staff, staff.getByRole('button', { name: 'Set up authenticator app' }), 1500);
    const secret = ((await staff.getByTestId('mfa-secret').textContent()) ?? '').trim();
    await sleep(5000);
    await onCode(secret);
    await staff.getByRole('heading', { level: 1 }).waitFor();
    say('NEW OWNER - She is in. Her new restaurant is empty, ready for her menu.');
    await tap(staff, staff.getByRole('button', { name: 'Account' }), 800);
    await tap(staff, dlg(staff).getByRole('link', { name: 'Open dashboard' }), 1800);
    await staff.getByText('Your menu is empty').waitFor();
    await sleep(5000);

    // ---------------------------------------------------------------- 15. end card
    say('That is everything built so far: guest ordering, staff screen, owner dashboard and platform admin.');
    await staff.setContent(card(`<div style="max-width:1000px"><h1 style="font-size:42px;margin:0 0 22px">Built and tested</h1>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;text-align:left;font-size:18px;line-height:1.5">
        <div style="background:#052e1b;border:2px solid #10b981;border-radius:16px;padding:20px"><b style="color:#6ee7b7;font-size:14px;letter-spacing:.12em">DONE (PHASES 1 TO 5)</b><br>✓ Guest menu, cart, order, live status, bill, review<br>✓ Staff live board, alert sounds, roles, sold-out<br>✓ Owner dashboard: menu, photos, CSV, tables and QR print<br>✓ Staff accounts, settings, report, activity log<br>✓ Platform admin: restaurants, plans, suspend, export, delete<br>✓ Two-step sign-in for owners, managers and admin<br>✓ Security tests, threat model, audit log</div>
        <div style="background:#1e1b4b;border:2px solid #818cf8;border-radius:16px;padding:20px"><b style="color:#c7d2fe;font-size:14px;letter-spacing:.12em">NEXT: PHASE 6 AND LAUNCH</b><br>Staging on the real Supabase and Vercel<br>Load test with 300 guests, speed budget<br>Backups and restore test<br>Runbook and deployment guide<br>Your approval, then production at gotomenu.taprizz.in<br><br><b>Later (only if you ask):</b> payments, GST bills, WhatsApp, ratings</div></div></div>`));
    await guest.setContent(card(`<div><h2 style="font-size:28px;margin:0 0 8px">Thank you</h2><p style="color:#cbd5e1">Scan. Order. Enjoy.</p></div>`));
    await sleep(9000);
  } finally {
    const staffVideo = staff.video();
    const guestVideo = guest.video();
    await staffCtx.close();
    await guestCtx.close();
    await browser.close();
    await pool.end();
    const sp = await staffVideo!.path();
    const gp = await guestVideo!.path();
    writeFileSync(`${OUT}/cues.json`, JSON.stringify({ cues, staff: sp, guest: gp }, null, 2));
  }
  compose();
}

// ---------------------------------------------------------------- compose: two screens + captions band -> one mp4
/** Decodes the in-page clock strip from the recording: for every half second of video, which script time the screen shows. */
function readClock(videoFile: string): { video: number; page: number }[] {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', videoFile, '-vf', 'fps=2,crop=110:10:0:0,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const buf = r.stdout;
  const out: { video: number; page: number }[] = [];
  let last = -1;
  for (let f = 0; f * 1100 < buf.length; f++) {
    let v = 0;
    for (let i = 0; i < 11; i++) v = (v << 1) | (buf[f * 1100 + 5 * 110 + 10 * i + 5]! > 128 ? 1 : 0);
    const page = v / 2;
    if (page > last && (last < 0 || page - last < 30)) { out.push({ video: f / 2, page }); last = page; } // ignore frames without a readable clock
  }
  return out;
}

/** Breaks a long caption into at most two lines so it never runs off the screen. */
function wrap(text: string, width = 78): string {
  if (text.length <= width) return text;
  const cut = text.lastIndexOf(' ', Math.min(width, Math.ceil(text.length / 2) + 12));
  return `${text.slice(0, cut)}\n${text.slice(cut + 1)}`;
}

function compose() {
  const { cues: list, staff, guest } = JSON.parse(readFileSync(`${OUT}/cues.json`, 'utf8')) as { cues: { t: number; text: string }[]; staff: string; guest: string };
  const dur = (f: string) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim());
  const total = Math.min(dur(staff), dur(guest));
  const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const fontOpt = existsSync(font) ? `fontfile=${font}:` : '';
  const clockMap = readClock(staff);
  const toVideo = (t: number): number => {
    // first moment the recording shows a page clock at or after t (the screen can only be behind the script, never ahead)
    const hit = clockMap.find((m) => m.page >= t);
    return hit ? hit.video : t;
  };
  const filters: string[] = [
    'color=c=0x0f172a:s=1920x1080[bg]',
    '[0:v]crop=iw:ih-10:0:10,scale=-2:880,setsar=1[s]',
    '[1:v]crop=iw:ih-10:0:10,scale=-2:880,setsar=1[g]',
    '[bg][s]overlay=70:110:shortest=1[t1]',
    '[t1][g]overlay=1444:110:shortest=1[t2]',
  ];
  let chain = '[t2]';
  const draw = (label: string, extra: string) => {
    filters.push(`${chain}drawtext=${fontOpt}${extra}[${label}]`);
    chain = `[${label}]`;
  };
  draw('h1', `text='GoToMenu  |  live demo':fontsize=40:fontcolor=white:x=70:y=30`);
  draw('h2', `text='RESTAURANT STAFF / OWNER / ADMIN SCREEN':fontsize=22:fontcolor=0xfbbf24:x=70:y=78`);
  draw('h3', `text='GUEST PHONE':fontsize=22:fontcolor=0xfbbf24:x=1444:y=78`);
  list.forEach((c, i) => {
    const startV = toVideo(c.t);
    const end = Math.min(list[i + 1] ? toVideo(list[i + 1]!.t) : total, total);
    if (startV >= total) return;
    writeFileSync(`${OUT}/cue-${i}.txt`, wrap(c.text));
    draw(`c${i}`, `textfile=${OUT}/cue-${i}.txt:fontsize=30:fontcolor=white:box=1:boxcolor=0x1e293b@0.95:boxborderw=14:line_spacing=6:x=(w-text_w)/2:y=${c.text.length > 78 ? 972 : 1008}:enable='between(t,${(startV + 0.1).toFixed(2)},${end.toFixed(2)})'`);
  });
  writeFileSync(`${OUT}/filter.txt`, filters.join(';\n').replace(`${chain}`, chain) );
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', staff, '-i', guest, '-filter_complex_script', `${OUT}/filter.txt`, '-map', chain, '-t', String(total), '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/GoToMenu-demo.mp4`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
  console.log(`done: ${OUT}/GoToMenu-demo.mp4 (${total.toFixed(0)} s)`);
}

main().catch((e) => {
  console.error(e);
  stopAll();
  process.exit(1);
});
