// The offer box on the guests' home screen: it shows until a time the manager sets, at most 7 days ahead. Times are the manager's own clock.

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date as the text a <input type="datetime-local"> wants: the local clock, not UTC (a UTC cut-off moved the time by hours at every save). */
export const localInput = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const isoToLocalInput = (iso: string | null | undefined): string => (iso ? localInput(new Date(iso)) : '');

const at11 = (now: Date, addDays: number): Date => { const d = new Date(now); d.setDate(d.getDate() + addDays); d.setHours(23, 0, 0, 0); return d; };

/** One-tap end times. "Tonight" is 11 PM today, or 11 PM tomorrow when it is already later than that. */
export function offerPresets(now: Date): { label: string; value: string }[] {
  const tonight = at11(now, 0);
  return [
    { label: 'Tonight', value: localInput(tonight.getTime() > now.getTime() + 60_000 ? tonight : at11(now, 1)) },
    { label: 'Tomorrow night', value: localInput(at11(now, 1)) },
    { label: '3 days', value: localInput(at11(now, 3)) },
    { label: '6 days', value: localInput(at11(now, 6)) },
  ];
}

/** Can this end time be saved? The database refuses a time in the past or more than 7 days away. */
export function offerEndProblem(value: string, now: Date): 'empty' | 'bad' | 'past' | 'toofar' | null {
  if (!value) return 'empty';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return 'bad';
  if (t <= now.getTime()) return 'past';
  if (t > now.getTime() + 7 * 86_400_000) return 'toofar';
  return null;
}
export const OFFER_PROBLEM: Record<'empty' | 'bad' | 'past' | 'toofar', string> = {
  empty: 'Choose when the offer ends.', bad: 'That end time is not a real date and time.', past: 'The offer must end later than now.', toofar: 'An offer can run for 7 days at most.',
};
