# Padharoso — Phase 1 Discovery Report (read-only)

Date: 2026-10-22. Scope: Part 15, Phase 1. **No code or schema was changed.** Sources: spec v2 (read in full for Parts 1–7 and 15; Parts 8–14 and the appendices were not read yet), live read-only inspection of Supabase project `menu-prod`, Vercel, and this repo.

## 1. What exists

| Item | Finding |
|---|---|
| This repo (`taprizzweb/padharosaa`) | Empty: no commits, no branches other than the working branch. **The menu app source is not here.** |
| Supabase | Two projects, both `ap-south-1`: `menu-prod` (`kevapgvgalvhfjrutsmm`, the one the spec names) and `taprizz Project` (`khthtasavgtpqhesvavc`). |
| Vercel | One team, one project: `taprizz-review`. **No project for the menu app.** Spec item "locate the menu project" is unresolved. |
| `menu-prod` data | 1 restaurant, 20 categories, 165 items, 9 `dining_tables`, 12 orders, 218 audit rows. Looks like a live pilot. |

**Blocker for later phases:** the menu app's frontend/API code lives somewhere I can't see. I need its repo URL, or confirmation that Padharoso is a fresh Next.js app in this repo that talks to `menu-prod` (see Decision 1).

## 2. How `menu-prod` actually works (differs from the spec's assumptions)

1. **Tenant is `restaurants`**, with `slug`, `status`, `plan`, billing columns, `accent` (8 fixed colours), `review_url`, geo-fence, and already-present **room-service fields: `room_token` (64-hex), `room_numbers text[]` (max 300), `help_token`, `help_topics`**. `dining_tables.kind` is `'table' | 'room'`.
2. **All guest access goes through `SECURITY DEFINER` RPCs** (`guest_open_room`, `guest_place_order`, `guest_create_help`, `guest_request_by_token`, `guest_get_menu`, `guest_rate_*`, ...). Guests have no JWT and no direct table access. Tokens are per-restaurant 64-hex values passed to RPCs.
3. **Staff use Supabase Auth** (`staff.user_id -> auth.users`; roles `owner|manager|waiter|kitchen`). RLS is `restaurant_id = private.my_restaurant_id()` with helpers `private.my_role()`, `can_manage()`, `is_owner()`. Staff writes go through `mgr_*` / `staff_*` RPCs; there are **no INSERT/UPDATE policies** on orders/requests.
4. `orders.status`: `placed|preparing|ready|served|cancelled`. `order_items` snapshot name and price. Idempotency via `orders.idempotency_key`. Rate limiting is DB-side (`rate_limits`, `guest_rate_*`). `audit_log` exists with `restaurant_id`, actor, action, details.
5. Items use `price_paise`, `diet in (veg,nonveg,egg,jain)`, bilingual `name_en/name_hi`. Variants and option groups exist but are empty.
6. Existing `service_requests` (`waiter|bill`) and `help_requests` (room, topics[]) are table-session-centric and have only `open|done` states.

## 3. Reconciliation: spec vs reality

| Spec says | Reality | Proposed handling |
|---|---|---|
| Hotel = `restaurants` row | Matches; `kind` column doesn't exist on `restaurants` | Add `hotel_settings` (1:1) as in Part 5; presence of a row = hotel. No need for a `kind` column. |
| Reuse `orders`/`order_items` | Matches, but statuses are `placed/preparing/ready/served`; needs `table_id`+`session_id` (table sessions) | Create a `dining_tables` row of `kind='room'` per room and a `table_sessions` row per guest session so existing kitchen RPCs keep working; map `requests.status` onto order status. Needs your sign-off (Decision 2). |
| New `requests` table wraps/extends | `service_requests`/`help_requests` too narrow | **Wrap, don't extend**: new `requests` + `request_events`; leave old tables untouched for the existing menu app. |
| `rooms` table | Rooms are a text array on `restaurants` | New `rooms` table; backfill from `room_numbers`; keep the array in sync or deprecate. |
| Guest session via own token cookie | Existing guests use a static room token in the URL | New `guest_sessions`; QR key (`qr_key_hash`) replaces `room_token` for Padharoso only. Existing `?k=`/token links stay for the public menu (spec 7.3.10 allows this for read-only menu). |
| Staff via Interim Access Keys, no login | Staff already have real Supabase Auth logins | **Conflict, needs a decision (Decision 3).** Building IAL means a second, weaker staff path next to a working one. |
| RLS via `auth.jwt()->>'hotel_id'` claims | Existing helpers use `private.my_restaurant_id()` from `staff` table | Follow the existing helper pattern for staff; guest/IAL sessions use server-side API with narrow role, per spec's "no direct client writes". |
| RPC-free "thin service layer" | Existing app is RPC-first | Keep RPC-first for DB-side invariants (state machine, optimistic `version`), call from Next.js route handlers. |
| Cron / Edge Functions | `pg_cron` is **not** installed (no `cron` schema) | Enable `pg_cron`/`pg_net` or use Vercel Cron for buffet/alert jobs. |
| Realtime | Not yet checked which tables are in `supabase_realtime` | Verify in Phase 2; guests are anonymous so guest channels need a signed short-lived token (spec 7.4). |

