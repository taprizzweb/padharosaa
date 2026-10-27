# Padharosaa: going live

What is built, what must be switched on, and what is still open. Read top to bottom before the first hotel.

## 1. Database (Supabase)
1. Take a backup or create a branch of `menu-prod` first. Migrations `0026` to `0039` are additive (new tables, new columns, new functions); nothing existing is dropped. Rows in `restaurants` are untouched, and `rooms` is back-filled from `restaurants.room_numbers`.
2. Apply `0026` ... `0039` in order (Supabase SQL editor, `supabase db push`, or the MCP `apply_migration`). Each file is idempotent.
3. Run `npm run check:rls` against the result: every new table must show RLS on, with no direct write grants.
4. Optional demo data: `supabase/seed/padharosaa_demo.sql` (marks rows `is_mock`; `npm run check:no-mock` fails CI if mock data could reach production).
5. Enable a hotel as the platform admin: the **Padharosaa** button on the restaurant in `/admin` (or `POST /api/padharosaa/v1/platform/hotels/<restaurant id>/enable`). The guest link `https://<app>/padharosaa/<slug>?k=<key>` is kept encrypted (with `PADHAROSAA_DATA_KEY`) and can be shown again at any time: by the owner and manager in `/owner` or `/manager`, and by the platform admin in `/admin`. Making a NEW link (every printed QR stops working) is owner-only and asks for the owner's own password (the admin can do it with the admin's own password). If `PADHAROSAA_DATA_KEY` is ever replaced, create the link again (the old encrypted copy cannot be read with a new key).

## 2. Environment variables (Vercel, Production)
| Variable | Needed for | How |
|---|---|---|
| `PADHAROSAA_DATA_KEY` | every Padharosaa hotel (mobile numbers, Wi-Fi password) | `openssl rand -base64 32`. **Keep a copy in a password manager: losing it makes stored numbers unreadable.** |
| `CRON_SECRET` | the alert worker | `openssl rand -base64 32` |
| `CHANNEX_API_KEY` | the channel manager (prices and rooms out to Booking.com, MakeMyTrip, Agoda…; their bookings in) | from your Channex account (production key; use the staging key and `CHANNEX_BASE_URL` of their staging site to test first) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | buffet alerts on guests' phones | `npx web-push generate-vapid-keys`; subject is `mailto:you@yourdomain` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | WhatsApp alerts to department heads | Meta WhatsApp Business Cloud API (permanent token, phone number id) |
| `WHATSAPP_HELP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | template name / language | default `padharosaa_help_alert`, `en` |
The existing menu-app variables are unchanged. Menu Lite (cafes) needs none of the new ones.

## 3. WhatsApp alerts
- Create a **Utility** template named `padharosaa_help_alert` in Meta Business Manager with three body variables: `{{1}}` room, `{{2}}` problem, `{{3}}` urgency. Example: "Guest problem in room {{1}}: {{2}} ({{3}}). Please check the Padharosaa desk."
- Guest problems are queued in `notifications` automatically (database trigger path in `padh_guest_create_help`). Nothing is sent until the worker runs.
- Run the worker every minute: `GET /api/padharosaa/v1/cron/notify` with `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends this by itself, but per-minute schedules need a Pro plan; otherwise point a free pinger (cron-job.org, UptimeRobot) at it with the header. The same worker also sends the daily buffet reminder; while a desk is open the app sends it by itself, so the pinger is only needed for hotels where nobody has the desk open at that time. Guests on iPhone must first add the page to the Home Screen (iOS rule). Without the WhatsApp variables the worker does nothing and alerts wait safely in the outbox (no attempts are burnt).
- Retries: 1, 2, 4, 8 minutes, then marked `failed` after 5 attempts. Deactivated staff are suppressed. Numbers are looked up at send time, never copied into the outbox.

## 4. People
- Owner: `/padharosaa/manage` -> Team -> add many people from a CSV (name, email, department, whatsapp, head). Each gets a login with a one-time temporary password (shown once, downloadable as CSV, must be changed at first sign-in). Passwords are never stored or readable afterwards; "reset password" in `/dash/staff` makes a new one.
- Department heads get the WhatsApp for problems of their department and for reception. Every person mutes their own alerts on `/padharosaa/desk`; a manager can mute the kitchen for themself without affecting the kitchen.
- Visibility: owner, manager, reception and concierge see everything. A person whose department is **housekeeping** or **maintenance** sees and acts on their own team's requests only (enforced in the database: board, row-level security, every action, alert settings). Kitchen sees kitchen only and never sees guest phone numbers. Set the department in Manage -> Team (or the CSV).

