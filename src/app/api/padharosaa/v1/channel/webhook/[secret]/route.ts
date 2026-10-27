import { NextResponse } from 'next/server';
import { limit, rpc } from '@/lib/guest/rpc';
import { pullHotel } from '@/lib/padharosaa/channels';
import { later } from '@/lib/padharosaa/push';

export const dynamic = 'force-dynamic';

// The channel service calls this when a booking changes. The address holds a long secret that only that hotel's console shows. What the call says is
// never trusted: it only makes us ask the service for the booking feed, so a forged call can do nothing but cause one harmless look.
export async function POST(_req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const res = (status: number) => NextResponse.json({ ok: status === 200 }, { status, headers: { 'cache-control': 'no-store' } });
  if (!/^[0-9a-f]{64}$/.test(secret)) return res(404);
  try { await limit(`chw:${secret.slice(0, 16)}`, 120, 60); } catch { return res(429); }
  const link = await rpc<{ restaurant_id: string; property_id: string } | null>('padh_channel_by_secret', { p_secret: secret }).catch(() => null);
  if (!link) return res(404);
  later(() => pullHotel(link.restaurant_id, link.property_id));
  return res(200);
}
