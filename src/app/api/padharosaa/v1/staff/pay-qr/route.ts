import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { payQrBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: the photo of the hotel's payment (UPI) QR that guests see when they choose "Pay now". Checked again in SQL.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: payQrBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_set_pay_qr', { p_path: b.path }), ctx.requestId);
  });
}
