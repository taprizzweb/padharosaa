import { z } from 'zod';
import { normInsta, normPhone, normUrl, normWhatsapp } from './normalize';

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
/** the person's own password, asked again before a new guest link is made */
export const rotateBody = z.object({ password: z.string().min(1).max(200) }).strict();
export const enableBody = z.object({ timezone: z.string().min(3).max(60).default('Asia/Kolkata') }).strict();
export const idParam = uuid;

// ---- manager / owner settings ----
const phone = z.preprocess(normPhone, z.string().regex(/^[0-9]{10,15}$/));
const https = z.preprocess(normUrl, z.string().url().max(500).refine((u) => u.startsWith('https://'), 'must be https'));
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
    instagram: z.preprocess(normInsta, z.string().regex(/^@?[A-Za-z0-9._]{1,30}$/)).nullish(), google_review_url: https.nullish(), tripadvisor_url: https.nullish(), menu_url: https.nullish(),
  })
  .strict();

// ---- dining, staff directory, alerts ----
const TEAMS = ['concierge', 'front_desk', 'housekeeping', 'kitchen', 'maintenance', 'manager'] as const;
export const handoverBody = z.object({ version: z.number().int().min(1), mode: z.enum(['deliver', 'takeaway']) }).strict();
export const kitchenDisplayBody = z.object({ kitchen_display: z.boolean() }).strict();
export const diningBody = z.object({ room_dining: z.boolean() }).strict();
const waNumber = z.preprocess(normWhatsapp, z.string().regex(/^\+[1-9][0-9]{7,14}$/));
export const profileBody = z.object({ department: z.enum(TEAMS), whatsapp: waNumber.nullish(), is_head: z.boolean().default(false) }).strict();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const hoursBody = z
  .object({ start: hhmm.nullable(), end: hhmm.nullable() })
  .strict()
  .refine((b) => (b.start === null) === (b.end === null) && (b.start === null || b.start !== b.end), 'both times, and different');
export const payQrBody = z.object({ path: z.string().regex(/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/).nullable() }).strict();
export const accountBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reset') }).strict(),
  z.object({ action: z.literal('email'), email: z.string().trim().toLowerCase().email().max(120) }).strict(),
]);
export const alertBody = z.object({ team: z.enum(TEAMS), muted: z.boolean() }).strict();
export const staffRowSchema = z
  .object({ name: text(1, 60), email: z.string().email().max(120).transform((v) => v.toLowerCase()), department: z.enum(TEAMS), whatsapp: waNumber.nullish(), is_head: z.boolean().default(false) })
  .strict();
export const staffImportBody = z.object({ rows: z.array(staffRowSchema).min(1).max(200) }).strict();
export const HELP_CATEGORIES = ['towel_bedsheet', 'water', 'wifi', 'ac_electrical', 'tv', 'cleanliness', 'noise', 'other'] as const;
export const helpBody = z
  .object({ categories: z.array(z.enum(HELP_CATEGORIES)).max(8).default([]), detail: optionalText(500), urgent: z.boolean().default(false) })
  .strict()
  .refine((b) => b.categories.length > 0 || (b.detail?.length ?? 0) >= 3, 'choose a problem or write a few words');
export const foodBody = z.object({ label: text(1, 120), detail: optionalText(500) }).strict();

// ---- guide, plan, buffet, feedback ----
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
export const locationBody = z.object({ lat, lng }).strict();
export const guideSaveBody = z
  .object({
    id: uuid.optional(),
    category: z.enum(['place', 'food', 'craft', 'tip']),
    name: text(1, 100),
    description_en: optionalText(600),
    description_hi: optionalText(600),
    maps_query: optionalText(200),
    link_url: z.string().url().max(500).refine((u) => u.startsWith('https://'), 'must be https').nullish(),
    address: optionalText(200),
    best_time: optionalText(100),
    lat: lat.nullish(),
    lng: lng.nullish(),
    active: z.boolean().optional(),
    needs_review: z.boolean().optional(),
    source: z.enum(['manual', 'osm', 'ai_draft']).optional(),
    publish: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.lat === undefined || b.lat === null) === (b.lng === undefined || b.lng === null), 'lat and lng go together');
export const idBody = z.object({ id: uuid }).strict();
export const discoverBody = z.object({ radius_m: z.number().int().min(500).max(10000).default(3000) }).strict();
export const importBody = z
  .object({ items: z.array(z.object({ category: z.enum(['place', 'food', 'craft']), name: text(1, 100), lat, lng, address: optionalText(200).nullish() }).strict()).min(1).max(30) })
  .strict();
export const guideCsvBody = z
  .object({
    publish: z.boolean(),
    items: z.array(z.object({ category: z.enum(['place', 'food', 'craft', 'tip']), name: text(1, 100), description_en: optionalText(600).nullish(), best_time: optionalText(100).nullish(), address: optionalText(200).nullish(), maps_query: optionalText(200).nullish(), link_url: z.string().url().max(500).refine((u) => u.startsWith('https://'), 'must be https').nullish(), lat: lat.nullish(), lng: lng.nullish() }).strict()).min(1).max(100),
  })
  .strict();
