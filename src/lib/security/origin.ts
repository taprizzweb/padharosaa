/**
 * CSRF defence for state-changing routes: the request must come from our own site.
 * Browsers always send Origin on cross-site and same-site POSTs; if it is missing we fall back to Referer,
 * and refuse when neither proves the request came from us.
 */
export function isAllowedOrigin(headers: Headers, appOrigin: string): boolean {
  const allowed = new URL(appOrigin).origin;
  // The page's own address counts too (same-origin check), so the site works on every address it is served from,
  // e.g. the vercel.app address and the custom domain, without a mismatch lockout.
  const hosts = [headers.get('host'), headers.get('x-forwarded-host')].filter((h): h is string => !!h);
  const sameHost = (o: string): boolean => {
    try {
      const u = new URL(o);
      return o === allowed || (hosts.includes(u.host) && (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
    } catch {
      return false;
    }
  };
  const origin = headers.get('origin');
  if (origin) return sameHost(origin);
  const referer = headers.get('referer');
  if (referer) {
    try {
      return sameHost(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

export function isJson(headers: Headers): boolean {
  const ct = headers.get('content-type') ?? '';
  return /^application\/json\s*(;|$)/i.test(ct);
}

export const MAX_BODY_BYTES = 16 * 1024;
