import { ZodError } from 'zod';
import { ApiError } from '@/lib/errors';
import { adminRoute } from '@/lib/api/route';
import { ADMIN_ACTIONS } from '@/lib/admin/actions';
import { limit } from '@/lib/guest/rpc';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ action: string }> };

async function handle(req: Request, { params }: Ctx, method: 'GET' | 'POST') {
  const { action } = await params;
  const def = Object.hasOwn(ADMIN_ACTIONS, action) ? ADMIN_ACTIONS[action] : undefined;
  return adminRoute(req, { method: def?.method ?? method, schema: method === 'POST' ? def?.schema : undefined }, async (ctx, body) => {
    if (!def) throw new ApiError(404, 'not_found');
    if (method !== def.method) throw new ApiError(405, 'method_not_allowed');
    await limit(`am:${ctx.userId}`, 120, 60);
    let input: unknown = body;
    if (method === 'GET') {
      try {
        input = def.schema ? def.schema.parse(Object.fromEntries(new URL(req.url).searchParams)) : {};
      } catch (e) {
        if (e instanceof ZodError) throw new ApiError(400, 'invalid_input');
        throw e;
      }
    }
    return def.run(ctx, input);
  });
}

export const GET = (req: Request, c: Ctx) => handle(req, c, 'GET');
export const POST = (req: Request, c: Ctx) => handle(req, c, 'POST');
