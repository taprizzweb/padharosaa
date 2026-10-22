# Threat model

Plain-language list of what can go wrong, what stops it, where it is tested, and what risk remains. "Tested" points at a real test in this repo.
Actors: **guest** (anyone with a phone at a table), **outsider** (anyone on the internet), **staff** (waiter / kitchen), **manager / owner**, **platform admin** (you), **insider** (a staff member behaving badly).

## 1. Fake orders (a guest or outsider floods the kitchen)
- **Stops it:** an order needs a valid table QR token. Limits per table: 3 un-accepted orders at once, 8 per 10 minutes, 25 lines, 10 of one dish, ₹15,000 total. 60 orders per 10 minutes per IP address (hashed). Each order carries a one-time idempotency key, so retries never double-order. Staff can cancel with a reason and close a table.
- **Tested:** `supabase/tests/place_order.test.ts` (caps, replay, races), `tests/api/guest.test.ts`.
- **Remaining risk:** someone physically at the café can still place a few joke orders (the limits keep it small, staff see the table number). Accepted.

## 2. QR code photographed and used from home
- **Stops it:** a table's QR token only opens that table. Wrong tokens are counted (20 per address per 10 minutes) and blocked. Rotating a QR code ("New QR") kills every old copy at once; a session is closed when staff close the table.
- **Tested:** `supabase/tests/security.test.ts`, `tests/e2e/dashboard.spec.ts` (rotation).
- **Remaining risk:** a photo of a *current* QR works until the QR is rotated. Mitigation: orders still land on that table and staff see them; rotate the QR if it leaks (`docs/RUNBOOK.md` in Phase 6). Accepted.

### 2b. Room-service link (migration 0022)
- **How it works:** one shared link per restaurant (`restaurants.room_token`, 256-bit) can only *open a room*; it cannot place an order. The guest's room number turns it into that room's own table link, after which every normal rule applies (prices from the database, pending-order cap, rate limits, location rule, suspension).
- **Stops it:** an optional owner-defined room list (unknown numbers refused), room numbers limited to 10 safe characters, at most 500 rooms ever created on demand, 40 room lookups per address per 10 minutes, wrong-link guesses counted with the other token guesses, "New link" kills every old copy, turning it off erases the token.
- **Tested:** `supabase/tests/rooms.test.ts`, `tests/api/guest.test.ts`, `tests/e2e/guest.spec.ts`, `tests/e2e/dashboard.spec.ts`.
- **Remaining risk:** anyone holding the link can order to any room number on the list (a prank). Orders still go to staff first, who see the room and the dishes; staff can cancel with a reason. A room PIN or guest name is a possible later step. Accepted.

### 2c. Call for problems (migration 0025)
- **How it works:** one shared link (`restaurants.help_token`, 256-bit) lets a guest post a problem; it cannot read anything. Topics must come from the owner's list, the room number is checked against the owner's room list when there is one, and the note is plain text (max 300), always rendered as text.
- **Stops it:** 20 sends per address per 10 minutes, wrong-link guesses counted with other token guesses, at most 3 open problems per room and 300 per restaurant, an identical message within 10 minutes is the same request, "New link" kills every old copy, turning it off erases the token, only reception staff (not the kitchen) can read or close problems, and other restaurants never see them.
- **Tested:** `supabase/tests/help.test.ts`, `tests/api/{guest,staff,dash}.test.ts`, `tests/e2e/{guest,staff,dashboard}.spec.ts`.
- **Remaining risk:** anyone with the link can raise a false problem for a room (a prank). Reception sees the room and the text and can simply tap Done; the caps keep it from flooding the screen. Accepted.

### 3a. Sizes and options (migration 0024)
- Size and option ids are the only things the browser sends. The database finds the size price and extra prices itself, refuses ids that belong to another dish or restaurant, repeated options, more than the allowed number in a group, a missing required choice, a size on a dish without sizes, and sold-out sizes; all inside the same transaction that locks the prices it read.
- **Tested:** `supabase/tests/choices.test.ts`, `tests/api/guest.test.ts`, `tests/e2e/guest.spec.ts`.

## 3. Price tampering
- **Stops it:** the browser only sends dish ids and quantities. Prices, availability and totals come from the database at order time; a changed menu price never alters an existing order (each order stores its own price snapshot).
- **Tested:** `supabase/tests/place_order.test.ts`, `tests/api/guest.test.ts`.
- **Remaining risk:** none known.

## 4. IDOR (reading or changing another person's / restaurant's data by guessing ids)
- **Stops it:** every table has a `restaurant_id` and row-level security; related rows are linked with `(id, restaurant_id)` pairs so a row can never point into another restaurant. Staff and dashboard calls run as the signed-in user, never with the service key. Guests have no database access except through a few functions that check the table token.
- **Tested:** `supabase/tests/security.test.ts` (two restaurants, every table, every role), `tests/api/dash.test.ts` ("data stays inside its restaurant"), `npm run check:rls` in CI.
- **Remaining risk:** none known.

