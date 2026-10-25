import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { decryptText } from '@/lib/padharosaa/crypto';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

interface Row { mobile_enc?: string | null; [k: string]: unknown }

// Reception, manager, owner: every room with a guest (name and mobile number), its open requests and orders, and the amount not yet settled.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    const rooms = await staffRpc<Row[]>(ctx.db, 'padh_live_rooms');
    // one unreadable number must never hide the room list: that guest simply shows without a number
    const readable = (hex: string): string | null => { try { return decryptText(Buffer.from(hex, 'hex')); } catch { return null; } };
    return jsonOk({ rooms: rooms.map(({ mobile_enc, ...r }) => ({ ...r, mobile: mobile_enc ? readable(mobile_enc) : null })) }, ctx.requestId);
  });
}
