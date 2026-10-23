import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { serverEnv } from '@/env';
import { decryptText, encryptText, toBytea } from './crypto';

/** The address printed on room QR codes. Uses the Padharosaa address when it is set, otherwise the app address. */
export function guestLink(slug: string, key: string): string {
  const env = serverEnv();
  const origin = (env.NEXT_PUBLIC_PADHAROSAA_ORIGIN ?? env.NEXT_PUBLIC_APP_ORIGIN).replace(/\/$/, '');
  return `${origin}/padharosaa/${slug}?k=${key}`;
}

/** A fresh key and the two things the database stores for it: its hash (to check scans) and an encrypted copy (to show the link again). */
export function newQrKey(): { key: string; hash: string; enc: string } {
  const key = randomBytes(32).toString('hex');
  return { key, hash: toBytea(createHash('sha256').update(key, 'utf8').digest()), enc: toBytea(encryptText(key)) };
}

export function keyFromHex(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    const k = decryptText(Buffer.from(enc, 'hex'));
    return /^[0-9a-f]{64}$/.test(k) ? k : null;
  } catch {
    return null;
  }
}
