import { describe, expect, it } from 'vitest';
import { fitWithin } from '@/lib/dash/image';

describe('fitWithin', () => {
  it('shrinks the long side to 1600 and keeps the shape', () => {
    expect(fitWithin(3000, 2000)).toEqual({ width: 1600, height: 1067 });
    expect(fitWithin(2000, 4000)).toEqual({ width: 800, height: 1600 });
  });
  it('never enlarges a small photo', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('never returns a zero side', () => {
    expect(fitWithin(10000, 1).height).toBe(1);
  });
});
