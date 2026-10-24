import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { decryptText } from '@/lib/padharosaa/crypto';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

interface Row { mobile_enc: string | null; mobile_cc: string; [k: string]: unknown }

// The desk's live list. Guest mobile numbers are decrypted here, for reception and managers only (the kitchen never receives them).
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`psb:${ctx.userId}`, 240, 60);
    const board = await staffRpc<{ role: string; requests: Row[] }>(ctx.db, 'padh_staff_board');
    // one unreadable number (a damaged row, or an old key) must never take the whole desk down: that guest simply shows without a number
    const readable = (hex: string): string | null => { try { return decryptText(Buffer.from(hex, 'hex')); } catch { return null; } };
    const requests = board.requests.map(({ mobile_enc, mobile_cc: _cc, ...r }) => ({ ...r, mobile: mobile_enc ? readable(mobile_enc) : null }));
    return jsonOk({ role: board.role, requests }, ctx.requestId);
  });
}
