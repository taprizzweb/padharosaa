import { z } from 'zod';

const uuid = z.string().uuid();
export const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
export const qrKey = z.string().regex(/^[0-9a-f]{64}$/);

/** NFC-normalise, drop control characters and bidirectional overrides (spec 7.6), collapse spaces, trim. */
export function cleanText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
export const text = (min: number, max: number) =>
  z
    .string()
    .max(max * 4)
    .transform(cleanText)
    .pipe(z.string().min(min).max(max));
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform(cleanText)
    .pipe(z.string().max(max))
    .optional();

export const LANGS = ['en', 'hi', 'fr', 'es', 'de'] as const;
export const lang = z.enum(LANGS);

export const loginBody = z
  .object({
    k: qrKey,
    name: text(2, 80),
    cc: z.string().regex(/^\+[0-9]{1,3}$/),
    mobile: z.string().max(30),
    language: lang.default('en'),
    room: text(1, 10),
    stay_code: z.string().regex(/^[0-9]{4}$/).optional(),
    consent: z.boolean().default(false),
    consent_version: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const digits = v.mobile.replace(/[\s-]/g, '');
    const ok = v.cc === '+91' ? /^[6-9][0-9]{9}$/.test(digits) : /^[0-9]{6,14}$/.test(digits);
    if (!ok) ctx.addIssue({ code: 'custom', message: 'bad mobile', path: ['mobile'] });
    if (v.consent && !v.consent_version) ctx.addIssue({ code: 'custom', message: 'consent_version required', path: ['consent_version'] });
  });

export const preferencesBody = z
  .object({
    diet: z.enum(['vegetarian', 'jain', 'vegan', 'non_vegetarian']).nullable().default(null),
    occasion: z.enum(['birthday', 'anniversary', 'honeymoon']).nullable().default(null),
    language: lang.optional(),
  })
  .strict();

/** Types a guest may create (food, chat, feedback and vista are created by their own flows). */
export const GUEST_REQUEST_TYPES = ['housekeeping', 'wake', 'cab', 'late_checkout', 'reservation', 'skip_line', 'artisan', 'errand', 'plan', 'checkout', 'help'] as const;
export const createRequestBody = z
  .object({ type: z.enum(GUEST_REQUEST_TYPES), label: text(1, 120), detail: optionalText(500), urgent: z.boolean().default(false) })
  .strict();

/** cancel sends {}; confirm sends {ok: true|false} */
export const guestActionBody = z.object({ ok: z.boolean().optional() }).strict();

export const messagesQuery = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

// ---- staff ----
export const versionBody = z.object({ version: z.number().int().min(1) }).strict();
export const dismissBody = z.object({ version: z.number().int().min(1), reason: text(3, 140) }).strict();
export const passBody = z
  .object({ version: z.number().int().min(1), team: z.enum(['concierge', 'front_desk', 'housekeeping', 'kitchen', 'maintenance', 'manager']) })
  .strict();
export const resolveBody = z
  .object({ version: z.number().int().min(1), outcome: z.enum(['fixed', 'replacement_sent', 'room_changed', 'compensation_offered']) })
  .strict();
export const rotateBody = z.object({ confirm: z.string().max(20) }).strict();
export const enableBody = z.object({ timezone: z.string().min(3).max(60).default('Asia/Kolkata') }).strict();
export const idParam = uuid;

// ---- manager / owner settings ----
const phone = z.string().regex(/^[0-9]{10,15}$/);
const https = z.string().url().max(500).refine((u) => u.startsWith('https://'), 'must be https');
const crop = z
  .object({ zoom: z.number().min(1).max(4), x: z.number().min(0).max(1), y: z.number().min(0).max(1), aspect: z.enum(['1:1', '4:3', '16:9', '3:4', 'free']), brightness: z.number().min(0.5).max(1.5).optional(), contrast: z.number().min(0.5).max(1.5).optional() })
  .strict();
export const homeBody = z.object({ offer: text(0, 200).nullish(), offer_until: z.string().datetime({ offset: true }).nullish(), info: text(0, 400).nullish() }).strict();
export const stayBody = z
  .object({ wifi_name: text(0, 60).nullish(), wifi_password: z.string().min(1).max(63).nullish(), checkout_time: text(0, 40).nullish(), breakfast: text(0, 80).nullish(), reception_phone: phone.nullish(), manager_phone: phone.nullish() })
  .strict();
export const brandingBody = z
  .object({
    brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
    logo_path: z.string().max(300).nullish(), logo_crop: crop.nullish(), hero_path: z.string().max(300).nullish(), hero_crop: crop.nullish(),
    instagram: z.string().regex(/^@?[A-Za-z0-9._]{1,30}$/).nullish(), google_review_url: https.nullish(), tripadvisor_url: https.nullish(), menu_url: https.nullish(),
  })
  .strict();