## 4. Risks found

1. **Existing security advisors** (pre-existing, not caused by us): 37 `SECURITY DEFINER` functions executable by `authenticated` (all `mgr_*`/`staff_*`; presumably check role inside, must verify each does); leaked-password protection off; 7 tables RLS-on/no-policy (intentional deny-all for `plans`, `rate_limits`, `platform_admins`, `menu_events`, variants/options). Check whether `guest_*` RPCs are executable by `anon` (expected) and that `admin_*` ones are not.
2. **Admin RPCs take `p_admin uuid` as a parameter** (`admin_*`, `owner_*`): safe only if they are callable by `service_role` alone. Must verify grants before we add platform functions in the same style.
3. **Live pilot data in the same DB**: any migration touches production. Spec calls for staging; there is no staging project. Recommend a Supabase branch (`create_branch`) for all Padharoso migrations before merging.
4. **`orders` is keyed to table sessions**: forcing room orders into it couples Padharoso to menu-app invariants (`order_counter`, kitchen board RPCs).
5. Spec internal tension: Part 1 says "no third-party fonts/scripts", Vista (Part 10) and Places (Part 9) were not read yet; revisit before Phase 10/11.
6. Spec 3.5 shows `Add to room bill` as UPI/cash/card/room; existing `pay_mode` allows only `cash|upi|card`. Needs a new `room_bill` value (check-constraint change in a migration).
7. Mobile numbers are encrypted at rest in the spec (`mobile_enc`); Supabase has no built-in app-level encryption, so we need an envelope-key scheme in server code (pgsodium/Vault or app-side AES-GCM). Decide in Phase 2.

## 5. Proposed migration plan (for Phase 2, not applied)

1. Create Supabase **branch** of `menu-prod`.
2. Migration A: `hotel_settings`, `rooms` (backfill from `room_numbers`), `concierge_shifts`, `stay_codes`, `guest_sessions`.
3. Migration B: `requests`, `request_events`, `messages`, `feedback`, `consent_log`, `notifications`.
4. Migration C: `buffets`, `guide_items`, `itineraries`(+stops), `plans`(+items) — note: **name clash**: spec's `plans` collides with the existing billing `plans` table. Rename ours to `guest_plans` / `guest_plan_items`.
5. Migration D: `bookings`, `places`, `staff_access_keys` (or skip, per Decision 3).
6. RLS on every table; staff policies via existing `private.*` helpers; no client write policies; RPCs for writes; RLS test suite (two-hotel fixture).
7. Seed demo hotel flagged `is_mock`.

## 6. Component inventory (to build)

Guest PWA shell (login, chat engine, dock, cards: Stay, Services, Dining, Buffet, Guide, Help), i18n (en/hi/fr/es/de), backdrop renderer + SVG sanitiser, desk dashboard (Requests, Kitchen, Buffet, Guide, Chat, Guests, Setup), alarm/notification engine, WhatsApp/Web Push adapters, cron jobs, platform admin (hotel + backdrop + keys), Vista page, places engine, CI gates (secret scan, CSP, lint ban on `innerHTML`, RLS tests).

## 7. Estimates (rough, one developer)

Phase 2: 6–8 d; 3: 8–10 d; 4: 5 d; 5: 8–10 d; 6: 4 d; 7: 6 d; 8: 5 d; 9: 6–8 d; 10: 8–10 d; 11: 4 d; 12: 8–10 d (excl. external pen-test).

## 8. Update (owner answers)

- **Decision 1 resolved:** Padharoso lives in this repo. The menu app (`taprizzweb/menu`, a Next.js 15 app named `gotomenu`) has been copied in at the repo root so cafes and menu+help-only customers stay on the same codebase as "Menu Lite". See `docs/PRODUCT_STRUCTURE.md`.
- Menu repo findings: it already has staff login with two-step sign-in (`/account/mfa`), CI gates (`check:rls`, `check:secret-scan`, `audit`), staging docs and a threat model. This further supports skipping the Interim Access Layer (Decision 3) and reusing its security scripts.
- Still open: Decisions 2, 3, 4 below.

## 9. Decisions needed before Phase 2

1. **Where does the app live?** (a) Give me the menu app repo and I add Padharoso inside it; or (b) new Next.js app in this repo against `menu-prod`. Also which Vercel project deploys it (only `taprizz-review` exists).
2. **Food orders:** reuse `orders` via room `table_sessions` (my recommendation, keeps one kitchen board) or a separate order table for hotels.
3. **Staff access:** the spec's IAL assumes no login page, but staff already have Supabase Auth. Recommend **using existing Supabase Auth for staff now** (it already exists and is stronger) and skipping IAL, keeping the `resolveStaffIdentity()` boundary. If you want IAL anyway (e.g. shared desk PC without accounts), say so.
4. **Staging:** OK to use a Supabase branch of `menu-prod` for all migrations?
5. Spec Parts 8–14 and appendices B+ still to be read; I'll do that before Phase 2 and flag conflicts.

**Stop point:** awaiting your approval of this plan and answers to the five decisions. Nothing has been changed.
