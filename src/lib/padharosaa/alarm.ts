// The rules of the reception alarm, with no browser in them so they can be tested. The alarm itself (sound, timers) is in components/staff/alarm-center.ts.

/** Something that is waiting for a person to accept it. */
export interface Waiting { id: string; urgent: boolean; since: number; label: string; room: string | null }

/** How often the alarm repeats while something waits: fast for an urgent request, a little faster once anything has waited a while, calm otherwise. */
export const REPEAT_URGENT_MS = 8_000;
export const REPEAT_LATE_MS = 12_000;
export const REPEAT_NORMAL_MS = 20_000;
export const LATE_AFTER_MS = 2 * 60_000;

export function repeatEveryMs(waiting: Waiting[], now: number): number | null {
  if (waiting.length === 0) return null;
  if (waiting.some((w) => w.urgent)) return REPEAT_URGENT_MS;
  if (waiting.some((w) => now - w.since >= LATE_AFTER_MS)) return REPEAT_LATE_MS;
  return REPEAT_NORMAL_MS;
}

/** The ids that are new since the last look. The very first look only learns what is there (nothing rings for old requests at page load). */
export function freshIds(seen: Set<string>, ids: string[], first: boolean): string[] {
  const fresh = first ? [] : ids.filter((id) => !seen.has(id));
  for (const id of ids) seen.add(id);
  return fresh;
}

/** The text of the browser tab while something waits: it alternates with the normal title so a minimised tab still blinks. */
export const tabTitle = (n: number, urgent: boolean, blink: boolean, base: string): string => (n === 0 || !blink ? base : `${urgent ? '🚨' : '🔔'} ${n} waiting`);

/** "Room 204 · Extra towels" for the banner; at most three, then "and 2 more". */
export function bannerText(waiting: Waiting[]): string {
  const sorted = [...waiting].sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.since - b.since);
  const shown = sorted.slice(0, 3).map((w) => `${w.urgent ? 'URGENT · ' : ''}${w.room ? `Room ${w.room} · ` : ''}${w.label}`);
  const more = sorted.length - shown.length;
  return shown.join('   |   ') + (more > 0 ? `   |   and ${more} more` : '');
}
