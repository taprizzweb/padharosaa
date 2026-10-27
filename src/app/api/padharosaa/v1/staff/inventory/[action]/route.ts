import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodTypeAny } from 'zod';
import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { idParam, invItemBody, invMoveBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- each entry below is checked by its own zod schema
const POSTS: Record<string, { schema: ZodTypeAny; run: (db: SupabaseClient, b: Body) => Promise<unknown> }> = {
  item: { schema: invItemBody, run: (db, b) => staffRpc(db, 'padh_inv_item_save', { p_id: b.id ?? null, p_name: b.name, p_unit: b.unit, p_category: b.category ?? null, p_min: b.min_qty, p_active: b.active }) },
  move: { schema: invMoveBody, run: (db, b) => staffRpc(db, 'padh_inv_move', { p_item: b.item, p_kind: b.kind, p_qty: b.qty, p_cost_paise: b.cost_paise ?? null, p_note: b.note ?? null }) },
};

// Stock list, and one item's movements (?item=). The database decides who may read and write.
export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`pin:${ctx.userId}`, 240, 60);
    if (action === 'list') return jsonOk({ items: await staffRpc(ctx.db, 'padh_inv_list') }, ctx.requestId);
    if (action === 'moves') {
      const id = idParam.safeParse(new URL(req.url).searchParams.get('item'));
      if (!id.success) throw new ApiError(400, 'invalid_input');
      return jsonOk({ moves: await staffRpc(ctx.db, 'padh_inv_moves', { p_item: id.data }) }, ctx.requestId);
    }
    throw new ApiError(404, 'not_found');
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const def = Object.hasOwn(POSTS, action) ? POSTS[action] : undefined;
  return staffRoute(req, { method: 'POST', schema: def?.schema }, async (ctx, body) => {
    if (!def) throw new ApiError(404, 'not_found');
    await limit(`piw:${ctx.userId}`, 120, 60);
    return jsonOk(await def.run(ctx.db, (body ?? {}) as Body), ctx.requestId);
  });
}
