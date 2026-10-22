import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  'server-only': fileURLToPath(new URL('./tests/stubs/empty.ts', import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      {
        // Route handlers called directly, backed by the real test Postgres (see tests/api/helpers.ts).
        resolve: { alias },
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
          setupFiles: ['tests/api/setup-env.ts'],
        },
      },
      {
        // Hits a running server (see scripts/with-server.ts); proves headers on a real response.
        resolve: { alias },
        test: { name: 'http', include: ['tests/http/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
      },
      {
        resolve: { alias },
        test: {
          name: 'sql',
          include: ['supabase/tests/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
