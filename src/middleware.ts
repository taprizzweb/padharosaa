import { AREAS } from '@/lib/padharosaa/areas';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { newNonce, securityHeaders } from '@/lib/security/csp';

// Edge-safe: only reads NEXT_PUBLIC_* values (inlined at build time). The full env check runs at boot
// in instrumentation.ts.
const PROTECTED = /^\/(staff|dash|admin|account|padharosaa\/(desk|billing|rooms|pos|rates|channels|inventory|reports|qr|manage|owner|manager|kitchen|menu|settings))(\/|$)/;
// padharosaa.<domain>: the clean role addresses are rewritten onto the real pages. '/orders' is the menu live screen (kitchen food orders).
// Every named screen has its clean address (padharosaa.<domain>/qr, /rooms, ...): made from the list of screens so a new screen can never be forgotten.
const PAD_ROUTES: Record<string, string> = {
  '/': '/padharosaa/login', '/login': '/padharosaa/login', '/orders': '/staff',
  ...Object.fromEntries(AREAS.map((a) => [`/${a}`, `/padharosaa/${a}`])),
  '/demo': '/padharosaa/demo/rambagh', '/demo/rambagh': '/padharosaa/demo/rambagh',
};

export async function middleware(request: NextRequest) {
  const nonce = newNonce();
  const requestId = crypto.randomUUID();
  const headers = securityHeaders({
    nonce,
    dev: process.env.NODE_ENV !== 'production',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://invalid.supabase.co',
    secure: (process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://').startsWith('https://'),
  });

  // Next.js reads the nonce from the request's CSP header and stamps it on its own <script> tags.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy']!);

  const decorate = (res: NextResponse) => {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    res.headers.set('x-request-id', requestId);
    return res;
  };
  // padharosaa.* is the hotel product: its front door is the Padharosaa sign-in, each role has its own address, and the menu live
  // screen is not its home. Any other host (the menu app) is untouched.
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').toLowerCase();
  let path = request.nextUrl.pathname;
  let rewriteTo: string | null = null;
  if (host.startsWith('padharosaa.')) {
    if (path === '/staff') {
      const to = request.nextUrl.clone();
      to.pathname = '/padharosaa/desk';
      return decorate(NextResponse.redirect(to));
    }
    if (path === '/reception' || path === '/housekeeping') {
      const to = request.nextUrl.clone();
      to.pathname = '/desk';
      return decorate(NextResponse.redirect(to));
    }
    const demo = /^\/try\/([a-z0-9-]{1,60})$/.exec(path);
    if (demo) { rewriteTo = `/padharosaa/try/${demo[1]}`; path = rewriteTo; }
    const target = demo ? undefined : PAD_ROUTES[path];
    if (target) {
      rewriteTo = target;
      path = target;
    }
  }
  let response = decorate(NextResponse.next({ request: { headers: requestHeaders } }));

  if (PROTECTED.test(path)) {
    // Refreshes the session cookie when needed and proves the user with Supabase (getUser, never getSession).
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
      cookieOptions: { sameSite: 'lax', secure: (process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://').startsWith('https://') },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = decorate(NextResponse.next({ request: { headers: requestHeaders } }));
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (data.user && data.user.app_metadata?.must_change_password === true && !path.startsWith('/account')) {
      // A temporary password only gets the person as far as choosing their own.
      const to = request.nextUrl.clone();
      to.pathname = '/account/password';
      to.search = '';
      const redirect = decorate(NextResponse.redirect(to));
      for (const c of response.cookies.getAll()) redirect.cookies.set(c);
      return redirect;
    }
    if (!data.user) {
      const to = request.nextUrl.clone();
      to.pathname = '/login';
      to.search = `?next=${encodeURIComponent(path)}`;
      const redirect = decorate(NextResponse.redirect(to));
      for (const c of response.cookies.getAll()) redirect.cookies.set(c);
      return redirect;
    }
  }
  if (rewriteTo) {
    const to = request.nextUrl.clone();
    to.pathname = rewriteTo;
    const rewritten = decorate(NextResponse.rewrite(to, { request: { headers: requestHeaders } }));
    for (const c of response.cookies.getAll()) rewritten.cookies.set(c);
    return rewritten;
  }
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};
