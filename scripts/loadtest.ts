/**
 * Load test for a hotel of N rooms against the REAL app, running on the local dev stack (scripts/dev-stack.ts + scripts/start-app-local.sh).
 * It measures the app and its SQL under a busy evening: many guests with the page open (each polls like the real page does), guests sending
 * requests, and a few reception desks polling and answering. It does NOT measure Supabase's own limits (plan, connection pool) or Vercel.
 *
 *   tsx scripts/loadtest.ts --rooms 900 --active 0.4 --seconds 120 [--history 8]
 *
 *   rooms     rooms in the hotel (150 / 900)
 *   active    share of rooms with a guest whose page is open right now (0.4 = 40%)
 *   seconds   how long the busy period lasts
 *   history   old requests per room already in the database (weeks of use)
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const ROOMS = Number(arg('rooms', '150'));
const ACTIVE = Number(arg('active', '0.4'));
const SECONDS = Number(arg('seconds', '90'));
const HISTORY = Number(arg('history', '8'));
const DESKS = Number(arg('desks', '3'));
const APP = process.env.LOAD_APP ?? 'http://localhost:3100';
const info = JSON.parse(readFileSync(process.env.DEV_STACK_INFO ?? '/tmp/gotomenu-dev-stack.json', 'utf8')) as { db: string };
const base = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://gm_test:gm_test@127.0.0.1:5432/postgres');
base.pathname = `/${info.db}`;
const pool = new Pool({ connectionString: base.toString(), max: 10 });
const sha = (s: string) => createHash('sha256').update(s).digest();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms * (0.7 + Math.random() * 0.6);

type Json = { requests?: { id: string; status: string; version: number }[] };
interface Stat { n: number; err: number; limited: number; ms: number[] }
const stats = new Map<string, Stat>();
function rec(name: string, status: number, ms: number) {
  const s = stats.get(name) ?? { n: 0, err: 0, limited: 0, ms: [] };
  s.n++; s.ms.push(ms);
  if (status === 429) s.limited++; else if (status >= 400 || status === 0) s.err++;
  stats.set(name, s);
}
async function hit(name: string, url: string, init: RequestInit = {}): Promise<{ status: number; json: Json | null }> {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    rec(name, r.status, performance.now() - t);
    let json: Json | null = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json };
  } catch {
    rec(name, 0, performance.now() - t);
    return { status: 0, json: null };
  }
}
const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; };

async function setup() {
  const [{ id: rid }] = (await pool.query(`select id from public.restaurants where slug = 'spice-garden'`)).rows;
  await pool.query(`delete from public.guest_sessions where restaurant_id = $1`, [rid]);
  await pool.query(`delete from public.requests where restaurant_id = $1`, [rid]);
  await pool.query(`delete from public.rooms where restaurant_id = $1`, [rid]);
  await pool.query(`delete from public.hotel_settings where restaurant_id = $1`, [rid]);
  const admin = (await pool.query(`select user_id from public.platform_admins limit 1`)).rows[0].user_id;
  await pool.query(`select public.padh_admin_enable_hotel($1, $2, 'Asia/Kolkata')`, [admin, rid]);
  const nums = Array.from({ length: ROOMS }, (_, i) => String(101 + Math.floor(i / 30) * 100 + (i % 30)));
  await pool.query(`insert into public.rooms (restaurant_id, number) select $1, unnest($2::text[])`, [rid, nums]);
  const rooms = (await pool.query(`select id, number from public.rooms where restaurant_id = $1 order by number`, [rid])).rows as { id: string; number: string }[];
  const tokens: string[] = [];
  const vals: unknown[] = [];
  const ph: string[] = [];
  rooms.forEach((r, i) => {
    const tok = randomBytes(32).toString('base64url');
    tokens.push(tok);
    vals.push(rid, r.id, `Guest ${i + 1}`, Buffer.from('x'), sha(`m${i}`), sha(tok));
    ph.push(`($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},'+91',$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6},'active')`);
  });
  for (let off = 0; off < rooms.length; off += 300) {
    const slice = ph.slice(off, off + 300).map((_, k) => { const b = k * 6; return `($${b + 1},$${b + 2},$${b + 3},'+91',$${b + 4},$${b + 5},$${b + 6},'active')`; });
    await pool.query(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ${slice.join(',')}`, vals.slice(off * 6, (off + 300) * 6));
  }
  // weeks of history: old, finished requests, so the lists and indexes are tested at the size they will really have
  const sess = (await pool.query(`select id, room_id from public.guest_sessions where restaurant_id = $1`, [rid])).rows;
  const t0 = Date.now();
  for (let i = 0; i < ROOMS * HISTORY; i += 500) {
    const n = Math.min(500, ROOMS * HISTORY - i);
    await pool.query(
      `insert into public.requests (restaurant_id, session_id, room_id, type, team, label, status, completed_at, created_at, idempotency_key)
       select $1, s.id, s.room_id, 'housekeeping', 'housekeeping', 'Old towels ' || g, 'completed', now() - interval '3 days', now() - (g || ' hours')::interval, gen_random_uuid()::text
         from generate_series(1, $2) g, lateral (select id, room_id from public.guest_sessions where restaurant_id = $1 offset (g % $3) limit 1) s`,
      [rid, n, sess.length],
    ).catch((e) => { if (i === 0) console.log('history insert skipped:', (e as Error).message); });
  }
  const have = (await pool.query(`select count(*)::int n from public.requests where restaurant_id = $1`, [rid])).rows[0].n;
  console.log(`setup: ${ROOMS} rooms, ${sess.length} guest sessions, ${have} old requests in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { rid, tokens };
}

async function desk(i: number, until: number) {
  const login = await fetch(`${APP}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: APP, 'x-forwarded-for': `10.0.0.${i + 1}` }, body: JSON.stringify({ email: 'waiter@spice-garden.demo', password: 'DemoPass#2025!' }) });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!login.ok || !cookie) { console.log('desk login failed', login.status); return; }
  const h = { cookie, origin: APP };
  while (Date.now() < until) {
    const [b] = await Promise.all([
      hit('desk board', `${APP}/api/padharosaa/v1/staff/board`, { headers: h }),
      hit('desk alerts', `${APP}/api/padharosaa/v1/staff/alerts`, { headers: h }),
      hit('desk food board', `${APP}/api/staff/board`, { headers: h }),
    ]);
    const open = (b.json?.requests ?? []).filter((r) => r.status === 'received').slice(0, 2);
    for (const r of open) {
      const a = await hit('desk accept', `${APP}/api/padharosaa/v1/staff/requests/${r.id}/accept`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ version: r.version }) });
      if (a.status === 200) await hit('desk complete', `${APP}/api/padharosaa/v1/staff/requests/${r.id}/complete`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ version: r.version + 1 }) });
    }
    await sleep(jitter(4000));
  }
}

async function guest(token: string, until: number) {
  const h = { cookie: `padh_sid=${token}`, origin: APP };
  await sleep(Math.random() * 8000); // guests open the page at different moments
  await hit('guest home', `${APP}/api/padharosaa/v1/home`, { headers: h });
  let nextHours = Date.now(), nextHome = Date.now() + jitter(60_000), nextSend = Date.now() + jitter(150_000 + Math.random() * 150_000);
  while (Date.now() < until) {
    await hit('guest my requests', `${APP}/api/padharosaa/v1/requests`, { headers: h });
    if (Date.now() >= nextHours) { await hit('guest hours', `${APP}/api/padharosaa/v1/hours`, { headers: h }); nextHours = Date.now() + 60_000; }
    if (Date.now() >= nextHome) { await hit('guest home', `${APP}/api/padharosaa/v1/home`, { headers: h }); nextHome = Date.now() + jitter(60_000); }
    if (Date.now() >= nextSend) {
      await hit('guest send request', `${APP}/api/padharosaa/v1/requests`, { method: 'POST', headers: { ...h, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ type: 'housekeeping', label: `Housekeeping: Towels ${Math.floor(Math.random() * 1e6)}`, urgent: Math.random() < 0.1 }) });
      nextSend = Date.now() + jitter(240_000);
    }
    await sleep(jitter(6000)); // the page refreshes its list about every 6 seconds
  }
}

async function main() {
  console.log(`== ${ROOMS} rooms, ${Math.round(ACTIVE * 100)}% with the page open, ${DESKS} desks, ${SECONDS}s against ${APP}`);
  const { tokens } = await setup();
  const activeN = Math.max(1, Math.round(ROOMS * ACTIVE));
  const until = Date.now() + SECONDS * 1000;
  const t0 = Date.now();
  await Promise.all([...Array.from({ length: DESKS }, (_, i) => desk(i, until)), ...tokens.slice(0, activeN).map((t) => guest(t, until))]);
  const secs = (Date.now() - t0) / 1000;
  console.log(`\n${activeN} guests + ${DESKS} desks, ${secs.toFixed(0)}s`);
  console.log('endpoint'.padEnd(22), 'calls'.padStart(7), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'p99 ms'.padStart(8), 'errors'.padStart(7), '429'.padStart(5));
  let total = 0, bad = 0;
  for (const [name, s] of [...stats.entries()].sort()) {
    total += s.n; bad += s.err;
    console.log(name.padEnd(22), String(s.n).padStart(7), pct(s.ms, 50).toFixed(0).padStart(8), pct(s.ms, 95).toFixed(0).padStart(8), pct(s.ms, 99).toFixed(0).padStart(8), String(s.err).padStart(7), String(s.limited).padStart(5));
  }
  console.log(`total ${total} calls (${(total / secs).toFixed(1)}/s), ${bad} errors`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
