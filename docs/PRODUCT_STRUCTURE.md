# Product structure: one codebase, two products

This repo contains the full GoToMenu app (copied from `taprizzweb/menu`, shallow copy of commit `19c848f`, history not carried over) plus the Padharosaa hotel concierge being added on top.

| Product | Who | What they get |
|---|---|---|
| **Menu Lite** (existing) | Cafes, restaurants, or any hotel that only wants menu + problem/help | QR menu, ordering, call waiter/bill, room-service link, help-request link |
| **Padharosaa Full** (new) | Hotels wanting the whole concierge | Everything in Lite plus guest chat, desk dashboard, buffet, Jaipur guide, notifications, etc. |

## Rules
1. **One app, one deployment, one database** (`menu-prod`). Lite is not a fork.
2. Padharosaa code lives only in `src/app/padharosaa/`, `src/app/api/padharosaa/`, `src/components/padharosaa/`, `src/lib/padharosaa/` and new `padharosaa_*`-scoped migrations. Existing menu code is changed only where the spec requires, and every such change must keep the Lite tests green.
3. A tenant is Padharosaa-enabled only if it has a `hotel_settings` row (plus a feature flag). Without it, the tenant sees exactly today's Lite product.
4. Staff keep using the existing Supabase Auth login with two-step sign-in (the spec's Interim Access Layer is not needed).
5. CI must run the existing Lite suite (lint, typecheck, unit, sql, rls, e2e) on every change.
