import type { Metadata } from 'next';
import { PadGuestApp } from '@/components/padharosaa/PadGuestApp';
import { publicEnv } from '@/env';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Padharosaa', robots: { index: false, follow: false }, referrer: 'no-referrer' };

// The QR code opens /padharosaa/<hotel>?k=<key>. The page itself holds no hotel data: the app asks the API, which checks the key.
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string; r?: string }> }) {
  const [{ slug }, { k, r }] = await Promise.all([params, searchParams]);
  const room = typeof r === 'string' && /^[A-Za-z0-9][A-Za-z0-9 -]{0,9}$/.test(r) ? r.toUpperCase() : null; // a room QR opens with the room filled in
  const imageBase = `${publicEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/menu-images/`;
  return <PadGuestApp slug={slug} qrKey={typeof k === 'string' ? k : null} room={room} imageBase={imageBase} />;
}
