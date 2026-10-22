# Platform admin (Phase 5)

## Who needs two-step sign-in
| Account | Authenticator app required? |
|---|---|
| Platform admin (you) | No: email + password only (owner decision) |
| Restaurant owner, manager, waiter, kitchen | No: email + password only (owner decision, migration 0015) |

Nobody is asked for an authenticator code (owner decision). `/admin` still shows an ordinary "not found" page to anyone who is not listed as a platform admin. The authenticator code is still supported by the code (`/account/mfa`) and can be switched back on later if wanted.

## Create the first platform admin (one time, on the real Supabase project)
1. In the Supabase dashboard open **Authentication → Users → Add user → Create new user**. Enter your email and a long password. Tick **Auto Confirm User**.
2. Open **SQL Editor → New query**, paste the following (use the same email), and click **Run**:
   `insert into public.platform_admins (user_id) select id from auth.users where email = 'YOU@EXAMPLE.COM';`
3. Go to `https://menu.taprizz.in/login` and sign in. You land on `/admin`.

## What you can do in /admin
Create a restaurant and its owner login (a temporary password is shown once), set plan and paid-until date, suspend / activate (a suspended restaurant cannot take orders and its staff cannot change anything), see last order time and total orders, read any restaurant's activity log, download all of a restaurant's data as JSON, and permanently delete a restaurant (you must type its address exactly; its staff logins and photos are removed too).

## Add an owner, manager, waiter or kitchen login
In `/admin` open the restaurant, tap **Logins**, then **Add login**. Enter name, email and role. A temporary password is shown once; give it to the person, who chooses their own at first sign-in. Use this to give a restaurant (such as one whose owner login was lost) a new owner.

## Plans, prices and end dates
- **Plans** (top menu): write your own plans: name, points (one per line), setup fee, monthly and yearly price. Nothing is fixed in code. A plan in use cannot be deleted; switch it off instead.
- **Plan & dates** on a restaurant: pick a plan (its prices fill in, you can change them for this client), billing period, start and end date, quick buttons (+1 month … +1 year, no end date), a private note, and "Pause the menu automatically after the end date" with grace days.
- Cards show price, setup fee and how long is left (amber when 15 days or fewer, red when ended). Owners and managers see a banner in their dashboard in the same cases.
- Automatic pause: after the end date plus grace days the public menu shows "not taking orders" and ordering is refused. The owner can still log in. Move the end date to renew.
- **Rename** a restaurant (name only; the web address and printed QR codes stay valid) or a login (name). **Duplicate** copies look, categories, dishes and photos into a new restaurant with its own owner; tables, QR codes, orders, staff, plan and dates are not copied. **Delete** permanently removes a restaurant after you type its address.

## Owner forgot the password, or the email is wrong
In `/admin` open the restaurant and tap **Logins**. Each person shows their email. **Reset password** gives a new temporary password (shown once; they must choose their own at the next sign-in). **Change email** corrects the address (the old one stops working; the password stays). Both are written to the restaurant's activity log. Never delete users in the Supabase dashboard: that also removes their restaurant link.

## Supabase settings to switch on (staging first, then production)
In **Authentication → Providers → Email**: minimum password length **12**; on a paid plan also switch on **Prevent use of leaked passwords**. In **Authentication → Multi-Factor**: make sure **TOTP** is enabled. Session length ("time-box") is a paid-plan setting; the default access token lasts one hour and is refreshed automatically.

## Error monitoring (optional, free)
Create a free Sentry project (Node.js / Next.js), copy its DSN, and add it as `SENTRY_DSN` in the Vercel environment variables. Nothing is sent without it. Only the error type, a scrubbed message, the request id and the page path are sent.

## Local demo
`npm run test:e2e` starts a local stand-in. Demo logins: `admin@gotomenu.demo`, `owner@spice-garden.demo`, `manager@spice-garden.demo` (password `DemoPass#2025!`).
