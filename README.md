# GoToMenu

QR table ordering for cafes and restaurants. Guests scan, order and call the waiter from their phone; staff see
live orders on one screen. No online payments: the table is marked paid by staff.

Status: **Phase 5 (platform admin, two-step sign-in, hardening, threat model) complete.** English only. See `docs/PLAN.md` for the full plan.

## Commands
| Command | What it does |
|---|---|
| `npm run lint` | Lint; any warning fails |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Unit tests |
| `npm run test:sql` | Database tests against a real local Postgres (needs `TEST_DATABASE_URL`, see below) |
| `npm run check:rls` | Fails if any table lacks Row Level Security, or `anon` has table access |
| `npm run check:secret-scan` | Fails if anything in the repo looks like a real secret |
| `npm run audit` | Dependency audit gate |
| `npm run build` | Production build (fails on invalid environment settings) |
| `npm run check:secrets` | After a build: proves server secrets are not in browser files |
| `npm run test:api` | Route handlers (order, status, request, review, health) against real Postgres |
| `npm run test:e2e` | Real-browser tests (phone + tablet) against the full local stack, incl. accessibility scan |
| `npm run seed` | Loads the two demo restaurants into the STAGING Supabase project |
| `npm run test:http` | Starts the built app and asserts the security headers on real responses |

SQL tests need a Postgres 16 superuser. Default: `postgres://gm_test:gm_test@127.0.0.1:5432/postgres`
(override with `TEST_DATABASE_URL`). Each test file creates its own throw-away database, applies every file in
`supabase/migrations/`, and drops it afterwards.

Demo staff logins on the local stack (`npm run test:e2e` or `tsx scripts/dev-stack.ts`): `owner@spice-garden.demo`, `manager@…`, `waiter@…`, `kitchen@…` (also `@cafe-aroma.demo`), password `DemoPass#2025!`. See `docs/STAFF_SCREEN.md`.

## Layout
- `supabase/migrations/` numbered SQL migrations (the database is the source of truth for security)
- `supabase/tests/` SQL test suite; `helpers/supabase_stub.sql` imitates the parts of Supabase we rely on
- `src/` Next.js app; `scripts/` CI checks; `docs/` plan, dependencies, (later) threat model, runbook, deployment
