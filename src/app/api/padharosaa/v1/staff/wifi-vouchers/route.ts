import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { encryptText } from '@/lib/padharosaa/crypto';
import { wifiVouchersBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: how many Wi-Fi logins are left, and adding more. Passwords are encrypted here before they reach the database.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_wifi_vouchers_status'), ctx.requestId);
  });
}
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: wifiVouchersBody, maxBytes: 300_000 }, async (ctx, b) => {
    await limit(`psw:${ctx.userId}`, 20, 60);
    const items = b.items.map((v) => ({ username: v.username, password_enc: encryptText(v.password).toString('hex') }));
    return jsonOk(await staffRpc(ctx.db, 'padh_wifi_vouchers_add', { p_items: JSON.stringify(items) }), ctx.requestId);
  });
}
