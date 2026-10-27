import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodTypeAny } from 'zod';
import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { chartQuery, hkBody, rateOnQuery, ratesQuery, ratesSetBody, reservationBody, reservationCheckinBody, reservationCloseBody, reservationsQuery, searchQuery } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- each entry below is checked by its own zod schema
const POSTS: Record<string, { schema: ZodTypeAny; run: (db: SupabaseClient, b: Body) => Promise<unknown> }> = {
  reservation: { schema: reservationBody, run: (db, b) => staffRpc(db, 'padh_reservation_save', {
    p_id: b.id ?? null, p_room: b.room ?? null, p_type: b.type ?? null, p_guest: b.guest, p_mobile: b.mobile ?? null, p_adults: b.adults, p_in: b.check_in, p_out: b.check_out,
    p_rate_paise: b.rate_paise ?? null, p_advance_paise: b.advance_paise, p_advance_mode: b.advance_mode ?? null, p_source: b.source ?? null, p_notes: b.notes ?? null }) },
  'reservation-close': { schema: reservationCloseBody, run: (db, b) => staffRpc(db, 'padh_reservation_close', { p_id: b.id, p_status: b.status, p_reason: b.reason ?? null }) },
  'reservation-checkin': { schema: reservationCheckinBody, run: (db, b) => staffRpc(db, 'padh_reservation_checkin', {
    p_id: b.id, p_room: b.room ?? null, p_id_type: b.id_type ?? null, p_id_tail: b.id_last4 ?? null, p_company: b.company ?? null, p_gstin: b.gstin ?? null, p_address: b.address ?? null }) },
  rates: { schema: ratesSetBody, run: (db, b) => staffRpc(db, 'padh_rates_set', { p_type: b.type, p_from: b.from, p_to: b.to, p_rate: b.rate_paise ?? null, p_stop: b.stop_sell ?? null, p_min: b.min_stay ?? null, p_weekdays: b.weekdays?.length ? b.weekdays.join(',') : null, p_reset: b.reset }) },
  housekeeping: { schema: hkBody, run: (db, b) => staffRpc(db, 'padh_room_hk_set', { p_room: b.room, p_status: b.status, p_note: b.note ?? null }) },
};

// Front office reads: the room chart, the reservation lists and the top-bar search. The database lets only the front office through.
export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    await limit(`pfo:${ctx.userId}`, 240, 60);
    if (action === 'chart') {
      const q = chartQuery.safeParse({ from: sp.from || null, days: sp.days ?? 14 });
      if (!q.success) throw new ApiError(400, 'invalid_input');
      return jsonOk(await staffRpc(ctx.db, 'padh_room_chart', { p_from: q.data.from ?? null, p_days: q.data.days }), ctx.requestId);
    }
    if (action === 'reservations') {
      const q = reservationsQuery.safeParse(sp);
      if (!q.success) throw new ApiError(400, 'invalid_input');
      return jsonOk({ reservations: await staffRpc(ctx.db, 'padh_reservations_list', { p_scope: q.data.scope }) }, ctx.requestId);
    }
    if (action === 'rates') {
      const q = ratesQuery.safeParse({ type: sp.type, from: sp.from || null, days: sp.days ?? 31 });
      if (!q.success) throw new ApiError(400, 'invalid_input');
      return jsonOk(await staffRpc(ctx.db, 'padh_rates_get', { p_type: q.data.type, p_from: q.data.from ?? null, p_days: q.data.days }), ctx.requestId);
    }
    if (action === 'rate-on') {
      const q = rateOnQuery.safeParse(sp);
      if (!q.success) throw new ApiError(400, 'invalid_input');
      return jsonOk(await staffRpc(ctx.db, 'padh_rate_on', { p_type: q.data.type, p_day: q.data.day }), ctx.requestId);
    }
    if (action === 'search') {
      const q = searchQuery.safeParse(sp);
      if (!q.success) return jsonOk({ results: [] }, ctx.requestId);
      return jsonOk({ results: await staffRpc(ctx.db, 'padh_search', { p_q: q.data.q }) }, ctx.requestId);
    }
    throw new ApiError(404, 'not_found');
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const def = Object.hasOwn(POSTS, action) ? POSTS[action] : undefined;
  return staffRoute(req, { method: 'POST', schema: def?.schema }, async (ctx, body) => {
    if (!def) throw new ApiError(404, 'not_found');
    await limit(`pfw:${ctx.userId}`, 120, 60);
    return jsonOk(await def.run(ctx.db, (body ?? {}) as Body), ctx.requestId);
  });
}
