import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

// Plain http is only tolerated for loopback (local testing); a real deployment can never be 127.0.0.1.
const isLoopback = (v: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(v);
const httpsInProd = (v: string) => !isProd || v.startsWith('https://') || isLoopback(v);

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().refine(httpsInProd, 'must start with https:// in production'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'looks too short to be a Supabase anon/publishable key'),
  NEXT_PUBLIC_APP_ORIGIN: z.string().url().refine(httpsInProd, 'must start with https:// in production'),
  /** Optional: the Padharosaa hotel address (e.g. https://padharosaa.taprizz.in). Used for guest QR links; falls back to the app origin. */
  NEXT_PUBLIC_PADHAROSAA_ORIGIN: z.string().url().refine(httpsInProd, 'must start with https:// in production').optional(),
});

const serverSchema = publicSchema.extend({
  /** Server only. Never import this module's server half from client code. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'looks too short to be a Supabase service-role key'),
  /** HMAC key for the guest session cookie. Generate with: openssl rand -base64 48 */
  GUEST_COOKIE_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Salt for hashing guest IP addresses before they are stored. Generate with: openssl rand -base64 24 */
  IP_HASH_SALT: z.string().min(16, 'must be at least 16 characters'),
  /**
   * Padharosaa only (Menu Lite does not need it). Base64 of 32 random bytes: encrypts guests' mobile numbers and keys their lookup hash.
   * Generate with: openssl rand -base64 32
   */
  PADHAROSAA_DATA_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of exactly 32 bytes (openssl rand -base64 32)')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Padharosaa alerts: WhatsApp Business Cloud API. All optional; without them queued alerts wait in the outbox (see docs/PRODUCTION.md). */
  WHATSAPP_TOKEN: z.string().min(20).optional().or(z.literal('').transform(() => undefined)),
  WHATSAPP_PHONE_ID: z.string().regex(/^[0-9]{5,30}$/).optional().or(z.literal('').transform(() => undefined)),
  WHATSAPP_HELP_TEMPLATE: z.string().regex(/^[a-z0-9_]{1,60}$/).default('padharosaa_help_alert'),
  WHATSAPP_TEMPLATE_LANG: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('en'),
  /**
   * Optional AI wording for the Jaipur guide (drafts only; the manager always reviews). Any OpenAI-compatible service works, including free tiers:
   *   Gemini  AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  AI_MODEL=gemini-2.0-flash
   *   Groq    AI_BASE_URL=https://api.groq.com/openai/v1                           AI_MODEL=llama-3.3-70b-versatile
   * Without these the guide still works: the manager writes the text.
   */
  AI_BASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  AI_API_KEY: z.string().min(8).optional().or(z.literal('').transform(() => undefined)),
  AI_MODEL: z.string().regex(/^[A-Za-z0-9._:\/-]{1,80}$/).optional().or(z.literal('').transform(() => undefined)),
  /** Shared secret for /api/padharosaa/v1/cron/notify (Vercel Cron sends it as a bearer token). Generate with: openssl rand -base64 32 */
  CRON_SECRET: z.string().min(24).optional().or(z.literal('').transform(() => undefined)),
  /** Web Push keys for the buffet alerts on guests' phones. Generate once with: npx web-push generate-vapid-keys. VAPID_SUBJECT is mailto:you@example.com */
  VAPID_PUBLIC_KEY: z.string().min(40).max(120).optional().or(z.literal('').transform(() => undefined)),
  VAPID_PRIVATE_KEY: z.string().min(20).max(120).optional().or(z.literal('').transform(() => undefined)),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)\S+$/).optional().or(z.literal('').transform(() => undefined)),
  /** Channel manager (Channex). One platform key for every hotel; each hotel's own property id is set in its console. Never put the key in the database. */
  CHANNEX_API_KEY: z.string().min(16).max(200).optional().or(z.literal('').transform(() => undefined)),
  CHANNEX_BASE_URL: z.string().url().default('https://app.channex.io/api/v1'),
  SENTRY_DSN: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'Copy .env.example to .env.local and fill in every value (see docs/DEPLOYMENT.md).',
    );
    this.name = 'EnvError';
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    // Report variable names and what is wrong, never the values (they may be secrets).
    throw new EnvError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  return result.data;
}

export const parsePublicEnv = (raw: Record<string, string | undefined>): PublicEnv => parse(publicSchema, raw);
export const parseServerEnv = (raw: Record<string, string | undefined>): ServerEnv => parse(serverSchema, raw);

let cachedServer: ServerEnv | undefined;
/** Validated server environment. Throws EnvError on first use (and at boot via instrumentation.ts). */
export function serverEnv(): ServerEnv {
  cachedServer ??= parseServerEnv(process.env);
  return cachedServer;
}

/** Only NEXT_PUBLIC_* values; safe for client bundles. Literal accesses are required for Next to inline them. */
export function publicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_ORIGIN: process.env.NEXT_PUBLIC_APP_ORIGIN,
    NEXT_PUBLIC_PADHAROSAA_ORIGIN: process.env.NEXT_PUBLIC_PADHAROSAA_ORIGIN || undefined,
  });
}
