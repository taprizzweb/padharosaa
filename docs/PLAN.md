# GoToMenu — Build Plan (v1)

Status: DRAFT for owner approval. No application code has been written yet.

## 0. What I need from you before Phase 1 / what costs money

Nothing is created until you say "go". When we reach each step I will give click-by-click instructions.

| Item | Needed when | Who | Approx. monthly cost |
|---|---|---|---|
| GitHub repo (this one, `taprizzweb/menu`) | now | already exists | free |
| Supabase **staging** project (Mumbai, ap-south-1) | Phase 6 | you create, I guide | Free tier ₹0 (pauses after 1 week idle, no backups) |
| Supabase **production** project (Mumbai) | Phase 6 | you create | **Pro ≈ US$25 (~₹2,100)/month** — required for daily backups, no auto-pause, and leaked-password protection. Point-in-time recovery is a further add-on (~US$100/month); only for large clients. |
| Vercel project | Phase 6 | you create | Hobby is free but its terms forbid commercial use. **Pro ≈ US$20 (~₹1,700)/month per seat** is what you need for a paid product. |
| Domain `gotomenu.taprizz.in` | Phase 6 | you add one DNS record at the place you manage `taprizz.in` | ₹0 (subdomain of a domain you own) |
| Sentry (error tracking) | Phase 5 | you create | Free tier (5k events/month) is enough to start |
| Uptime monitor (UptimeRobot or similar) | Phase 6 | you create | Free tier |

**Pilot model (owner decision):** the first ~50 restaurants get the product free as a gift, using the owner's separate Supabase account. So for the pilot the plan is Supabase Free + Vercel Hobby = ₹0/month. Known limits of that choice, to be re-checked before real restaurants depend on it:
- Supabase Free **auto-pauses after 7 days of no activity** (a quiet restaurant would find its menu down) and has **no backups**. Leaked-password protection is a paid-plan feature, so it will be off.
- Vercel Hobby terms say personal, non-commercial use only. A free gift to businesses is a grey area; Vercel may disagree. Pro (about US$20/month) removes the doubt.
- Free database compute is small; the 300-guest load test may not reach p95 < 500 ms there.
Recommendation: build and test on free; before the first real restaurant goes live, move only the production Supabase project to Pro (about US$25 / ₹2,100 a month) for backups and no auto-pause. I will not do this without your approval.

Until Phase 6 everything runs on a throwaway local Postgres inside my work environment. It costs nothing and touches no real data.

## 1. Architecture (text diagram)

```
  Guest phone (no login)                  Staff tablet/phone                 You (platform admin)
        |                                        |                                   |
        | HTTPS                                  | HTTPS                             | HTTPS (+2FA)
        v                                        v                                   v
  +--------------------------------------------------------------------------------------------+
  |  Vercel (bom1, Mumbai) — Next.js 15 App Router                                             |
  |  middleware: nonce-CSP + security headers, auth/AAL2 gate for /staff /dash /admin          |
  |                                                                                            |
  |  /[slug]            server-rendered menu (RSC)  --calls--> server-only data layer          |
  |  /api/guest/*       route handlers: origin check, zod, rate limit, signed cookie           |
  |  /staff, /dash      authenticated pages (user JWT, cookie session via @supabase/ssr)      |
  |  /admin             server actions, re-verify platform_admin + AAL2 on every call          |
  +-----------+------------------------------------+-------------------------------+-----------+
              | service_role key (server only)      | user JWT (RLS applies)        | service_role
              | calls guest_* SECURITY DEFINER fns  | staff RPCs + RLS reads        | admin_* fns
              v                                     v                               v
  +--------------------------------------------------------------------------------------------+
  |  Supabase Mumbai: Postgres (RLS on every table, grants revoked by default)                 |
  |   - guest_* functions: executable by service_role ONLY                                     |
  |   - staff_* functions: executable by authenticated, role check inside                      |
  |   - Auth (email+password, TOTP)   - Storage (menu-images, public read)   - Realtime        |
  +--------------------------------------------------------------------------------------------+
        ^ Realtime (RLS-filtered) + 5s polling fallback -> staff screens only
        Guests only poll `/api/guest/status` (no realtime for anonymous users)
```

Key rules this encodes:
- Guests never hold any database credential. Browser → our route handler → SQL function.
- Staff browsers do hold a user JWT, but can only **read** rows of their own restaurant (RLS) and **change** state through role-checked RPCs.
- The service-role key lives only in server env vars, imported only from files marked `server-only`.

