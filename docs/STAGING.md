# Staging setup (Supabase project "menu" + Vercel project "menu")

Staging is the real thing on free plans, used to test before any restaurant depends on it. Cost: Supabase Free ₹0, Vercel Hobby ₹0.

## Supabase (done by Claude on project `yqrvnnytmipqxpkghiao`, Mumbai)
All database migrations are applied (see `supabase/migrations`). The three delete functions are in `supabase/staging/pending_delete_functions.sql` (applied by the owner in the SQL Editor).

Settings to check in the Supabase dashboard (project "menu"):
1. **Authentication → Sign In / Providers → Email**: minimum password length **12**; "Confirm email" may stay on (the app creates users already confirmed).
2. **Authentication → Multi-Factor**: **TOTP** enabled.
3. **Authentication → URL Configuration**: Site URL = your Vercel address (below).
4. Leaked-password protection and session time-boxing need a paid plan (not available on Free).

## Vercel (done by the owner, click by click)
1. https://vercel.com/dashboard → open the project **menu** → **Settings → Git**: connect GitHub repo `taprizzweb/menu`. Set **Production Branch** to `claude/affectionate-galileo-pf2tsm` for staging.
2. **Settings → General**: Framework Preset **Next.js**; Node.js 22.x.
3. **Settings → Environment Variables** (tick Production, Preview and Development for each):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://yqrvnnytmipqxpkghiao.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's **anon** key (Supabase → Project Settings → API Keys → "anon"; it is public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → **service_role** → Reveal → Copy. **Secret: paste it only into Vercel.** Mark it **Sensitive**. |
| `GUEST_COOKIE_SECRET` | any random text of 48+ characters (use a different one for production) |
| `IP_HASH_SALT` | any random text of 24+ characters (different for production) |
| `NEXT_PUBLIC_APP_ORIGIN` | the site address, e.g. `https://menu-xxxx.vercel.app` (set after the first deploy, then redeploy) |
| `SENTRY_DSN` | optional |

4. **Deployments → Redeploy** after the last variable.
5. **Settings → Deployment Protection**: for staging with real phones, make sure the production address is not behind Vercel login.
6. Open `<site>/api/health`: it should answer OK.

## Site address
The site name is **menu.taprizz.in** (CNAME `menu` → `cname.vercel-dns.com` at the DNS provider, added in Vercel under Settings → Domains). Set `NEXT_PUBLIC_APP_ORIGIN` to `https://menu.taprizz.in` (no trailing slash) and set the same value as the Site URL in Supabase → Authentication → URL Configuration. The `…vercel.app` address keeps working as a fallback.
