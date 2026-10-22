import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { serverEnv } from '@/env';
import { ApiError } from '@/lib/errors';

/** Padharoso data key (32 bytes). Menu Lite deployments do not set it; Padharoso routes then answer 500 instead of storing plaintext. */
function dataKey(): Buffer {
  const k = serverEnv().PADHAROSO_DATA_KEY;
  if (!k) throw Object.assign(new Error('PADHAROSO_DATA_KEY is not set'), { dbCode: 'CONFIG' });
  return Buffer.from(k, 'base64');
}

/** Subkey per purpose, so the encryption key and the lookup-hash key are never the same bytes. */
function subkey(purpose: string): Buffer {
  return createHmac('sha256', dataKey()).update(`padharoso:${purpose}`).digest();
}

const VERSION = 1;

/** AES-256-GCM. Layout: [version 1 byte][iv 12][tag 16][ciphertext]. The version byte allows yearly key rotation. */
export function encryptText(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', subkey('enc'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), ct]);
}

export function decryptText(blob: Buffer): string {
  if (blob.length < 30 || blob[0] !== VERSION) throw new Error('unsupported ciphertext');
  const d = createDecipheriv('aes-256-gcm', subkey('enc'), blob.subarray(1, 13));
  d.setAuthTag(blob.subarray(13, 29));
  return Buffer.concat([d.update(blob.subarray(29)), d.final()]).toString('utf8');
}

/** Keyed hash for lookups and de-duplication of a mobile number (country code + digits). Not reversible without the key. */
export function mobileHash(cc: string, digits: string): Buffer {
  return createHmac('sha256', subkey('mobile')).update(`${cc}${digits}`).digest();
}

/** Postgres/PostgREST bytea literal. */
export const toBytea = (b: Buffer): string => `\\x${b.toString('hex')}`;

/** 256-bit session token for the cookie (the database keeps only its SHA-256). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

export function requireWellFormedToken(t: string | undefined): string {
  if (!t || !TOKEN_RE.test(t)) throw new ApiError(401, 'session_closed');
  return t;
}