export const describeBody = z.object({ ids: z.array(uuid).min(1).max(10) }).strict();
export const itineraryBody = z
  .object({
    id: uuid.optional(),
    name: text(1, 100),
    tagline: optionalText(160),
    tip: optionalText(400),
    active: z.boolean().optional(),
    stops: z.array(z.object({ id: uuid.optional(), when_label: text(1, 40), name: text(1, 100), note: optionalText(300), maps_query: optionalText(200), lat: lat.nullish(), lng: lng.nullish() }).strict()).max(30).default([]),
  })
  .strict();
export const buffetBody = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mode: z.enum(['in_house', 'outdoor', 'none']),
    name: optionalText(80).nullish(),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
    venue: optionalText(80).nullish(),
    highlights: optionalText(300).nullish(),
    mood: optionalText(80).nullish(),
  })
  .strict();
export const planAddBody = z.object({ name: text(1, 100), when_label: optionalText(40).nullish(), maps_query: optionalText(200).nullish(), lat: lat.nullish(), lng: lng.nullish() }).strict().refine((b) => (b.lat === undefined || b.lat === null) === (b.lng === undefined || b.lng === null), 'lat and lng go together');
export const planRemoveBody = z.object({ item: uuid }).strict();
export const planUseBody = z.object({ itinerary: uuid }).strict();
export const feedbackBody = z.object({ rating: z.enum(['great', 'okay', 'not_good']) }).strict();

/** room numbers for the manager page: each is 1 to 10 characters, upper-case letters, digits, space or dash */
export const roomsBody = z.object({ numbers: z.array(z.string().max(12)).min(1).max(100) }).strict();
export const roomActiveBody = z.object({ active: z.boolean() }).strict();

export const buffetNotifyBody = z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal('')).nullish(), onSave: z.boolean() });
export const autoBillBody = z.object({ on: z.boolean() }).strict();
export const verificationBody = z.object({ level: z.enum(['light', 'strict']) }).strict();
export const assignBody = z.object({ version: z.number().int().min(1), user: z.string().uuid().nullable() }).strict();
export const routingBody = z.object({ team: z.enum(['concierge', 'front_desk', 'housekeeping', 'kitchen', 'maintenance', 'manager']), user: z.string().uuid().nullable() }).strict();
export const demoBody = z.object({ on: z.boolean() }).strict();
export const wifiVouchersBody = z.object({ items: z.array(z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(64) }).strict()).min(1).max(2000) }).strict();

// ---- billing (migrations 0065-0067): the hotel's own taxes, check-in, the folio and payments ----
const bpInt = z.number().int().min(0).max(10000);
const paise = z.number().int().min(0).max(10_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const payMode = z.enum(['cash', 'card', 'upi', 'bank', 'company']);
export const taxRateBody = z.object({ id: uuid.nullish(), name: z.string().trim().min(1).max(40), rate_bp: bpInt, active: z.boolean() }).strict();
export const categoryBody = z.object({ id: uuid.nullish(), name: z.string().trim().min(1).max(40), sac: z.string().max(8).nullish(), tax_rate_id: uuid.nullish(), active: z.boolean() }).strict();
export const slabsBody = z.object({ items: z.array(z.object({ up_to_paise: z.number().int().min(1).max(10_000_000).nullable(), tax_rate_id: uuid }).strict()).max(8) }).strict();
export const extraBody = z.object({ id: uuid.nullish(), name: z.string().trim().min(1).max(40), mode: z.enum(['percent', 'per_night', 'flat']), value: paise, applies_to: z.enum(['room', 'food', 'all']), tax_rate_id: uuid.nullish(), active: z.boolean() }).strict();
export const legalBody = z.object({ legal_name: z.string().max(120).nullish(), gstin: z.string().max(15).nullish(), address: z.string().max(300).nullish(), prefix: z.string().trim().min(1).max(8), terms: z.string().max(400).nullish(), round_off: z.boolean() }).strict();
export const roomTypeBody = z.object({ id: uuid.nullish(), name: z.string().trim().min(1).max(40), rate_paise: paise, max_guests: z.number().int().min(1).max(20), active: z.boolean() }).strict();
export const roomSetTypeBody = z.object({ room: uuid, type: uuid.nullable() }).strict();
export const checkinBody = z.object({
  room: uuid, guest: z.string().trim().min(2).max(80), mobile: z.string().max(20).nullish(), id_type: z.enum(['aadhaar', 'passport', 'driving_licence', 'voter_id', 'other']).nullish(),
  id_last4: z.string().max(4).nullish(), adults: z.number().int().min(1).max(20).default(1), company: z.string().max(120).nullish(), gstin: z.string().max(15).nullish(),
  inter_state: z.boolean().nullish(), address: z.string().max(300).nullish(), rate_paise: paise.nullish(), out_on: day,
  advance_paise: z.number().int().min(0).max(100_000_000).default(0), advance_mode: payMode.nullish(),
}).strict();
export const chargeBody = z.object({ category: uuid, description: z.string().trim().min(1).max(120), qty: z.number().int().min(1).max(99), unit_paise: z.number().int().min(-10_000_000).max(10_000_000).refine((n) => n !== 0) }).strict();
export const paymentBody = z.object({ kind: z.enum(['advance', 'payment', 'refund']), mode: payMode, amount_paise: z.number().int().min(1).max(100_000_000), ref: z.string().max(60).nullish() }).strict();
export const stayUpdateBody = z.object({ rate_paise: paise.nullish(), out_on: day.nullish(), company: z.string().max(120).nullish(), gstin: z.string().max(15).nullish(), inter_state: z.boolean().nullish() }).strict();
export const voidBody = z.object({ reason: z.string().trim().min(1).max(200) }).strict();
export const staysQuery = z.object({ status: z.enum(['in_house', 'checked_out']) });

// ---- staff push notifications (migration 0068) ----
const pushSub = z.object({ endpoint: z.string().url().max(1000), expirationTime: z.number().nullish(), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }).strict() }).strict();
export const staffPushBody = z.object({ subscription: pushSub.nullable(), endpoint: z.string().url().max(1000).nullish() }).strict();

