import type { MenuEvent } from '@/lib/schemas/guest';

export interface TrackIds { item_id?: string; category_id?: string }

/** Random id for this browser tab only (sessionStorage): not a cookie, not tied to a person, gone when the tab closes. */
function visitId(): string | null {
  try {
    let v = sessionStorage.getItem('gm_visit');
    if (!v) {
      v = crypto.randomUUID();
      sessionStorage.setItem('gm_visit', v);
    }
    return v;
  } catch {
    return null;
  }
}

/** Fire-and-forget. Respects "Do Not Track" and never throws or blocks the menu. */
export function trackEvent(slug: string, token: string | null, event: MenuEvent, ids: TrackIds = {}): void {
  if (typeof navigator === 'undefined' || navigator.doNotTrack === '1') return;
  const visit = visitId();
  if (!visit) return;
  try {
    void fetch('/api/guest/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ slug, token, visit, event, ...ids }),
    }).catch(() => undefined);
  } catch {
    /* analytics must never break the menu */
  }
}
