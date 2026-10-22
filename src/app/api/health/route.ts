import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Used by uptime monitors. Reveals nothing beyond "up/down".
export async function GET() {
  try {
    const { error } = await adminClient().rpc('guest_health');
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
