import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { checkinBody, staysQuery } from '@/lib/padharosaa/schemas';
import { kickChannels } from '@/lib/padharosaa/channels';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Guests in the hotel now (or the last 30 checked out), with each bill's balance.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    const q = staysQuery.safeParse({ status: new URL(req.url).searchParams.get('status') ?? 'in_house' });
    if (!q.success) throw new ApiError(400, 'invalid_input');
    await limit(`pbl:${ctx.userId}`, 120, 60);
    return jsonOk({ stays: await staffRpc(ctx.db, 'padh_stays_list', { p_status: q.data.status }) }, ctx.requestId);
  });
}

// Check a guest in: the stay, the first payment (advance) and a 4-digit stay code for the guest app, in one step.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: checkinBody }, async (ctx, b) => {
    await limit(`psc:${ctx.userId}`, 60, 60);
    const out = await staffRpc(ctx.db, 'padh_stay_checkin', {
      p_room: b.room, p_guest: b.guest, p_mobile: b.mobile ?? null, p_id_type: b.id_type ?? null, p_id_tail: b.id_last4 ?? null, p_adults: b.adults, p_company: b.company ?? null,
      p_gstin: b.gstin ?? null, p_inter_state: b.inter_state ?? null, p_address: b.address ?? null, p_rate_paise: b.rate_paise ?? null, p_out_on: b.out_on,
      p_advance_paise: b.advance_paise, p_advance_mode: b.advance_mode ?? null,
    });
    // the time the guest really arrived, when the desk set one
    if (b.in_time) await staffRpc(ctx.db, 'padh_stay_set_checkin', { p_stay: (out as { stay_id: string }).stay_id, p_time: b.in_time });
    kickChannels(); // a room is taken: tell the booking sites soon
    return jsonOk(out, ctx.requestId);
  });
}
