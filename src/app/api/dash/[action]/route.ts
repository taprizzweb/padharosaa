import { ZodError } from 'zod';
import { ApiError } from '@/lib/errors';
import { jsonOk, staffRoute } from '@/lib/api/route';
import { DASH_ACTIONS } from '@/lib/dash/actions';
import { limit } from '@/lib/guest/rpc';
import { handleStaffAction, STAFF_ACTIONS } from '@/lib/dash/staff-actions';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ action: string }> };

async function handle(req: Request, { params }: Ctx, method: 'GET' | 'POST') {
  const { action } = await params;
  const def = Object.hasOwn(DASH_ACTIONS, action) ? DASH_ACTIONS[action] : undefined;
  const isStaff = Object.hasOwn(STAFF_ACTIONS, action);
  if (!def && !isStaff) return staffRoute(req, { method }, async () => { throw new ApiError(404, 'not_found'); });
  const wanted = def ? def.method : STAFF_ACTIONS[action]!.method;
  return staffRoute(req, { method: wanted, maxBytes: action === 'menu-import' ? 300 * 1024 : undefined, schema: (def ?? STAFF_ACTIONS[action])!.schema }, async (ctx, body) => {
    if (method !== wanted) throw new ApiError(405, 'method_not_allowed');
    await limit(`dm:${ctx.userId}`, 300, 60);
    if (isStaff) return handleStaffAction(action, ctx, body);
    let input: unknown = body;
    if (method === 'GET') {
      const q = Object.fromEntries(new URL(req.url).searchParams);
      try {
        input = def!.schema ? def!.schema.parse(q) : {};
      } catch (e) {
        if (e instanceof ZodError) throw new ApiError(400, 'invalid_input');
        throw e;
      }
    }
    const data = await staffRpc(ctx.db, def!.rpc, def!.args(input));
    return jsonOk(def!.result ? def!.result(data) : data, ctx.requestId);
  });
}

export const GET = (req: Request, c: Ctx) => handle(req, c, 'GET');
export const POST = (req: Request, c: Ctx) => handle(req, c, 'POST');