// ---- local guides (migration 0070) ----
export const lguideBody = z.object({
  id: uuid.nullish(), name: z.string().trim().min(1).max(80), title: z.string().max(80).nullish(), about: z.string().max(500).nullish(), languages: z.string().max(100).nullish(),
  charges: z.string().max(160).nullish(), phone: z.string().max(25).nullish(), whatsapp: z.string().max(25).nullish(), instagram: z.string().max(100).nullish(), linkedin: z.string().max(300).nullish(),
  active: z.boolean(), sort: z.number().int().min(0).max(10000).default(100),
}).strict();

// ---- reservations, room chart, housekeeping, search (migration 0071) ----
export const reservationBody = z.object({
  id: uuid.nullish(), room: uuid.nullish(), type: uuid.nullish(), guest: z.string().trim().min(2).max(80), mobile: z.string().max(20).nullish(), adults: z.number().int().min(1).max(20).default(1),
  check_in: day, check_out: day, rate_paise: paise.nullish(), advance_paise: z.number().int().min(0).max(100_000_000).default(0), advance_mode: payMode.nullish(),
  source: z.string().max(40).nullish(), notes: z.string().max(300).nullish(),
}).strict();
export const reservationCloseBody = z.object({ id: uuid, status: z.enum(['cancelled', 'no_show']), reason: z.string().max(200).nullish() }).strict();
export const reservationCheckinBody = z.object({
  id: uuid, room: uuid.nullish(), id_type: z.enum(['aadhaar', 'passport', 'driving_licence', 'voter_id', 'other']).nullish(), id_last4: z.string().max(4).nullish(),
  company: z.string().max(120).nullish(), gstin: z.string().max(15).nullish(), address: z.string().max(300).nullish(),
}).strict();
export const hkBody = z.object({ room: uuid, status: z.enum(['clean', 'dirty', 'cleaning', 'out_of_order']), note: z.string().max(120).nullish() }).strict();
export const chartQuery = z.object({ from: day.nullish(), days: z.coerce.number().int().min(1).max(31).default(14) });
export const reservationsQuery = z.object({ scope: z.enum(['upcoming', 'today', 'past']) });
export const searchQuery = z.object({ q: z.string().trim().min(2).max(40) });

// ---- inventory (migration 0072) ----
export const invItemBody = z.object({
  id: uuid.nullish(), name: z.string().trim().min(1).max(60), unit: z.string().trim().min(1).max(12), category: z.string().max(40).nullish(), min_qty: z.number().min(0).max(1_000_000), active: z.boolean(),
}).strict();
export const invMoveBody = z.object({ item: uuid, kind: z.enum(['in', 'out', 'waste', 'adjust']), qty: z.number().min(0).max(1_000_000), cost_paise: z.number().int().min(0).max(100_000_000).nullish(), note: z.string().max(120).nullish() }).strict();

// ---- counter billing and reports (migration 0073) ----
const posLine = z.object({ item: uuid.nullish(), name: z.string().trim().min(1).max(80).nullish(), qty: z.number().int().min(1).max(99), unit_paise: z.number().int().min(1).max(10_000_000).nullish() }).strict()
  .refine((l) => !!l.item || (!!l.name && !!l.unit_paise), { message: 'a dish or a name and price' });
export const posCreateBody = z.object({ lines: z.array(posLine).min(1).max(60), label: z.string().max(40).nullish(), customer: z.string().max(80).nullish(), mode: z.enum(['cash', 'card', 'upi', 'bank', 'room']), stay: uuid.nullish() }).strict();
export const posVoidBody = z.object({ id: uuid, reason: z.string().trim().min(1).max(200) }).strict();
export const posListQuery = z.object({ day: day.nullish() });
export const reportQuery = z.object({ from: day, to: day });
