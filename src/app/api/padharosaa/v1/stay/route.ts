import { jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { decryptText } from '@/lib/padharosaa/crypto';
import { padGuestRoute } from '@/lib/padharosaa/guest';

export const dynamic = 'force-dynamic';

interface Stay {
  wifi_name: string | null;
  wifi_password_enc: string | null;
  checkout_time: string | null;
  breakfast: string | null;
  entrance_maps_url: string | null;
  diet: string | null;
  occasion: string | null;
}

// Stay and Wi-Fi. The Wi-Fi password is stored encrypted and decrypted here, only for a logged-in guest.
export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    const { wifi_password_enc, ...rest } = await rpc<Stay>('padh_guest_stay', { p_session: ctx.me.session_id });
    return jsonOk({ ...rest, wifi_password: wifi_password_enc ? decryptText(Buffer.from(wifi_password_enc, 'hex')) : null }, ctx.requestId);
  });
}
