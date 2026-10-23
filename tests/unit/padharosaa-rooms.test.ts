import { describe, expect, it } from 'vitest';
import { parseRooms } from '@/lib/padharosaa/rooms';

describe('parseRooms', () => {
  it('reads numbers, ranges and letters in any separator', () => {
    expect(parseRooms('101-103, 201 202;301a').rooms).toEqual(['101', '102', '103', '201', '202', '301A']);
    expect(parseRooms('  7  ').rooms).toEqual(['7']);
  });
  it('drops duplicates', () => expect(parseRooms('101, 101, 100-101').rooms).toEqual(['101', '100']));
  it('refuses nonsense with a clear message', () => {
    for (const bad of ['', '   ', '10-5', '1-500', '<b>', 'a'.repeat(11)]) expect(parseRooms(bad).error, bad).toBeTruthy();
    expect(parseRooms('1-500').error).toMatch(/range/);
  });
  it('caps one go at 100 rooms', () => expect(parseRooms('1-99, 200-210').error).toMatch(/100/));
});
