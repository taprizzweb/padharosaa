import { describe, expect, it } from 'vitest';
import { isoToLocalInput, localInput, offerEndProblem, offerPresets } from '@/lib/padharosaa/offer';

describe('the offer end time', () => {
  it('is written in the local clock, so saving does not move it', () => {
    const d = new Date(2026, 9, 27, 21, 5);
    expect(localInput(d)).toBe('2026-10-27T21:05');
    expect(isoToLocalInput(d.toISOString())).toBe('2026-10-27T21:05');
    expect(isoToLocalInput(null)).toBe('');
    expect(new Date(localInput(d)).getTime()).toBe(d.getTime());
  });
  it('one-tap choices: tonight at 11, tomorrow night, 3 days, 6 days; after 11 PM "tonight" means tomorrow night', () => {
    const now = new Date(2026, 9, 27, 18, 30);
    expect(offerPresets(now).map((p) => p.value)).toEqual(['2026-10-27T23:00', '2026-10-28T23:00', '2026-10-30T23:00', '2026-11-02T23:00']);
    expect(offerPresets(new Date(2026, 9, 27, 23, 30))[0]!.value).toBe('2026-10-28T23:00');
    for (const p of offerPresets(now)) expect(offerEndProblem(p.value, now), p.label).toBeNull();
  });
  it('says what is wrong: nothing chosen, not a date, in the past, more than 7 days away', () => {
    const now = new Date(2026, 9, 27, 18, 30);
    expect(offerEndProblem('', now)).toBe('empty');
    expect(offerEndProblem('garbage', now)).toBe('bad');
    expect(offerEndProblem('2026-10-27T18:00', now)).toBe('past');
    expect(offerEndProblem('2026-11-03T18:31', now)).toBe('toofar');
    expect(offerEndProblem('2026-11-03T18:29', now)).toBeNull();
  });
});