## 4b. Dining (food): how it works
- Dining on the guest home shows chips: Veg / Jain plus every category of the restaurant's menu. The guest picks several, taps Show menu, and the restaurant's own menu page opens with the room already filled in, those categories selected, and a "Back to hotel" link. The same chips (several categories at once) are also on the menu page itself.
- Items keep everything the menu app already has: photos, sizes, toppings and extras, quantities, cart, order status. The order lands on the kitchen screen (`/staff`, with its buzzer) as "Room 204".
- On the kitchen screen a room order has two buttons, **Room delivery** and **Takeaway** (kitchen or manager decides; the guest sees it on their order). If the manager has switched room dining off, Room delivery is not shown and the database refuses it.
- Which menu opens: the link pasted in Manage -> "Menu link for Dining" (a separate cafe's **room-service link**, the one that asks for a room number), otherwise this hotel's own restaurant on its room-service link (enable room service in `/dash` first). Declining an order is the existing cancel-with-reason on the kitchen screen.

## 4c. Jaipur guide, day plans, buffet, feedback
- Manager (`/padharosaa/manage`): save the hotel location (stand in the hotel and tap "Use my current location"). "Find places" lists real named places within 2-10 km from OpenStreetMap (free, no key; if the map service is down it says so). Picking some adds them as **drafts**. "Write descriptions with AI" fills English and Hindi text for drafts. Nothing reaches guests until the manager reads it and presses Publish. If AI is off or fails, write the text by hand (the screen says so). Opening hours, prices, ratings and links are stripped from AI text.
- Free AI: set `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (Gemini free tier or Groq free tier both work; see `.env.example`). Without them the guide still works by hand.
- Day plans (e.g. "48-hour classic") are edited by the manager. Guests can add places or a whole day plan to **My plan** and send it to the concierge as one request (cab, tickets), or share/copy it. Directions are Google Maps links built from the hotel location (no Maps API key).
- Buffet: the manager or reception sets today and the next 7 days (hotel / outdoor / none, name, time, venue, what is served). Guests see today and the next two days.
- "How was it?" after a request is done: a good rating offers Google and TripAdvisor equally; a poor one alerts the manager. There is no review gating.
- Nothing is deleted in these tables: removing archives. Everything is checked again in SQL.

## 5. Screens
- Guest: `/padharosaa/<slug>?k=<key>` (login, home, services, Help dialog with several problem chips and a note, stay and Wi-Fi, tracking with decline reasons, Google / TripAdvisor / Instagram, Powered by Taprizz).
- Desk: `/padharosaa/desk` (alarm sound, accept, decline with a written reason, pass, resolve, delivery or takeaway for food, personal mutes).
- Manage: `/padharosaa/manage` (offer and info boxes, Wi-Fi, colour with live contrast preview, logo and photo with crop, links, room-dining switch, team).

## 6. Not built yet (be honest with the first hotel)
- Buffet reminders (WhatsApp/push before the buffet) and the Google Places ratings engine (`places` table): the tables exist, nothing fills or sends them yet.
- Jaipur Vista, post-checkout review invitations, push notifications, and the interim Access Layer (staff use the existing Supabase login + MFA instead).
- Realtime updates: the desk polls every 4 seconds and the guest tracker every 5 seconds.
- Crop settings are applied when the photo is saved (the browser crops it); stored zoom/offset values are not used by the guest page.
- No load test has been run. Expect fine behaviour for tens of rooms; test before hundreds.

## 7. Release checklist
`npm run lint && npm run typecheck && npm test && npm run test:api && npm run test:sql`, `npm run check:rls`, `npm run check:no-mock`, `npm run check:secret-scan`, `npm run build`. Then smoke-test on a Vercel preview with a Supabase branch: enable a hotel, log in as a guest on a phone, create a request, accept it on the desk, decline another with a reason, switch room dining off and confirm delivery disappears.

## 8. How migrations 0026-0038 were applied to menu-prod
They were applied with the Supabase SQL tool in small pieces (the tool times out on statements containing DROP, so the three DROP lines became `alter policy` / a `revoke`, and SQL comments were left out). They are **not** in the Supabase migration history table. After applying, every `padh_*` function was compared (hash of its definition, comments ignored) against the database built from the repo files used by the tests: all identical. To re-check later, run the same comparison. The repo files stay the source of truth.

## 9. Deploying on Vercel (about 5 minutes)
1. Vercel -> Add New -> Project -> import `taprizzweb/padharosaa` (production branch: the one that has this code), framework Next.js, no other settings.
2. Environment Variables (Production):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://kevapgvgalvhfjrutsmm.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the project's anon (or publishable) key (Supabase -> Project Settings -> API)
   - `SUPABASE_SERVICE_ROLE_KEY` = Supabase -> Project Settings -> API -> service_role (secret; never in the browser)
   - `NEXT_PUBLIC_APP_ORIGIN` = the exact final address, e.g. `https://padharosaa.vercel.app` (or your own domain). It must match exactly or every POST is refused.
   - `GUEST_COOKIE_SECRET` = `openssl rand -base64 48`, `IP_HASH_SALT` = `openssl rand -base64 24`
   - `PADHAROSAA_DATA_KEY` = `openssl rand -base64 32` (keep a copy outside Vercel; losing it makes stored guest numbers unreadable)
   - optional: `CRON_SECRET`, `WHATSAPP_*`, `AI_*` (see `.env.example`)
3. Deploy. Check `https://<address>/api/health` returns `{"ok":true}`.
4. Enable the hotel: sign in as the platform admin, call `POST /api/padharosaa/v1/platform/hotels/<restaurant id>/enable`; print the QR key into the room QR links.
5. Supabase -> Authentication -> URL configuration: set Site URL to the same address. Turn on "Leaked password protection".
