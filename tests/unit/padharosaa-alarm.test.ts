import { describe, expect, it } from 'vitest';
import { LATE_AFTER_MS, REPEAT_LATE_MS, REPEAT_NORMAL_MS, REPEAT_URGENT_MS, bannerText, freshIds, repeatEveryMs, tabTitle, type Waiting } from '@/lib/padharosaa/alarm';

const w = (over: Partial<Waiting> = {}): Waiting => ({ id: 'a', urgent: false, since: 1_000_000, label: 'Extra towels', room: '204', ...over });

describe('the reception alarm rules', () => {
  it('stays quiet with nothing waiting; urgent beats everything; a request that has waited a while rings faster', () => {
    expect(repeatEveryMs([], 1_000_000)).toBeNull();
    expect(repeatEveryMs([w()], 1_000_000 + 5_000)).toBe(REPEAT_NORMAL_MS);
    expect(repeatEveryMs([w()], 1_000_000 + LATE_AFTER_MS)).toBe(REPEAT_LATE_MS);
    expect(repeatEveryMs([w(), w({ id: 'b', urgent: true })], 1_000_000)).toBe(REPEAT_URGENT_MS);
    expect(REPEAT_URGENT_MS).toBeLessThan(REPEAT_LATE_MS);
    expect(REPEAT_LATE_MS).toBeLessThan(REPEAT_NORMAL_MS);
  });
  it('the first look rings for nothing; later only for ids not seen before; an id is never new twice', () => {
    const seen = new Set<string>();
    expect(freshIds(seen, ['1', '2'], true)).toEqual([]);
    expect(freshIds(seen, ['1', '2', '3'], false)).toEqual(['3']);
    expect(freshIds(seen, ['1', '2', '3'], false)).toEqual([]);
    expect(freshIds(seen, ['4', '5'], false)).toEqual(['4', '5']);
  });
  it('the tab title blinks between the normal title and the number waiting', () => {
    expect(tabTitle(0, false, true, 'Desk')).toBe('Desk');
    expect(tabTitle(3, false, false, 'Desk')).toBe('Desk');
    expect(tabTitle(3, false, true, 'Desk')).toBe('🔔 3 waiting');
    expect(tabTitle(1, true, true, 'Desk')).toBe('🚨 1 waiting');
  });
  it('the banner lists urgent first, then the longest waiting, three at most', () => {
    const list = [w({ id: 'a', since: 3, label: 'C' }), w({ id: 'b', since: 1, label: 'A' }), w({ id: 'c', since: 2, label: 'B', urgent: true }), w({ id: 'd', since: 4, label: 'D', room: null }), w({ id: 'e', since: 5, label: 'E' })];
    expect(bannerText(list)).toBe('URGENT · Room 204 · B   |   Room 204 · A   |   Room 204 · C   |   and 2 more');
    expect(bannerText([w({ room: null })])).toBe('Extra towels');
  });
});
