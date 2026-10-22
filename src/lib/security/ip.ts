import { createHmac } from 'node:crypto';

/** First hop of x-forwarded-for (set by Vercel's edge, not by the client). Never stored or logged raw. */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Salted HMAC so the stored value cannot be reversed to an IP address. */
export function hashIp(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 32);
}
