import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, type World } from '../../supabase/tests/helpers/fixtures';
import { authState, req, state } from './helpers';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
vi.mock('@/lib/supabase/server', async () => {
  const h = await import('./helpers');
  return { userClient: async () => h.fakeUserClient };
});
import { GET, POST } from '@/app/api/padharosaa/v1/staff/wifi-vouchers/route';

// The owner pastes the hotel's Wi-Fi logins; the password is encrypted before it reaches the database.
let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.A.rid]);
});
afterAll(async () => db.close());
beforeEach(() => { authState.userId = null; });
const json = async (r: Response) => (await r.json()) as Record<string, any>;

describe('Wi-Fi logins API', () => {
  it('the owner adds logins, the password is stored encrypted, the count follows; reception is refused; junk is refused', async () => {
    authState.userId = w.A.waiter;
    expect((await POST(req('/x', { items: [{ username: '1', password: 'a' }] }))).status).toBe(403);
    authState.userId = w.A.owner;
    const r = await POST(req('/x', { items: [{ username: '70012', password: 'JHWS' }, { username: '70013', password: 'KPLM' }] }));
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ added: 2, skipped: 0 });
    expect(await json(await GET(req('/x')))).toEqual({ free: 2, given: 0 });
    const stored = (await db.admin<{ password_enc: Buffer }>(`select password_enc from public.wifi_vouchers where username = '70012'`))[0]!.password_enc;
    expect(stored.toString('utf8')).not.toContain('JHWS');
    expect((await POST(req('/x', { items: [] }))).status).toBe(400);
    expect((await POST(req('/x', { items: [{ username: '', password: 'x' }] }))).status).toBe(400);
    expect((await POST(req('/x', { nope: true }))).status).toBe(400);
  });
});
