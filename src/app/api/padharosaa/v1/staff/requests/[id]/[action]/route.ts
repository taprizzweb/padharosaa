import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { dismissBody, handoverBody, idParam, passBody, resolveBody, versionBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// accept | dismiss | pass | complete | resolve | handover. Every call carries the `version` the screen saw; a stale one answers 409 conflict.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return staffRoute(req, { method: 'POST' }, async (ctx, raw) => {
    const rid = idParam.safeParse(id);
    if (!rid.success) throw new ApiError(404, 'not_found');
    await limit(`ps:${ctx.userId}`, 120, 60); // 120 staff actions per minute
    const base = { p_request: rid.data };
    switch (action) {
      case 'accept': {
        const b = versionBody.parse(raw);
        return jsonOk(await staffRpc(ctx.db, 'padh_accept', { ...base, p_version: b.version }), ctx.requestId);
      }
      case 'complete': {
        const b = versionBody.parse(raw);
        return jsonOk(await staffRpc(ctx.db, 'padh_complete', { ...base, p_version: b.version }), ctx.requestId);
      }
      case 'dismiss': {
        const b = dismissBody.parse(raw);
        return jsonOk(await staffRpc(ctx.db, 'padh_dismiss', { ...base, p_version: b.version, p_reason: b.reason }), ctx.requestId);
      }
      case 'pass': {
        const b = passBody.parse(raw);
        return jsonOk(await staffRpc(ctx.db, 'padh_pass', { ...base, p_version: b.version, p_team: b.team }), ctx.requestId);
      }
      case 'resolve': {
        const b = resolveBody.parse(raw);
        return jsonOk(await staffRpc(ctx.db, 'padh_resolve', { ...base, p_version: b.version, p_outcome: b.outcome }), ctx.requestId);
      }
      case 'handover': {
        const b = handoverBody.parse(raw);
        return jsonOk(await staffRpc(ctx.db, 'padh_set_handover', { ...base, p_version: b.version, p_mode: b.mode }), ctx.requestId);
      }
      default:
        throw new ApiError(404, 'not_found');
    }
  });
}
