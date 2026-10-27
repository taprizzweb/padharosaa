import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { taxRuleBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// The hotel's GST rules by menu word: read by the front office, changed by the owner and manager.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ptr:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_tax_rules_get'), ctx.requestId);
  });
}

export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: taxRuleBody }, async (ctx, b) => {
    await limit(`ptw:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_tax_rule_save', { p_word: b.word, p_rate_bp: b.rate_bp, p_active: b.active }), ctx.requestId);
  });
}
