# Padharosaa: going live for a hotel (15 minutes)

Everything below is done from the browser. Nothing needs a developer once the app is deployed.

## One time, for Taprizz (platform admin)

1. **Vercel settings** (Environment Variables, Production). These must exist, then redeploy:
   - `PADHAROSAA_DATA_KEY` (from `openssl rand -base64 32`; keep a copy in a password manager, the guests' mobile numbers cannot be read without it)
   - `NEXT_PUBLIC_PADHAROSAA_ORIGIN` = `https://padharosaa.taprizz.in` (optional, used in guest links)
   - the usual app keys listed in `docs/PRODUCTION.md`
2. **Domains** on the Vercel project: `padharosaa.taprizz.in` (hotels) and `menu.taprizz.in` (menu app).
3. **Supabase → Authentication → Providers → Email**: turn on *Leaked password protection*.

## For each new hotel

1. Sign in at `padharosaa.taprizz.in/login` with the platform admin login and open `/admin`.
2. **Create restaurant** (name, owner email), then on its card tap **Padharosaa → Enable Padharosaa**. The guest link appears at once.
3. Hand the owner their temporary password. The owner signs in at `padharosaa.taprizz.in/login`, lands on `/owner`, and sets their own password and authenticator code.

## The owner's first 10 minutes (`/owner`)

| Step | Where | What |
| --- | --- | --- |
| 1 | **Rooms** | Type `101-110, 201-210` and tap Add rooms. |
| 2 | **Guest link and QR code** | Copy the link or download the QR image. Print one QR per room. |
| 3 | **Stay, Wi-Fi and phone numbers** | Reception phone (this makes the Call reception button appear), Wi-Fi name and password, check-out, breakfast. |
| 4 | **Colour, logo and links** | Brand colour, logo (up to 20 MB), hotel photo, Google, TripAdvisor and Instagram links. |
| 5 | **Guest home texts** | Today's offer and an information line. |
| 6 | **Team** | *Add one person* for reception, housekeeping, kitchen and managers. Give each person the one-time password. If someone forgets it, tap *Reset password* (a new one-time password appears once); a wrong email is fixed with *Change email*. |
| 7 | **Menu** | Tap *Menu (add or delete dishes)* at the top. Add dishes one by one, or *Import CSV*. To clear an old menu: *Select all dishes* then *Delete selected*, or *Delete* on a category to remove it with all its dishes. |
| 8 | **Opening and closing time** | Set when guests can send requests. After closing nothing reaches the desk until the next opening time (asking for the bill stays possible). Leave empty for all day. |
| 9 | **Jaipur guide / Buffet** | Add places and set today's buffet (both are optional). |

The "Finish setup" box at the top of the page lists whatever is still empty.

## Who opens what (three screens)

| Person | Address | Sees |
| --- | --- | --- |
| Owner | `/owner` | everything, and can make a new guest link (own password needed) |
| Manager | `/manager` | the same console; can see but not replace the guest link; can open the desk |
| Reception desk | `/desk` | **everything**: every help request of every kind, and every food order, in one list |
| Kitchen display (optional) | `/kitchen` | only if the owner ticks "We have a separate kitchen display" in Manage; then food orders also appear here |

Old addresses (`/reception`, `/housekeeping`) open the desk. The desk informs the right person (housekeeping, maintenance, kitchen) by phone, as hotels already do.
Everyone signs in at the same place, `padharosaa.taprizz.in/login`, and is sent to their page.

## Takeaway orders

The guest picks Room delivery or Takeaway in the cart. If the hotel has no room dining, the guest is told so and can take the food from the desk.
For takeaway, the **desk** taps "ready in N min". The guest sees that time and answers "I'm here now" or how many minutes they need. If the desk changes the time, the guest is asked again.

## Guest link and printed QR codes

* The link is always visible to the owner and manager on their page, and to the platform admin in `/admin` (Padharosaa button).
* Making a **new** link kills every printed QR. It needs the owner's own password and a tick on "old QR codes will stop working". Do it only if a QR leaked.

## What needs separate setup

* **WhatsApp alerts to staff** need a WhatsApp Business account, the template `padharosaa_help_alert`, the `WHATSAPP_*` settings and a scheduled call to the notify worker (see `docs/PRODUCTION.md`). Until then, the desk shows new requests with an alarm sound.
* Staff devices: tap **Turn alarm sound on** once per device (browsers require a tap).