## 5. XSS (script injection through dish names, notes, restaurant names)
- **Stops it:** React escapes all text; there is no `dangerouslySetInnerHTML`. A strict Content-Security-Policy with a per-request nonce blocks inline and foreign scripts. Inputs are length-limited and control characters are removed. CSV import/export protects against spreadsheet formula injection.
- **Tested:** `tests/http/headers.test.ts`, `tests/unit/csv.test.ts`, e2e scans.
- **Remaining risk:** a browser bug in CSP handling. Accepted.

## 6. CSRF (another website makes a staff member's browser change things)
- **Stops it:** every write is a POST that must come from our own origin, as JSON, under 16 KB; the guest cookie is signed and HttpOnly; staff session cookies are `SameSite=Lax` and `Secure` (not HttpOnly, because the live screen's browser connection needs the token; the strict CSP in section 5 is what protects them).
- **Tested:** the "foreign origin" cases in `tests/api/*.test.ts`.
- **Remaining risk:** none known.

## 7. Brute force and account takeover
- **Stops it:** sign-in is limited (20 failures per address, 8 per account per window) and every failure looks the same (no way to learn which emails exist). Passwords need 12+ characters. Restaurant owners and managers sign in with email + password only (owner decision, so clients are not asked to install an app); the platform admin also uses email + password only (owner decision). Authenticator support exists in the code and can be switched back on. Temporary passwords are random, shown once, and must be replaced at first sign-in. "Sign out of all devices" exists. Deactivated staff stop working immediately.
- **Tested:** `tests/api/mfa_admin.test.ts`, `supabase/tests/mfa.test.ts` (restaurant staff work with a password-only session; strangers and waiters still refused), `tests/e2e/admin.spec.ts` (owners get 404 on /admin), `tests/e2e/staff.spec.ts`.
- **Remaining risk (accepted by the owner):** a stolen or guessed password gives full access to that restaurant's owner or manager account, including menu, prices, staff and settings. Mitigations: 12+ character passwords, failure throttling, an append-only activity log, and the platform admin can suspend a restaurant at once. Turn on Supabase's "leaked password" check and session time-boxing when on a paid plan (see `docs/ADMIN.md`). An optional authenticator step for owners can be added later if a client asks for it.

## 8. Tenant leakage (restaurant A sees restaurant B)
- Same controls and tests as IDOR. Additionally: reports and the audit log filter by the caller's restaurant inside the SQL function; the photo bucket only allows uploads to the caller's own folder.
- **Remaining risk:** photos are public-read by URL (needed so guests can see dishes); the URL contains an unguessable id. Accepted.

## 9. Insider abuse
- **Stops it:** roles are enforced in the database (waiter/kitchen cannot touch menu, prices, staff, settings; only owners manage staff; managers cannot change settings). Every change to prices, menu, tables, staff, settings, cancellations and table closures is written to an append-only audit log that nobody (not even the owner) can edit or delete; the platform admin's own actions are logged too.
- **Tested:** `supabase/tests/audit_admin_storage.test.ts`, `supabase/tests/dashboard.test.ts`.
- **Remaining risk:** an owner or manager can legitimately do harm to their own restaurant (e.g. a manager lowering prices). It is visible in the activity log. A waiter can still cancel orders (logged with reason). Accepted.

## 10. Denial of service
- **Stops it:** Vercel absorbs raw network floods. Per-address and per-table limits on guest actions; failure-only limits on sign-in and QR guesses; request body cap; small responses. Public pages are small (guest menu about 118 KB of JavaScript).
- **Remaining risk:** a determined distributed flood can still slow the site or run up the free-tier limits; Vercel's firewall and Supabase's limits are the backstop. Monitor with the uptime check (Phase 6). Accepted.

## 11. Platform admin (you) and the service key
- **Stops it:** `/admin` and `/api/admin/*` need: a signed-in user, their own password, and a row in the platform-admins table; anyone else gets an ordinary "not found" page. The service-role key lives only in server environment variables (a CI check greps the browser bundle for it). Destructive actions need the restaurant's address typed exactly. Each admin action is audit-logged.
- **Remaining risk:** if your own password is compromised the attacker has full control. Use a very long unique password; consider switching the authenticator back on for the admin (small code change). Accepted.

## 12. Privacy
- Guests: no name, phone or email is collected; an IP address is stored only as a salted hash used for limits. Staff: email and display name only. A restaurant's data can be exported and permanently deleted from `/admin`. The privacy notice at `/privacy` must be reviewed by the owner (it is not legal advice).

## 13. Error reporting and logs
- Users only see a generic message plus a request id. Logs are structured and redact keys that look secret. Optional Sentry reporting is server-side only and strips emails, ids, tokens and phone numbers (`tests/unit/monitoring.test.ts`). Errors that happen inside a visitor's browser are not reported (accepted; the browser bundle stays free of third-party code).

## What is not yet verified
Checks that need the real Supabase project (Phase 6): the real Auth rules (password strength, leaked-password check, session lifetime), real TOTP enrolment, real Storage policies, Realtime. The local stand-in enforces the same rules but is not the real service.
