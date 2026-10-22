'use client';
export async function apiPostLogout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ scope: 'local' }) });
  } catch {
    /* even if this fails, the redirect to sign-in is what matters */
  }
}
