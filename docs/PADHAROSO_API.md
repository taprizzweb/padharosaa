# Padharoso API (v1) — Phase 2 slice 4

Base: `/api/padharoso/v1`. JSON only. Errors use the existing app format `{ "error": { "key": "..." }, "requestId": "..." }`
(the key is translated in the browser; no database text ever reaches users). Every POST must come from our own origin (CSRF check) and
creating things needs an `Idempotency-Key` header (8–64 chars).

## Guest (cookie `__Host-padh_sid` on https, `padh_sid` on local http)
| Method & path | Purpose |
|---|---|
| `GET hotels/{slug}/public?k=` | login page data; every failure is the same 403 |
| `POST hotels/{slug}/sessions` | login (name, cc, mobile, room, language, stay_code?, consent?) |
| `GET sessions/me` · `POST sessions/me/logout` · `POST sessions/me/preferences` | own session |
| `GET chat/messages?before=&limit=` · `GET contacts` | chat history; phone numbers (logged-in only) |
| `POST requests` | create a request (type, label, detail?, urgent?) |
| `POST requests/{id}/cancel` · `POST requests/{id}/confirm {ok}` | cancel while received; "is everything okay now?" |

## Staff (existing Supabase Auth login; role checked in SQL; 120 actions/min per person)
`POST staff/requests/{id}/{accept|complete|dismiss|pass|resolve}` (body carries `version`; stale = 409),
`POST staff/sessions/{id}/{end|block}`, `POST staff/rooms/{id}/{stay-code|checkout}`, `POST staff/qr/rotate {confirm:"ROTATE"}`.

## Platform
`POST platform/hotels/{id}/enable` (Taprizz admin only) — returns the QR key once.

## Design notes
- Mobile numbers are AES-256-GCM encrypted and keyed-hashed in the API before the database sees them (`PADHAROSO_DATA_KEY`, base64 of 32 bytes; not needed for Menu Lite).
- The cookie value is a random 256-bit token; the database stores only its SHA-256. Path is `/` because the API lives outside the hotel page path (deviation from spec 7.4: the token already binds the cookie to exactly one hotel and room).
- `src/lib/padharoso/identity.ts` is the Identity Provider boundary (`resolveStaffIdentity`) for staff.
