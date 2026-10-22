import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, type World } from '../../supabase/tests/helpers/fixtures';
import { APP, state } from './helpers';
import { dispatchDue, sendWhatsApp } from '@/lib/padharosaa/notify';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
import { GET as cronGET } from '@/app/api/padharosaa/v1/cron/notify/route';

let db: TestDb;
let w: World;
const cfg = { token: 'EAAB-test-token-test-token-123', phoneId: '1234567890', template: 'padharosaa_help_alert', lang: 'en' };
beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
  await db.admin(`insert into public.staff_profiles (user_id, restaurant_id, department, whatsapp, is_head) values ($1,$2,'front_desk','+919876500001',true)`, [w.A.waiter, w.A.rid]);
});
afterAll(async () => db.close());
const queue = (key: string) => db.admin(`insert into public.notifications (restaurant_id, channel, to_ref, template, payload, dedupe_key) values ($1,'whatsapp',$2,'help_alert','{"room":"204","label":"AC\\nbroken","urgent":true}',$3)`, [w.A.rid, w.A.waiter, key]);

describe('whatsapp outbox worker', () => {
  it('sends a template message with sanitised parameters and marks it sent', async () => {
    await queue('n1');
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    const r = await dispatchDue(cfg, f as unknown as typeof fetch);
    expect(r).toEqual({ claimed: 1, sent: 1, retried: 0, suppressed: 0 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v20.0/1234567890/messages');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${cfg.token}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ to: '919876500001', type: 'template', template: { name: 'padharosaa_help_alert' } });
    expect(body.template.components[0].parameters.map((p: any) => p.text)).toEqual(['204', 'AC broken', 'URGENT']);
    expect((await db.admin<any>(`select status from public.notifications where dedupe_key = 'n1'`))[0].status).toBe('sent');
  });

  it('a failing provider queues a retry; with no WhatsApp configured nothing is claimed or burnt', async () => {
    await queue('n2');
    expect(await dispatchDue(null)).toEqual({ claimed: 0, sent: 0, retried: 0, suppressed: 0 });
    expect((await db.admin<any>(`select attempts from public.notifications where dedupe_key = 'n2'`))[0].attempts).toBe(0);
    const bad = vi.fn(async () => new Response('no', { status: 500 }));
    expect(await dispatchDue(cfg, bad as unknown as typeof fetch)).toMatchObject({ claimed: 1, sent: 0, retried: 1 });
    expect((await db.admin<any>(`select status, attempts, last_error from public.notifications where dedupe_key = 'n2'`))[0]).toEqual({ status: 'queued', attempts: 1, last_error: 'http_500' });
    const down = vi.fn(async () => { throw new Error('offline'); });
    expect((await sendWhatsApp(cfg, '+919876500001', { id: 'x', template: 't', payload: {}, attempts: 1, to: '+91' }, down as unknown as typeof fetch)).error).toBe('network');
  });

  it('the cron route needs the shared secret', async () => {
    const mkReq = (auth?: string) => new Request(`${APP}/api/padharosaa/v1/cron/notify`, { headers: auth ? { authorization: auth } : {} });
    expect((await cronGET(mkReq())).status).toBe(401);
    expect((await cronGET(mkReq('Bearer wrong'))).status).toBe(401);
    expect((await cronGET(mkReq('Bearer cron-secret-cron-secret-cron-secret'))).status).toBe(200);
  });
});
