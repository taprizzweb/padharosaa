import { describe, expect, it } from 'vitest';
import { roomLink } from '@/lib/padharosaa/qrsheet';

describe('room QR links', () => {
  const base = `https://padharosaa.taprizz.in/padharosaa/spice-garden?k=${'a'.repeat(64)}`;
  it('adds the room and keeps the key', () => {
    expect(roomLink(base, '204')).toBe(`${base}&r=204`);
    expect(roomLink(base, ' 12a ')).toBe(`${base}&r=12A`);
    expect(roomLink(base, 'SUITE 1')).toBe(`${base}&r=SUITE+1`);
  });
  it('replaces a room that is already there', () => {
    expect(roomLink(`${base}&r=101`, '102')).toBe(`${base}&r=102`);
  });
});
