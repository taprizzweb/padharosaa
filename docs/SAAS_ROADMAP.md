# Premium menu + growth platform: audit and roadmap

Written when the owner asked to grow GoToMenu from a table-ordering app into a full restaurant menu SaaS. Status column is honest: "done" means built, tested and live on staging.

## Already built (do not rebuild)
| Area | Status |
|---|---|
| Multi-tenant base: restaurants, roles (platform admin, owner, manager, waiter, kitchen), RLS on every table, server-side role checks, audit log | done |
| Public menu `/{slug}`: categories with sticky tabs, search, veg/jain/bestseller filters, dish cards with photo, diet mark, spice, badges, sold-out | done |
| Table QR (per-table tokens, rotate, print layouts), table ordering, live staff screen, bill / waiter calls | done |
| Owner dashboard: menu manager (photos, reorder, bulk price, CSV import/export), tables, staff, settings (name, accent colour, Google review link), report, activity log | done |
| Platform admin: create / suspend restaurants, plan + paid-until, logins (add, reset password, change email), export, delete | done |
| Security: strict CSP, origin checks, rate limits, threat model | done |

## Added in this step (Phase 1, slice 1)
Public profile: tagline, about, logo, banner, phone, WhatsApp, address, opening hours text, Instagram. The public menu shows a hero (banner, logo, name) and buttons only for what the owner filled in: Call, WhatsApp (pre-filled, correctly encoded message), Directions (Google Maps search), Instagram, "Review us on Google" (with a note that the review is written on Google). Migration `0017_restaurant_profile.sql`.

## Added after that (look and feel, analytics)
- Public menu redesign: photo hero, "Find us" info card, category thumbnails, image-led dish cards, favourites strip, dish details sheet.
- Measured analytics (migration `0018_menu_analytics.sql`): events recorded by a service-only function (random per-tab id, no IP or user agent, rate-limited, de-duplicated, purged after 180 days, "Do Not Track" respected). Owners and managers see totals, daily opens, top dishes, categories, table scans and button taps under Dashboard > Analytics, with a CSV download and a plain explanation of the limits.

## Added after that (room service)
- One shared room-service link per restaurant (migration `0022_room_service.sql`): the guest enters a room number first, then orders; each room is an ordinary table labelled "Room 204" so the live board, bills and paying work unchanged. Owner manages it on Tables & QR (optional room list, new link, print card).

## Added after that (sizes and options)
- Dish sizes (Small / Large, Half / Full...) with their own prices, and option groups (required or optional, a maximum, extra prices): migration `0024_item_sizes_options.sql`. Prices are always worked out by the database from ids; the order line keeps a readable name such as "Oreo Shake (Large) + Choco, Cream", so staff screens, bills and reports need no change. CSV `sizes` column. Still open: option availability (sold-out single options), per-size photos.

## Added after that (call for problems)
- Hotel "Call for problems" (migration `0025_help_requests.sql`): one shared link per restaurant with the owner's list of problems; the guest types the room, taps problems, may add a note; it appears live on reception's staff screen (own sound, Done button). Still open: housekeeping / maintenance roles and screens, time-to-resolve timers, a status shown to the guest.

## Not built yet (recommended order)
1. **Phase 1 slice 2: look and feel.** Several design templates (minimal, dark, warm, elegant, bright), dish detail view, featured section, category images, image fallbacks and loading skeletons. Needs real food photos from restaurants to look premium.
2. ~~Analytics~~ done (see above). Still open: traffic source (needs a `?src=` convention on QR links), weekly trend view.
3. **Phase 2:** NFC / QR card manager (`/r/{id}` redirect with an allow-list so it cannot become an open redirect, scan counts), feedback module (rating, categories, comment, export, kept separate from Google), promotions with start / end dates, item variants and add-ons, plan entitlements and limits editable by the platform admin.
4. **Phase 3:** payments and subscriptions (needs a provider account; Razorpay is the usual choice in India), AI description helper (needs an API key and a monthly budget), multi-location, additional languages (Hindi fields already exist in the database; owner-supplied text only).

## Needs a decision or an account before it can be built
- **Payment provider** for subscriptions (and for guest payments, if ever): choose one, create the account, give test keys. Until then billing stays "plan + paid until" set by the platform admin.
- **AI provider key** and a monthly spending cap, for the description assistant.
- **Plan names, limits and prices** (Starter / Pro / Growth): owner decision.
- **WhatsApp Business Platform** (official API) is optional and has per-conversation fees; plain wa.me links need nothing.
- **Real photos and logos** for the demo restaurant.

## Known limitations of what exists today
- One language in the guest UI (English); templates and analytics do not exist yet.
- Ordering is tied to a table QR (guests without a table QR can only browse). Online payment is not implemented; the bill is settled at the table.
