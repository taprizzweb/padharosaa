import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodTypeAny } from 'zod';
import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { categoryBody, extraBody, legalBody, roomSetTypeBody, roomTypeBody, slabsBody, taxRateBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- each entry below is checked by its own zod schema
const ACTIONS: Record<string, { schema?: ZodTypeAny; run: (db: SupabaseClient, b: Body) => Promise<unknown> }> = {
  'tax-rate': { schema: taxRateBody, run: (db, b) => staffRpc(db, 'padh_tax_rate_save', { p_id: b.id ?? null, p_name: b.name, p_rate_bp: b.rate_bp, p_active: b.active }) },
  'tax-presets': { run: (db) => staffRpc(db, 'padh_tax_presets_add') },
  category: { schema: categoryBody, run: (db, b) => staffRpc(db, 'padh_category_save', { p_id: b.id ?? null, p_name: b.name, p_sac: b.sac ?? null, p_tax_rate: b.tax_rate_id ?? null, p_active: b.active }) },
  slabs: { schema: slabsBody, run: (db, b) => staffRpc(db, 'padh_slabs_set', { p_items: JSON.stringify(b.items) }) },
  extra: { schema: extraBody, run: (db, b) => staffRpc(db, 'padh_extra_save', { p_id: b.id ?? null, p_name: b.name, p_mode: b.mode, p_value: b.value, p_applies: b.applies_to, p_tax_rate: b.tax_rate_id ?? null, p_active: b.active }) },
  legal: { schema: legalBody, run: (db, b) => staffRpc(db, 'padh_legal_set', { p_legal_name: b.legal_name ?? null, p_gstin: b.gstin ?? null, p_address: b.address ?? null, p_prefix: b.prefix, p_terms: b.terms ?? null, p_round_off: b.round_off }) },
  'room-type': { schema: roomTypeBody, run: (db, b) => staffRpc(db, 'padh_room_type_save', { p_id: b.id ?? null, p_name: b.name, p_rate_paise: b.rate_paise, p_max: b.max_guests, p_active: b.active }) },
  'room-type-set': { schema: roomSetTypeBody, run: (db, b) => staffRpc(db, 'padh_room_set_type', { p_room: b.room, p_type: b.type }) },
};

// Owner / manager: change one part of the billing setup. The database checks the role again.
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const def = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  return staffRoute(req, { method: 'POST', schema: def?.schema }, async (ctx, body) => {
    if (!def) throw new ApiError(404, 'not_found');
    await limit(`psb:${ctx.userId}`, 120, 60);
    return jsonOk(await def.run(ctx.db, (body ?? {}) as Body), ctx.requestId);
  });
}
