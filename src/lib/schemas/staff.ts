import { z } from 'zod';

const uuid = z.string().uuid();
const reason = z
  .string()
  .max(400)
  .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
  .pipe(z.string().max(200));

export const orderReadyInBody = z.object({ order_id: uuid, minutes: z.number().int().min(1).max(180) }).strict();
export const orderHandoverBody = z.object({ order_id: uuid, mode: z.enum(['deliver', 'takeaway']) }).strict();

export const orderStatusBody = z
  .object({ order_id: uuid, status: z.enum(['preparing', 'ready', 'served', 'cancelled']), reason: reason.optional() })
  .strict();

export const requestDoneBody = z.object({ request_id: uuid }).strict();
export const helpDoneBody = z.object({ help_id: uuid }).strict();

export const closeSessionBody = z
  .object({ session_id: uuid, force: z.boolean().optional(), reason: reason.optional(), pay_mode: z.enum(['cash', 'upi', 'card']).optional() })
  .strict();

export const availabilityBody = z.object({ // 300 ids is ~12 KB of JSON: the largest batch that fits the 16 KB request limit
    item_ids: z.array(uuid).min(1).max(300), available: z.boolean() }).strict();

export const loginBody = z
  .object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200), next: z.string().max(200).optional() })
  .strict();

export const logoutBody = z.object({ scope: z.enum(['local', 'global']).default('local') }).strict();

/** Only same-site staff areas are valid post-login destinations (prevents open redirects). */
export function safeNext(next: string | undefined): string {
  return next && /^\/(staff|dash|admin|account\/mfa|padharosaa\/(?:desk|manage|owner|manager|kitchen|reception|housekeeping)|(?:owner|manager|kitchen|reception|housekeeping|desk))(\/[A-Za-z0-9_\-/]*)?$/.test(next) ? next : '/staff';
}

export const mfaVerifyBody = z.object({ factor_id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict();
export const mfaEnrollBody = z.object({}).strict();
