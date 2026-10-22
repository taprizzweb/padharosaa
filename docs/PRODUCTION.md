# Padharosaa: going live

What is built, what must be switched on, and what is still open. Read top to bottom before the first hotel.

## 1. Database (Supabase)
1. Take a backup or create a branch of `menu-prod` first. Migrations `0026` to `0033` are additive (new tables, new columns, new functions); nothing existing is dropped. Rows in `restaurants` are untouched, and `rooms` is back-filled from `restaurants.room_numbers`.
2. Apply `0026` ... `0033` in order (Supabase SQL editor, `supabase db push`, or the MCP `apply_migration`). Each file is idempotent.
3. Run `npm run check:rls` against the result: every new table must show RLS on, with no direct write grants.
4. Optional demo data: `supabase/seed/padharosaa_demo.sql` (marks rows `is_mock`; `npm run check:no-mock` fails CI if mock data could reach production).
5. Enable a hotel as the platform admin: `POST /api/padharosaa/v1/platform/hotels/<restaurant id>/enable`. The QR key is returned once; print it into the room QR codes as `https://<app>/padharosaa/<slug>?k=<key>`. Rotate with `staff/qr/rotate` (typed word ROTATE).

## 2. Environment variables (Vercel, Production)
| Variable | Needed for | How |
|---|---|---|
| `PADHAROSAA_DATA_KEY` | every Padharosaa hotel (mobile numbers, Wi-Fi password) | `openssl rand -base64 32`. **Keep a copy in a password manager: losing it makes stored numbers unreadable.** |
| `CRON_SECRET` | the alert worker | `openssl rand -base64 32` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | WhatsApp alerts to department heads | Meta WhatsApp Business Cloud API (permanent token, phone number id) |
| `WHATSAPP_HELP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | template name / language | default `padharosaa_help_alert`, `en` |
The existing menu-app variables are unchanged. Menu Lite (cafes) needs none of the new ones.

## 3. WhatsApp alerts
- Create a **Utility** template named `padharosaa_help_alert` in Meta Business Manager with three body variables: `{{1}}` room, `{{2}}` problem, `{{3}}` urgency. Example: "Guest problem in room {{1}}: {{2}} ({{3}}). Please check the Padharosaa desk."
- Guest problems are queued in `notifications` automatically (database trigger path in `padh_guest_create_help`). Nothing is sent until the worker runs.
- Run the worker every minute: `GET /api/padharosaa/v1/cron/notify` with `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends this by itself, but per-minute schedules need a Pro plan; otherwise point a free pinger (cron-job.org, UptimeRobot) at it with the header. Without the WhatsApp variables the worker does nothing and alerts wait safely in the outbox (no attempts are burnt).
- Retries: 1, 2, 4, 8 minutes, then marked `failed` after 5 attempts. Deactivated staff are suppressed. Numbers are looked up at send time, never copied into the outbox.

## 4. People
- Owner: `/padharosaa/manage` -> Team -> add many people from a CSV (name, email, department, whatsapp, head). Each gets a login with a one-time temporary password (shown once, downloadable as CSV, must be changed at first sign-in). Passwords are never stored or readable afterwards; "reset password" in `/dash/staff` makes a new one.
- Department heads get the WhatsApp for problems of their department and for reception. Every person mutes their own alerts on `/padharosaa/desk`; a manager can mute the kitchen for themself without affecting the kitchen.
- Role mapping: owner and manager see everything; every other department except kitchen signs in as "waiter" (can act on all teams); kitchen sees kitchen requests only and never sees guest phone numbers. Per-department visibility for housekeeping and maintenance is **not** built (a limitation, not a bug).

## 5. Screens
- Guest: `/padharosaa/<slug>?k=<key>` (login, home, services, help with category, stay and Wi-Fi, tracking with decline reasons, Google / TripAdvisor / Instagram, Powered by Taprizz).
- Desk: `/padharosaa/desk` (alarm sound, accept, decline with a written reason, pass, resolve, delivery or takeaway for food, personal mutes).
- Manage: `/padharosaa/manage` (offer and info boxes, Wi-Fi, colour with live contrast preview, logo and photo with crop, links, room-dining switch, team).

## 6. Not built yet (be honest with the first hotel)
- Jaipur guide, itineraries, "Plan my day", buffet automation and the places engine: the database tables and read paths exist, the editing and guest screens do not.
- Jaipur Vista, ratings invitations after checkout, push notifications, and the interim Access Layer (staff use the existing Supabase login + MFA instead).
- Guest food ordering inside Padharosaa: Dining opens the restaurant's own menu page; a Padharosaa food request (`POST requests/food`) exists for the kitchen bridge but the menu page does not call it yet.
- Realtime updates: the desk polls every 4 seconds and the guest tracker every 5 seconds.
- Crop settings are applied when the photo is saved (the browser crops it); stored zoom/offset values are not used by the guest page.
- No load test has been run. Expect fine behaviour for tens of rooms; test before hundreds.

## 7. Release checklist
`npm run lint && npm run typecheck && npm test && npm run test:api && npm run test:sql`, `npm run check:rls`, `npm run check:no-mock`, `npm run check:secret-scan`, `npm run build`. Then smoke-test on a Vercel preview with a Supabase branch: enable a hotel, log in as a guest on a phone, create a request, accept it on the desk, decline another with a reason, switch room dining off and confirm delivery disappears.
