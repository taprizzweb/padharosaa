import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AREAS } from '@/lib/padharosaa/areas';

// Every named screen must be reachable on the clean address (padharosaa.<domain>/qr) and must need a sign-in. A screen missing from either list showed
// "We could not find this restaurant" or, worse, would not ask for a sign-in at the middleware.
const src = readFileSync('src/middleware.ts', 'utf8');
describe('the middleware knows every screen', () => {
  it('the clean addresses are made from the list of screens', () => expect(src).toContain('AREAS.map((a) => [`/${a}`, `/padharosaa/${a}`])'));
  it('every screen is on the protected list', () => {
    const line = src.split('\n').find((l) => l.startsWith('const PROTECTED'))!;
    for (const a of AREAS) expect(line, a).toMatch(new RegExp(`[(|]${a}[|)]`));
  });
});