## 2. Folder structure

```
.github/workflows/ci.yml
docs/  PLAN.md THREAT_MODEL.md DEPENDENCIES.md RUNBOOK.md DEPLOYMENT.md PRIVACY_NOTES.md PERFORMANCE.md
supabase/
  migrations/  0001_baseline_privileges.sql 0002_core_tables.sql 0003_rls.sql ...
  seed/        seed.ts (two demo restaurants)
  tests/       *.sql.test.ts + helpers (real Postgres harness)
scripts/       check-rls.ts  check-bundle-secrets.ts  secret-scan.sh  loadtest.js
src/
  middleware.ts
  env.ts                    (zod-validated env, server and public split)
  app/
    [slug]/                 guest menu, cart, status, thank-you
    api/guest/...           guest route handlers
    api/health/route.ts
    staff/                  live board, sold-out list
    dash/                   owner/manager dashboard
    admin/                  platform admin
    login/ auth/ privacy/
  lib/
    supabase/ (server.ts, admin.ts [server-only], browser.ts)
    security/ (origin.ts, csp.ts, cookie.ts, ratelimit.ts, errors.ts)
    money.ts  i18n/ (en.ts, hi.ts)  schemas/ (zod)
  components/
tests/ unit/  api/  e2e/
vercel.json  .env.example  package.json (exact pins)
```

## 3. Database schema outline

All money = integer paise. All business tables carry `restaurant_id`, have RLS enabled and forced. Every FK is indexed. `CHECK` constraints on lengths/ranges.

| Table | Key columns and constraints |
|---|---|
| `restaurants` | id, slug (unique, regex `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`, not in reserved list), name, status (active\|suspended), plan, paid_until, review_url (https only), accent (from fixed palette keys), order_counter, thresholds for amber/red waiting time, created_at |
| `platform_admins` | user_id |
| `staff` | user_id, restaurant_id, role (owner\|manager\|waiter\|kitchen), display_name, active. One restaurant per user in v1. |
| `categories` | restaurant_id, name_en, name_hi, sort_order, active |
| `items` | restaurant_id, category_id, name_en/hi, description_en/hi, price_paise ≥0 (and ≤ cap), diet, spice 0–3, image_path, is_available, is_bestseller, is_chef_pick, sort_order |
| `dining_tables` | restaurant_id, label (unique per restaurant), qr_token (unique, 128-bit random), active. `qr_token` column is NOT granted to staff; read only via owner/manager RPC. |
| `table_sessions` | restaurant_id, table_id, opened_at, closed_at, closed_by, pay_mode, bill_requested_at. **Unique partial index** on table_id where closed_at is null. |
| `orders` | restaurant_id, session_id, table_id, order_no, status, note, total_paise, idempotency_key (unique per session), placed/preparing/ready/served/cancelled timestamps, cancel_reason. Unique (restaurant_id, order_no). |
| `order_items` | order_id, restaurant_id, item_id (nullable, on delete set null), name_en/hi snapshots, unit_price_paise, qty 1–20, note |
| `service_requests` | restaurant_id, table_id, session_id, type (waiter\|bill), reason (fixed list), pay_mode (required for bill), status, resolved_by/at. **Unique partial index** (session_id, type) where status='open'. |
| `review_clicks` | restaurant_id, session_id, created_at |
| `audit_log` | restaurant_id (nullable for platform actions), actor_user_id, actor_role, action, entity, entity_id, details jsonb, created_at. UPDATE/DELETE revoked **and** blocked by trigger. |
| `rate_limits` | key (hashed), window_start, count. Atomic upsert; old rows purged by a scheduled cleanup. |

Hot-query indexes: `orders(restaurant_id, status, placed_at)`, `orders(session_id)`, `service_requests(restaurant_id, status)`, `table_sessions(restaurant_id, closed_at)`, `items(restaurant_id, category_id, sort_order)`, `audit_log(restaurant_id, created_at desc)`.

### Privileges (Migration 0001)
`REVOKE ALL` on all tables/sequences/functions in `public` from `anon`, `authenticated`, `PUBLIC`; `ALTER DEFAULT PRIVILEGES` so new objects are not auto-granted; then grant back only: `SELECT` (column-level where needed) to `authenticated` on tenant tables, and `EXECUTE` on specific functions. `anon` gets nothing in `public`.

