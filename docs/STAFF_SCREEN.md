# Staff screen: how it works (Phase 3)

Address: `/staff` (sign in at `/login`). Works on phones and tablets; installable ("Add to Home screen").

## What each role sees
| | Owner | Manager | Waiter | Kitchen |
|---|---|---|---|---|
| Live orders (New / Preparing / Ready) | yes | yes | yes | yes |
| Accept, Mark ready, Mark served | yes | yes | yes | yes |
| Cancel an order (reason required, only before ready) | yes | yes | yes | **no** |
| Waiter calls and bill requests ("what to bring") | yes | yes | yes | no |
| Open tables, **Mark paid** | yes | yes | yes | no |
| **Force close** a table with unserved orders (reason required) | yes | yes | no | no |
| Sold-out switches | yes | yes | yes | yes |

These rules are enforced **in the database** (migrations 0003, 0006, 0011); the screen only hides buttons that would be refused.

## What staff are told to bring
| Guest chose | Card says |
|---|---|
| UPI | Bring bill + payment QR |
| Card | Bring bill + card machine |
| Cash | Bring bill (cash payment) |

## Live updates
1. The screen asks the server for the board (`GET /api/staff/board`) and redraws.
2. **Supabase Realtime** (protected by row level security and filtered to this restaurant) nudges an immediate refresh whenever an order, request or table changes.
3. **Polling fallback:** if Realtime is not connected, the board refreshes every **5 seconds**. While Realtime is healthy it still reconciles every 30 seconds as a safety net.
4. If two refreshes in a row fail, or nothing succeeded for 15 seconds, a loud red **"Connection lost"** banner appears; it clears itself when the connection returns, and the board catches up on what it missed. "Updated hh:mm:ss" is always shown.
5. Waiting times use the **server's clock**, not the tablet's, so a wrong tablet clock cannot hide a late order. Orders turn amber then red at the restaurant's thresholds (default 5 and 10 minutes).

## Sound
Browsers only allow sound after a tap, so an amber banner shows "Sound is off" with an **Enable sound** button until it is tapped once. Three different tones: chime (new order), triple beep (waiter call), rising triad (bill request). A tone sounds immediately for anything new and **repeats every 6 seconds until it is acknowledged** (order accepted, request marked Done). A bill request outranks a call, which outranks a new order. The kitchen only hears new-order alerts.

## Screen stays on
The Screen Wake Lock API keeps the tablet awake while the page is open (it is requested again when the tab comes back to the front).

## Installing on a tablet
Open `/staff` in Chrome (Android) or Safari (iPad), sign in, then use **Add to Home screen**. It opens full screen. The service worker is deliberately tiny: it makes the app installable and shows a friendly "No internet connection" page when offline. It **never stores orders, API responses or pages** on the tablet (a test proves the cache holds only the offline page and its stylesheet). Larger-text mode (**A+**) is remembered per device.

## Sign-in security
- Email + password through Supabase Auth; every failure shows the same message (no hint whether an account exists).
- Throttling counts **failures only**: 20 per address and 8 per account in the window, so a restaurant's staff sharing one wifi are never blocked by each other's successful sign-ins.
- Only same-site staff destinations are accepted after sign in (no open redirects).
- Signed-out visitors to `/staff`, `/dash`, `/admin` are redirected to sign-in; if the sign-in service cannot be reached, nobody is let in (fails closed).
- "Sign out" ends this device; "Sign out of all devices" ends every session of the account.
- Mandatory two-factor (TOTP) for owner, manager and platform admin arrives in Phase 5.

## What could NOT be proven locally
Supabase **Realtime** cannot run in the local test environment, so the live-nudge path is only exercised on the staging project (Phase 6). The polling fallback, which is the same code path used if Realtime ever drops, is fully tested.
