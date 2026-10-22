# Dependencies and why each one exists

Every package is pinned to an exact version in `package.json` (no `^` or `~`), so a build today and a build
in six months use the same code. Nothing is added without being listed here.

## Runtime
| Package | Why it is needed |
|---|---|
| `next` 15.5.x | The web framework (pages, API routes, middleware). Version 15 was specified by the owner. |
| `react`, `react-dom` 19.1.x | Required by Next.js. |
| `@supabase/supabase-js` | Talks to the Supabase database/Auth/Realtime/Storage. |
| `@supabase/ssr` | Keeps staff login sessions in cookies, read on the server (`getUser()`), refreshed in middleware, and used by the browser for the Realtime connection. |
| `qrcode` 1.5.4 (+ `@types/qrcode`) | Draws each table's QR code as an SVG on the server (nothing is sent to the browser to generate it). Small, widely used, no network access. |
| `zod` 3.x | Validates all incoming data (API inputs, environment variables). Version 3 chosen for maturity. |
| `server-only` | Makes the build fail if server-only code (e.g. the service-role key) is imported into browser code. |

## Development / test only (never shipped to users)
| Package | Why |
|---|---|
| `typescript` 5.9 | Strict type checking (version 7 deliberately not used, per the brief). |
| `tailwindcss` 3.4, `postcss`, `autoprefixer` | Styling (Tailwind 3 specified by the owner). |
| `eslint`, `eslint-config-next`, `@eslint/eslintrc` | Lint rules; CI fails on any warning. ESLint 9 is used because `eslint-config-next` 15 does not support ESLint 10 yet. |
| `vitest` | Unit tests and the real-Postgres SQL tests. |
| `pg`, `@types/pg` | Connects the SQL tests to a real Postgres database. |
| `tsx` | Runs the TypeScript check scripts in `scripts/`. |
| `@types/node`, `@types/react`, `@types/react-dom` | Type definitions. |

| `@playwright/test` 1.56.1 | Drives a real browser for the end-to-end tests (phone and tablet sizes). Pinned to the version matching the browser build available in our test environment. |
| `@axe-core/playwright` | Automated WCAG accessibility scan inside those browser tests. |

## Added in later phases (will be listed here when added)
- `qrcode` — table QR codes as SVG (Phase 4)
- `@sentry/nextjs` — error reporting with PII scrubbing (Phase 5)
- `autocannon` or k6 — load test (Phase 6)

## Security audit status (`npm run audit`)
- **Production dependencies: 0 known vulnerabilities.** Next.js 15 bundles an old PostCSS; we force the patched
  PostCSS 8.5.30 through `overrides` in `package.json` (without this `npm audit` reports a high finding that can
  otherwise only be cleared by moving to Next 16, which the brief rules out).
- `vitest` was raised to 5.0.5 to clear a critical advisory in its worker library.
- **Accepted, development-only** (never deployed; they only process our own source files on a developer/CI machine):
  `braces` / `micromatch` / `chokidar` / `fast-glob` (denial of service on deeply nested glob patterns; there is no
  patched `braces` release), `tailwindcss` 3 and `eslint-config-next` 15 (they depend on those). The fix would be
  Tailwind 4 / Next 16, both ruled out by the brief. The audit script allow-lists exactly these names; any *new*
  high/critical finding fails CI.
- `next lint` is deprecated in Next 16; we already run ESLint directly (`eslint .`), so no migration is needed.
