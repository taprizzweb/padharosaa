import { z } from 'zod';

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001F\u007F]*$/);
const RESERVED = new Set(['admin','staff','dash','dashboard','api','login','logout','auth','_next','static','assets','health','privacy','terms','support','dev','public','app','www','mail','help','about','contact','signup','register','settings','account','status','favicon','robots','sitemap','manifest','sw','offline','images','img','menu','demo','test','null','undefined']);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Use 3 to 40 letters, numbers or single hyphens')
  .refine((s) => !s.includes('--'), 'Use single hyphens only')
  .refine((s) => !RESERVED.has(s), 'That address is reserved');

const paidUntil = z.string().datetime({ offset: true }).nullable();

export const createRestaurant = z
  .object({
    slug: slugSchema,
    name: text(80),
    owner_email: z.string().trim().toLowerCase().email().max(254),
    owner_name: text(60),
    plan: text(30).default('pilot'),
    paid_until: paidUntil.default(null),
  })
  .strict();

export const setStatus = z.object({ id: uuid, status: z.enum(['active', 'suspended']) }).strict();
export const restaurantIdBody = z.object({ id: uuid }).strict();
export const emptyBody = z.object({}).strict();
export const restaurantQuery = z.object({ id: uuid });
export const deleteRestaurant = z.object({ id: uuid, confirm_slug: z.string().min(1).max(60) }).strict();
export const staffReset = z.object({ id: uuid, user_id: uuid }).strict();
export const staffEmail = z.object({ id: uuid, user_id: uuid, email: z.string().trim().toLowerCase().email().max(254) }).strict();
export const staffAdd = z.object({ id: uuid, email: z.string().trim().toLowerCase().email().max(254), name: text(60), role: z.enum(['owner', 'manager', 'waiter', 'kitchen']) }).strict();

const paise = z.number().int().min(0).max(100_000_000);
export const planSave = z
  .object({
    id: uuid.nullish(),
    name: text(40),
    points: z.array(z.string().trim().max(120).regex(/^[^\u0000-\u001F\u007F]*$/)).max(20),
    setup_fee_paise: paise,
    monthly_paise: paise,
    yearly_paise: paise,
    active: z.boolean(),
    sort_order: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export const planDelete = z.object({ id: uuid }).strict();
export const billingSave = z
  .object({
    id: uuid,
    plan_id: uuid.nullable(),
    plan_name: text(40),
    price_paise: paise,
    period: z.enum(['monthly', 'yearly', 'one_time']),
    setup_fee_paise: paise,
    starts_at: paidUntil.default(null),
    paid_until: paidUntil.default(null),
    auto_pause: z.boolean(),
    grace_days: z.number().int().min(0).max(60),
    note: z.string().trim().max(300).regex(/^[^\u0000-\u001F\u007F]*$/).default(''),
  })
  .strict();
export const restaurantRename = z.object({ id: uuid, name: text(80) }).strict();
export const staffRename = z.object({ id: uuid, user_id: uuid, name: text(60) }).strict();
export const duplicateRestaurant = z
  .object({ source_id: uuid, slug: slugSchema, name: text(80), owner_email: z.string().trim().toLowerCase().email().max(254), owner_name: text(60) })
  .strict();
