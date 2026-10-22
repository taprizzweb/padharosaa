import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { encryptText, toBytea } from '@/lib/padharosaa/crypto';
import { stayBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Manager / owner: Wi-Fi, check-out, breakfast and the reception and manager numbers. The Wi-Fi password is encrypted before it is stored.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: stayBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    await staffRpc(ctx.db, 'padh_set_stay', {
      p_wifi_name: b.wifi_name ?? null,
      p_wifi_enc: b.wifi_password ? toBytea(encryptText(b.wifi_password)) : null,
      p_checkout: b.checkout_time ?? null,
      p_breakfast: b.breakfast ?? null,
      p_reception_phone: b.reception_phone ?? null,
      p_manager_phone: b.manager_phone ?? null,
    });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
