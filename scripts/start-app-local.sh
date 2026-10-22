#!/usr/bin/env bash
# Builds and starts the app against the local dev stack (scripts/dev-stack.ts). Local testing only.
set -euo pipefail
export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT="${PORT:-3100}"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${SHIM_PORT:-54321}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="local-anon-key-local-anon-key-local"
# "localhost" (not 127.0.0.1): Next builds absolute redirect URLs from it, and the page origin must match this value.
export NEXT_PUBLIC_APP_ORIGIN="http://localhost:${PORT}"
export SUPABASE_SERVICE_ROLE_KEY="local-service-role-key-local-service-role"
export GUEST_COOKIE_SECRET="local-cookie-secret-local-cookie-secret-local-1"
export IP_HASH_SALT="local-ip-salt-local-ip-salt"
export LOG_LEVEL="${LOG_LEVEL:-info}"
[ "${SKIP_BUILD:-}" = "1" ] || node_modules/.bin/next build
exec node_modules/.bin/next start -p "$PORT" -H 127.0.0.1
