# Performance notes

## Budget: menu route under 200 KB of JavaScript
Measured from `next build` (Phase 2, guest menu `/[slug]`):

| Route | Route JS | First Load JS (gzip, as reported by Next.js) |
|---|---|---|
| `/[slug]` (menu, cart, status, help) | 17.3 kB | **120 kB** |
| shared by every page (React + Next runtime) | – | 103 kB |

Budget is 200 KB, so there is 80 KB of headroom. No UI library, icon pack or date library is used (icons are inline SVG,
dates use the built-in `Intl`). Re-measure on every release; Lighthouse and the 4G / mid-range Android check are done in Phase 6.

## Design choices that protect speed
- The menu is rendered on the server (HTML arrives ready to read); the browser only adds interactivity.
- Menu photos have a fixed square box (no layout shift), `loading="lazy"` and `decoding="async"`, and are compressed to WebP before upload.
- System fonts only (no font download).
- Guest status uses a 4 s poll that backs off to 30 s on errors and pauses while the tab is hidden or offline.