### Functions (all `SECURITY DEFINER`, `SET search_path = ''`, fully qualified names)
Guest (service_role only): `guest_get_menu`, `guest_place_order`, `guest_get_session_status`, `guest_create_request` (waiter/bill, idempotent), `guest_update_bill_mode`, `guest_record_review_click`, `rl_hit` (rate limiter).
Staff (authenticated; role checked inside; restaurant must be active): `staff_set_order_status`, `staff_cancel_order`, `staff_resolve_request`, `staff_close_session`, `staff_set_item_availability`.
Owner/manager: `mgr_get_table_tokens`, `mgr_rotate_table_token`, `mgr_create_tables`, item/category/table/settings writes (RPCs that also write audit rows), `mgr_import_items`.
Platform admin (service_role only, called from server code after admin+AAL2 check): `admin_create_restaurant`, `admin_set_status`, `admin_set_plan`, `admin_export_restaurant`, `admin_delete_restaurant`.
Helper: `private.current_staff()` returns (restaurant_id, role) for `auth.uid()`; used by every policy. Placed in a non-exposed `private` schema.

**Order state machine** (enforced in `staff_set_order_status`): placed→preparing→ready→served; cancel from placed/preparing only, by owner/manager/waiter, with a reason. Kitchen: advance only. Anything else raises a named error code.

**`place_order`**: one transaction — lock restaurant row, check active (and not past paid_until? see Open Question 3), validate table token, find-or-create the open session, check session not closed, load prices from `items`, reject unavailable/foreign/duplicate ids, enforce caps (max items/order, max qty, max total, max pending per table, max orders per table per 10 min), per-restaurant counter → `order_no`, insert order + items with snapshots, idempotent on (session, key). Returns order id, number, total, session id.

## 4. API route list

Guest (`/api/guest/…`, all POST/GET with origin check, JSON only, body limit 16 KB, zod, rate limit):
- `POST /api/guest/order` — place order (token + items + notes + idempotency key)
- `GET  /api/guest/status` — session status + orders + requests (requires signed cookie)
- `POST /api/guest/request` — call waiter (reason) or ask bill (pay_mode)
- `POST /api/guest/request/mode` — change payment mode while bill request open
- `GET  /api/guest/review?…` — records click, 302 to review_url (https only)
- `GET  /api/health` — DB ping, no secrets

Pages: `/[slug]` (menu, server-rendered), `/privacy`, `/login`, `/auth/mfa/enroll`, `/auth/mfa/verify`, `/staff`, `/staff/soldout`, `/dash/{menu,tables,qr-sheet,staff,settings,report,audit}`, `/admin/*`.

Staff/dash writes use server actions or route handlers that call the RPCs with the user's JWT (never service role). Admin actions use service role after re-verifying admin row + AAL2.

## 5. Phase plan (each ends green + commit + plain-English summary)

1. **Foundation**: tooling, pinned deps, strict TS/ESLint (warnings fail), env validation, CSP/security-header middleware + header test, CI workflow, ALL migrations + storage policies, real-Postgres test harness and the full SQL suite, RLS-coverage check.
2. **Guest**: routes + UI + unit/API tests + bundle-size measurement.
3. **Staff screen**: board, alerts/sound, wake-lock, realtime + polling fallback, PWA, tests.
4. **Dashboard**: menu manager, CSV, tables/QR sheet, staff accounts, settings, report, audit viewer.
5. **Admin + hardening**: admin panel, TOTP/AAL2 enforcement, Sentry with scrubbing, threat model, dependency doc, `npm audit`.
6. **Verification + launch**: Playwright e2e (mobile + tablet) + axe scan, k6/autocannon load test, Lighthouse, runbook/deployment docs, staging deploy, then production only after your approval. Seed script (two demo restaurants, 40+ Indian dishes with Hindi names, all four roles) is built in Phase 1 (data) and extended as features land.

## 6. Risks and honest limits

