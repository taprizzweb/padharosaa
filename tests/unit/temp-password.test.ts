import { describe, expect, it } from 'vitest';
import { temporaryPassword } from '@/lib/dash/temp-password';

describe('temporary passwords', () => {
  it('are 16 characters, never contain look-alike characters, and do not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const p = temporaryPassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/); // no 0 O 1 l I
      seen.add(p);
    }
    expect(seen.size).toBe(2000);
  });
  it('uses the whole alphabet (not stuck on a few characters)', () => {
    const chars = new Set(Array.from({ length: 300 }, () => temporaryPassword()).join(''));
    expect(chars.size).toBeGreaterThan(45);
  });
  it('meets the 12-character minimum enforced on real passwords', () => {
    expect(temporaryPassword().length).toBeGreaterThanOrEqual(12);
  });
});
