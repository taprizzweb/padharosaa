import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverEnv } from '@/env';
import { runBuffetReminders } from '@/lib/padharosaa/push';
import { dispatchDue } from '@/lib/padharosaa/notify';

export const dynamic = 'force-dynamic';

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Outbox worker. Call every minute with `Authorization: Bearer $CRON_SECRET` (Vercel Cron does this by itself when CRON_SECRET is set).
export async function GET(req: Request) {
  const env = serverEnv();
  const got = req.headers.get('authorization') ?? '';
  if (!env.CRON_SECRET || !safeEq(got, `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: { key: 'unauthorized' } }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const cfg = env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID ? { token: env.WHATSAPP_TOKEN, phoneId: env.WHATSAPP_PHONE_ID, template: env.WHATSAPP_HELP_TEMPLATE, lang: env.WHATSAPP_TEMPLATE_LANG } : null;
  const sent = await dispatchDue(cfg);
  const buffetReminders = await runBuffetReminders();
  return NextResponse.json({ ...sent, buffetReminders }, { headers: { 'cache-control': 'no-store' } });
}
