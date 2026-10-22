import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: 'error',
    },
  },
  {
    // Test code inspects loosely-typed JSON returned by SQL functions.
    files: ['supabase/tests/**', 'tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  { files: ['scripts/**', 'supabase/tests/**', 'supabase/seed/**', 'tests/**'], rules: { 'no-console': 'off' } },
];

export default config;
