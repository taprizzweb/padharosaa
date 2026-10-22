/** Reads the "authenticator assurance level" from a Supabase access token: aal1 = password only, aal2 = password + second factor.
 *  Only ever call this on a token whose user was just verified with auth.getUser(); the database re-checks the same claim itself. */
export type Aal = 'aal1' | 'aal2';

export function aalFromToken(token: string | null | undefined): Aal | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const aal = (JSON.parse(json) as { aal?: string }).aal;
    return aal === 'aal2' ? 'aal2' : aal === 'aal1' ? 'aal1' : null;
  } catch {
    return null;
  }
}

/** Where to send someone who still has to complete two-step sign-in. */
export const mfaUrl = (next: string): string => `/account/mfa?next=${encodeURIComponent(next)}`;
