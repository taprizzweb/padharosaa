'use client';
import { errText } from './api';
import { ApiFailure } from '@/lib/guest/client';

/** Returns an error message, or null when the password was changed. */
export async function dashPostPassword(password: string): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ password }) });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: { key?: string } } | null;
    if (res.status === 400) return 'That password was not accepted. Choose a longer one that is not common or from a known data leak.';
    return errText(new ApiFailure(body?.error?.key ?? 'server_error', res.status));
  } catch {
    return errText(new ApiFailure('network', 0));
  }
}
