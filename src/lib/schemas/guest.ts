import { z } from 'zod';

const token = z.string().regex(/^[0-9a-f]{64}$/, 'bad token');
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
const uuid = z.string().uuid();
/** Free text typed by a guest. Control characters are stripped; length is capped. Always rendered as plain text. */
const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().max(max));

export const orderBody = z
  .object({
    slug,
    token,
    items: z
      .array(
        z
          .object({
            item_id: uuid,
            qty: z.number().int().min(1).max(10),
            note: text(100).optional(),
            // the guest's size and extras: ids only; the price is always worked out on the server
            variant_id: uuid.optional(),
            option_ids: z.array(uuid).max(20).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(25),
    note: text(200).optional(),
    // hotel room orders only: how it reaches the guest. (The desk sets the Takeaway time, never the guest.)
    handover: z.enum(['deliver', 'takeaway']).optional(),
    idempotency_key: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
    // Only sent when the cafe asks for it; used for one distance check and never stored.
    geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000) }).strict().optional(),
  })
  .strict();
export type OrderBody = z.infer<typeof orderBody>;

export const orderEtaBody = z.object({ slug, token, order_no: z.number().int().min(1), minutes: z.number().int().min(0).max(180) }).strict();

export const roomBody = z.object({ slug, token, room: text(10).pipe(z.string().min(1)) }).strict();

export const tableLinkBody = z.object({ slug, token, table: text(20).pipe(z.string().min(1)) }).strict();

export const helpBody = z
  .object({ slug, token, room: text(10).pipe(z.string().min(1)), topics: z.array(text(40).pipe(z.string().min(1))).max(12), note: text(300).optional() })
  .strict();

export const requestBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('waiter'), slug, token, reason: z.enum(['water', 'cutlery', 'cleaning', 'help', 'other']) }).strict(),
  z.object({ type: z.literal('bill'), slug, token, pay_mode: z.enum(['cash', 'upi', 'card']) }).strict(),
]);
export type RequestBody = z.infer<typeof requestBody>;

export const slugParam = slug;

export const EVENTS = ['menu_opened', 'qr_landing', 'category_viewed', 'item_viewed', 'search', 'whatsapp_click', 'call_click', 'directions_click', 'instagram_click', 'google_review_click', 'cart_add', 'explore_click'] as const;
export type MenuEvent = (typeof EVENTS)[number];
export const eventBody = z
  .object({ slug, token: token.nullish(), visit: uuid, event: z.enum(EVENTS), item_id: uuid.nullish(), category_id: uuid.nullish() })
  .strict();
