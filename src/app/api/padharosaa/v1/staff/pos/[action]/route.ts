import type { ZodTypeAny } from 'zod';
import type { z } from 'zod';
import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { idParam, posCreateBody, posListQuery, posVoidBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Counter billing reads: the menu to sell from, the day's bills, one bill to print.
export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ppr:${ctx.userId}`, 240, 60);
    const sp = new URL(req.url).searchParams;
    if (action === 'menu') return jsonOk(await staffRpc(ctx.db, 'padh_pos_menu'), ctx.requestId);
    if (action === 'list') {
      const q = posListQuery.safeParse({ day: sp.get('day') || null });
      if (!q.success) throw new ApiError(400, 'invalid_input');
      return jsonOk(await staffRpc(ctx.db, 'padh_pos_list', { p_day: q.data.day ?? null }), ctx.requestId);
    }
    if (action === 'bill') {
      const id = idParam.safeParse(sp.get('id'));
      if (!id.success) throw new ApiError(400, 'invalid_input');
      return jsonOk(await staffRpc(ctx.db, 'padh_pos_get', { p_id: id.data }), ctx.requestId);
    }
    throw new ApiError(404, 'not_found');
  });
}

// create: make a bill. void: cancel one (owner and manager).
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const schema: ZodTypeAny | undefined = action === 'create' ? posCreateBody : action === 'void' ? posVoidBody : undefined;
  return staffRoute(req, { method: 'POST', schema }, async (ctx, body) => {
    if (!schema) throw new ApiError(404, 'not_found');
    await limit(`ppw:${ctx.userId}`, 120, 60);
    if (action === 'create') {
      const b = body as z.infer<typeof posCreateBody>;
      return jsonOk(await staffRpc(ctx.db, 'padh_pos_bill', { p_lines: JSON.stringify(b.lines.map((l) => ({ item: l.item ?? undefined, name: l.name ?? undefined, qty: l.qty, unit_paise: l.unit_paise ?? undefined, tax_bp: l.tax_bp ?? undefined }))), p_label: b.label ?? null, p_customer: b.customer ?? null, p_mode: b.mode, p_stay: b.stay ?? null, p_tax_bp: b.tax_bp ?? null, p_service_bp: b.service_bp, p_discount_paise: b.discount_paise }), ctx.requestId);
    }
    const v = body as z.infer<typeof posVoidBody>;
    return jsonOk(await staffRpc(ctx.db, 'padh_pos_void', { p_id: v.id, p_reason: v.reason }), ctx.requestId);
  });
}
