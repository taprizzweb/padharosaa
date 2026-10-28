import type { ZodTypeAny } from 'zod';
import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { chargeBody, idParam, itemEditBody, lineEditBody, orderSkipBody, paymentBody, stayUpdateBody } from '@/lib/padharosaa/schemas';
import { kickChannels } from '@/lib/padharosaa/channels';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

const SCHEMAS: Record<string, ZodTypeAny | undefined> = { charges: chargeBody, payments: paymentBody, update: stayUpdateBody, 'order-skip': orderSkipBody, 'item-edit': itemEditBody, 'line-edit': lineEditBody, checkout: undefined };

// charges: add a line to the bill. order-skip: cross a room-service order off the bill, or bring it back. payments: record money taken or given back. update: rate, last night, company. checkout: invoice and check-out.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return staffRoute(req, { method: 'POST', schema: Object.hasOwn(SCHEMAS, action) ? SCHEMAS[action] : undefined }, async (ctx, body) => {
    const stay = idParam.safeParse(id);
    if (!stay.success || !Object.hasOwn(SCHEMAS, action)) throw new ApiError(404, 'not_found');
    await limit(`psc:${ctx.userId}`, 60, 60);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the body was checked by the schema of this action
    const b = (body ?? {}) as Record<string, any>;
    if (action === 'charges') return jsonOk(await staffRpc(ctx.db, 'padh_folio_add', { p_stay: stay.data, p_category: b.category, p_description: b.description, p_qty: b.qty, p_unit_paise: b.unit_paise }), ctx.requestId);
    if (action === 'payments') return jsonOk(await staffRpc(ctx.db, 'padh_payment_add', { p_stay: stay.data, p_kind: b.kind, p_mode: b.mode, p_amount_paise: b.amount_paise, p_ref: b.ref ?? null }), ctx.requestId);
    if (action === 'order-skip') return jsonOk(await staffRpc(ctx.db, 'padh_folio_order_skip', { p_stay: stay.data, p_order: b.order, p_skip: b.skip, p_reason: b.reason ?? null }), ctx.requestId);
    if (action === 'item-edit') return jsonOk(await staffRpc(ctx.db, 'padh_folio_item_edit', { p_stay: stay.data, p_item: b.item, p_tax_bp: b.tax_bp ?? null, p_unit_paise: b.unit_paise ?? null, p_qty: b.qty ?? null, p_removed: b.removed, p_reason: b.reason ?? null }), ctx.requestId);
    if (action === 'line-edit') return jsonOk(await staffRpc(ctx.db, 'padh_folio_line_edit', { p_line: b.line, p_description: b.description, p_qty: b.qty, p_unit_paise: b.unit_paise, p_tax_bp: b.tax_bp }), ctx.requestId);
    if (action === 'update') return jsonOk(await staffRpc(ctx.db, 'padh_stay_update', { p_stay: stay.data, p_rate_paise: b.rate_paise ?? null, p_out_on: b.out_on ?? null, p_company: b.company ?? null, p_gstin: b.gstin ?? null, p_inter_state: b.inter_state ?? null }), ctx.requestId);
    const out = await staffRpc(ctx.db, 'padh_stay_checkout', { p_stay: stay.data });
    kickChannels(); // the room is free again
    return jsonOk(out, ctx.requestId);
  });
}

// the printable invoice of a guest who has checked out
export async function GET(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    const stay = idParam.safeParse(id);
    if (!stay.success || action !== 'invoice') throw new ApiError(404, 'not_found');
    await limit(`pbl:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_invoice_get', { p_stay: stay.data }), ctx.requestId);
  });
}
