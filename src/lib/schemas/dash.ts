import { z } from 'zod';
import { normalizeExploreCode } from '@/lib/profile';
import { parseRooms } from '@/lib/rooms';

const uuid = z.string().uuid();
const clean = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().max(max));
const name = (max: number) => clean(max).pipe(z.string().min(1));

export const categorySave = z.object({ id: uuid.nullish(), name: name(60), active: z.boolean().default(true) }).strict();
export const idOnly = z.object({ id: uuid }).strict();
export const categoriesReorder = z.object({ ids: z.array(uuid).min(1).max(200) }).strict();

export const itemSave = z
  .object({
    id: uuid.nullish(),
    category_id: uuid,
    name: name(80),
    description: clean(300).nullish(),
    price_paise: z.number().int().min(0).max(10_000_000),
    diet: z.enum(['veg', 'nonveg', 'egg', 'jain']),
    spice: z.number().int().min(0).max(3),
    image_path: z.string().max(200).nullish(),
    is_bestseller: z.boolean(),
    is_chef_pick: z.boolean(),
    is_available: z.boolean().optional(),
  })
  .strict();
export const itemChoicesSave = z
  .object({
    item_id: uuid,
    variants: z.array(z.object({ id: uuid.optional(), name: name(30), price_paise: z.number().int().min(0).max(10_000_000), is_available: z.boolean() }).strict()).max(8),
    groups: z
      .array(
        z
          .object({
            id: uuid.optional(),
            name: name(40),
            required: z.boolean(),
            max_select: z.number().int().min(1).max(20),
            options: z.array(z.object({ id: uuid.optional(), name: name(40), price_delta_paise: z.number().int().min(0).max(5_000_000) }).strict()).min(1).max(20),
          })
          .strict()
          .refine((g) => g.max_select <= g.options.length, { message: 'max_select cannot be more than the number of options' }),
      )
      .max(6),
  })
  .strict();
export const itemsReorder = z.object({ category_id: uuid, ids: z.array(uuid).min(1).max(300) }).strict();
export const bulkPrice = z
  .object({ item_ids: z.array(uuid).min(1).max(300), mode: z.enum(['percent', 'add', 'set']), value: z.number().finite().min(-100_000_000).max(100_000_000) })
  .strict();

export const menuImport = z
  .object({
    rows: z
      .array(
        z
          .object({
            category: name(60),
            name: name(80),
            description: clean(300),
            price_paise: z.number().int().min(0).max(10_000_000),
            diet: z.enum(['veg', 'nonveg', 'egg', 'jain']),
            spice: z.number().int().min(0).max(3),
            bestseller: z.boolean(),
            chef_pick: z.boolean(),
            available: z.boolean(),
            sizes: z.array(z.object({ name: name(30), price_paise: z.number().int().min(0).max(10_000_000) }).strict()).max(8).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const tableSave = z.object({ id: uuid, label: name(20), active: z.boolean() }).strict();
export const tablesCreate = z.object({ from: z.number().int().min(1).max(999), to: z.number().int().min(1).max(999) }).strict();

export const roomServiceSave = z
  .object({ enabled: z.boolean(), rooms: z.string().max(4000), rotate: z.boolean().optional() })
  .strict()
  .superRefine((v, ctx) => {
    const r = parseRooms(v.rooms);
    if (!r.ok) ctx.addIssue({ code: 'custom', path: ['rooms'], message: r.error });
  });

export const helpLinkSave = z.object({ enabled: z.boolean(), topics: z.array(name(40)).max(20), rotate: z.boolean().optional() }).strict();
export const tableLinkSave = z.object({ enabled: z.boolean(), rotate: z.boolean().optional() }).strict();

export const settingsSave = z
  .object({
    name: name(80),
    review_url: z
      .string()
      .max(500)
      .trim()
      .refine((v) => v === '' || /^https:\/\/[^\s]+$/.test(v), 'must start with https://')
      .nullish(),
    accent: z.enum(['saffron', 'tomato', 'emerald', 'teal', 'indigo', 'plum', 'rose', 'slate']),
    amber_minutes: z.number().int().min(1).max(120),
    red_minutes: z.number().int().min(2).max(240),
  })
  .strict()
  .refine((s) => s.red_minutes > s.amber_minutes, 'red must be later than amber');

export const staffAdd = z.object({ email: z.string().trim().toLowerCase().email().max(254), name: name(60), role: z.enum(['manager', 'waiter', 'kitchen']) }).strict();
export const staffUpdate = z.object({ user_id: uuid, name: name(60), role: z.enum(['manager', 'waiter', 'kitchen']), active: z.boolean() }).strict();
export const staffReset = z.object({ user_id: uuid }).strict();

export const analyticsQuery = z.object({ range: z.enum(['7d', '30d', '90d']).default('7d') });
export const reportQuery = z.object({ range: z.enum(['today', '7d', '30d']).default('today') });
export const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().positive().optional() });

export const passwordChange = z.object({ password: z.string().min(12, 'at least 12 characters').max(128) }).strict();

const optText = (max: number) => z.string().trim().max(max).regex(/^[^\u0000-\u001F\u007F]*$/).default('');
const exploreCode = z.string().trim().max(300).default('').transform((v, ctx) => {
  if (v === '') return '';
  const n = normalizeExploreCode(v);
  if (!n) ctx.addIssue({ code: 'custom', message: 'only letters, numbers, - and _' });
  return n;
});
const imagePath = z.string().trim().max(200).regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/).or(z.literal('')).default('');
export const profileSave = z
  .object({
    tagline: optText(120),
    description: optText(400),
    logo_path: imagePath,
    banner_path: imagePath,
    address: optText(200),
    hours_text: optText(200),
    explore_code: exploreCode,
  })
  .strict();

export const locationSave = z
  .object({
    required: z.boolean(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    radius_m: z.number().int().min(50).max(2000),
  })
  .strict()
  .refine((v) => !v.required || (v.lat !== null && v.lng !== null), 'the cafe position is needed to switch this on');
