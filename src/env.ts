import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

// Plain http is only tolerated for loopback (local testing); a real deployment can never be 127.0.0.1.
const isLoopback = (v: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(v);
const httpsInProd = (v: string) => !isProd || v.startsWith('https://') || isLoopback(v);

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().refine(httpsInProd, 'must start with https:// in production'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'looks too short to be a Supabase anon/publishable key'),
  NEXT_PUBLIC_APP_ORIGIN: z.string().url().refine(httpsInProd, 'must start with https:// in production'),
});

const serverSchema = publicSchema.extend({
  /** Server only. Never import this module's server half from client code. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'looks too short to be a Supabase service-role key'),
  /** HMAC key for the guest session cookie. Generate with: openssl rand -base64 48 */
  GUEST_COOKIE_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Salt for hashing guest IP addresses before they are stored. Generate with: openssl rand -base64 24 */
  IP_HASH_SALT: z.string().min(16, 'must be at least 16 characters'),
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
  });
}
