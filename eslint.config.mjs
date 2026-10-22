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
    // Security rule (spec 7.6): never inject HTML built from guest, staff or menu text. Render text through the framework instead.
    files: ['src/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML is banned: render text through React so it is escaped.' },
        { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]", message: 'innerHTML/outerHTML are banned: use textContent or React.' },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'insertAdjacentHTML is banned.' },
        { selector: "CallExpression[callee.property.name='write'][callee.object.name='document']", message: 'document.write is banned.' },
      ],
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