1. **Cannot fully test against real Supabase until Phase 6.** I'll test against local Postgres with stubbed `auth` schema and roles. Supabase-specific behaviour (Auth MFA, Realtime, Storage policies, leaked-password setting) can only be proven on your staging project. I will state clearly what was and wasn't proven.
2. **Fake orders**: anyone physically holding the QR can order. Controls (rotatable token, rate limits, caps, "not yet accepted" state, session close) limit damage but cannot eliminate it. Documented in the threat model.
3. **Guest identity**: cookie-based; clearing it loses the order-status view until they scan again (we handle by re-issuing access when the QR is scanned with an open session only after they place an order — see Open Question 2).
4. **Load target (300 guests, p95 <500 ms)** depends on Supabase compute size; Pro default may need an upgrade. I'll measure and report.
5. **Lighthouse ≥90 and <200 KB JS** are strict; I'll keep the menu route to a minimal client island and report real numbers.
6. **Environment**: my work container may not allow a full browser install/Playwright against real services; if something can't run here I'll say so rather than claim it.
7. **Scope**: PWA offline support is limited to installability and an offline banner; no offline ordering.

## 7. Decisions I'm making by default (tell me if you disagree)

- Staff and admin use separate sets of routes; a user belongs to exactly one restaurant.
- Waiting-time thresholds default 5 min amber / 10 min red, configurable per restaurant.
- Guest cookie lasts 12 hours; thank-you state shown for 30 minutes after the table is closed.
- Accent palette: 8 pre-checked colours, each verified for AA contrast on white.
- Rate limits default: 30 menu loads/min per IP, 6 orders/10 min per table, max 25 items per order, qty ≤ 10 per item (DB allows 20), max order ₹15,000, max 3 un-accepted orders per table.
- Sentry free tier, with all user text and IPs scrubbed.
- Order numbers reset never; they count up per restaurant (shown as e.g. #128).

## 8. Open questions for you (answer only the ones you care about; defaults above apply otherwise)

1. **Stack contradiction to confirm**: you said Tailwind CSS 3 with Next 15 / React 19 — fine, I'll pin those. Okay to use Node 22 LTS?
2. If a guest clears cookies mid-meal, re-scanning the QR cannot prove they are the same person. I propose: re-scan shows the menu and the table's current open orders (read-only, no personal data) but only the original device can change payment mode. OK?
3. When `paid_until` passes, should the restaurant be auto-blocked, or only warned (you suspend manually)? I recommend **warn for 7 days, then you suspend manually** so a late payment never kills a Saturday night automatically.
4. Hindi item names for your demo seed data: I will write them; you should review them before showing clients.
5. Currency/GST: prices shown as entered (tax-inclusive assumed, no GST breakdown, per scope). Confirm.

---
Reply **"go"** (with any answers/changes) and I will start Phase 1.


---

## Changes made while building Phase 1 (honest log)

- **Merged functions:** `staff_cancel_order` is part of `staff_set_order_status` (cancel is a status, kitchen is refused inside it).
  `guest_update_bill_mode` is not needed: asking for the bill again with a different payment mode updates the open request,
  so the route `POST /api/guest/request/mode` is dropped.
- **New functions:** `mgr_get_table_tokens`, `mgr_rotate_table_token`, `mgr_create_tables` (owner/manager), `guest_rate_limit`
  (used by routes before ordering), `guest_health`, `guest_purge_rate_limits`, and `admin_*` (create, status, plan, list, audit, export, delete).
- **Rate limiting design (found by a test):** a failed call rolls back its own counter, so failed attempts (e.g. guessing QR tokens)
  are throttled by the route handler through `guest_rate_limit`, which commits on its own. Inside `guest_place_order` the per-IP cap
  counts successful orders only (60 per 10 minutes, generous because many guests share one cafe wifi address).
- **Deadlock fixed (found by a stress test):** closing a table while a guest orders used to deadlock in about 1 of 6 races.
  The restaurant row is now locked with `FOR NO KEY UPDATE`. 300 further racing pairs: zero deadlocks.
- **Every page is rendered per request** (required so the security nonce reaches the page scripts); found by the header test.
- **Production build refuses to run with missing/invalid settings**, so a bad configuration can never replace a working site.
- **Dependency audit:** production dependencies have 0 known vulnerabilities; remaining dev-only findings are listed in `docs/DEPENDENCIES.md`.
- **Seed script** (two demo restaurants, 40+ dishes with Hindi names) moves to Phase 2, where the UI exists to show it. The SQL tests already
  use two fully populated restaurants with all four roles.
- Staff-account creation/deactivation functions (`owner` only) arrive with the dashboard in Phase 4.

## Changes made while building Phases 2-3
- **English only** (owner decision): Hindi UI, Hindi privacy text and Hindi demo names removed. The database still has the unused `name_hi` / `description_hi` columns; they are harmless and can be dropped later.
- **Throttling counts failures, not traffic** (found by a test): many honest guests share one cafe wifi address, so only wrong QR tokens (20 per address per 10 min) and failed sign-ins (20 per address, 8 per account) are counted. Migration 0012 adds `guest_rate_check` / `guest_rate_hit`.
- **Staff reads go through three SQL functions** (`staff_me`, `staff_get_board`, `staff_list_items`, migration 0011) instead of direct table reads, and all staff actions go through server routes that call the existing role-checked SQL functions with the signed-in user's token.
- **Local test stack now emulates Supabase login** (email + password, signed tokens) so the real sign-in flow is tested in a browser. Realtime is not emulated (polling covers it).
- Bulk availability is capped at 300 dishes per request (fits the 16 KB request limit).

## Changes made while building Phase 4
- **Dashboard writes all go through role-checked SQL functions** (migration 0013, `mgr_*`); owner-only actions (settings, staff accounts) are enforced in the database as well as the screen. Managers can open every page; they can edit the menu and tables but only view settings and staff.
- **Staff accounts use temporary passwords** (shown once, never stored by us). `app_metadata.must_change_password` is set by the server only; middleware, the staff API and the dashboard all refuse everything except "choose your own password" until it is cleared.
- **Photos** are resized in the browser to at most 1600 px and saved as WebP, then uploaded straight to the `menu-images` bucket (folder = restaurant id; the storage policies from 0007 decide who may upload).
- **CSV import is all-or-nothing**: every row is checked in the browser (preview with row numbers) and again in the database; one bad row means nothing is changed. Export protects text a spreadsheet could run as a formula.
- **QR codes** are drawn on the server as SVG. Print layouts: A4 sheet (6 per page) and table tents (A4 landscape, two mirrored halves that fold into a tent).
- **Fix from Phase 3 review:** the guest bill sheet now shows a newly chosen payment method at once instead of after the next refresh.
- Not yet verifiable here (needs the real Supabase project in Phase 6): Auth rules for passwords (leaked-password check), real Storage policies, Realtime.

## Changes made while building Phase 5
- **Second factor is enforced in the database, not only in the screens** (migration 0014): an owner or manager session that has not completed the authenticator step is "nobody" to every policy and every SQL function (error GM021 `mfa_required`). Waiters and kitchen staff are exempt by design. `supabase/tests/mfa.test.ts` was mutation-checked (turning the check off makes five tests fail).
- **Two-step pages and routes** (`/account/mfa`, `/api/auth/mfa/enroll|verify`): setup with QR + typed key, 5 wrong codes per 10 minutes then a block. Middleware sends anyone without it away from `/dash` and `/admin`; `/staff` decides by role.
- **Platform admin** (`/admin`, `/api/admin/*`): create restaurant + owner login (temporary password once, forced change, then forced authenticator setup), suspend/activate, plan and paid-until, last-activity list, any restaurant's activity log, JSON export, delete with typed confirmation (also removes staff logins and photos). Non-admins get a plain "not found". Admins sign in through the normal login page (they have no restaurant). First admin: `docs/ADMIN.md`.
- **Error reporting without an SDK**: a small server-side Sentry reporter (nothing sent unless `SENTRY_DSN` is set; emails, ids, tokens, phone numbers scrubbed; max 20 events a minute). Browser-side errors are not reported (keeps third-party code out of the browser).
- **Hardening:** staff session cookies are now explicitly `SameSite=Lax` and `Secure` on https. Threat model written: `docs/THREAT_MODEL.md`.
- **Test-stand-in additions:** local Auth now emulates TOTP factors, aal1/aal2 tokens and the admin API. Real Supabase TOTP, leaked-password check and session time-boxing are only verifiable on staging (Phase 6).

## Change after Phase 5 (owner decision)
- **Restaurant owners and managers now sign in with email + password only** (migration 0015 removes the authenticator requirement from the database; the dashboard and staff pages no longer redirect to it). Reason: clients should not have to install an app. **The platform admin still needs the authenticator code** (`/admin`, `/api/admin/*`). The threat model and `docs/ADMIN.md` say so. The security cost is real: a stolen owner password now opens that restaurant's dashboard.
