import 'server-only';
import { rpc } from '@/lib/guest/rpc';
import { deliver, vapid, type Target } from './push';

export interface StaffNote { hotel: string; room: string | null; type: string; team: string; label: string; urgent: boolean; id: string; targets: Target[] }

const TEAM: Record<string, string> = { concierge: 'Concierge', front_desk: 'Front desk', housekeeping: 'Housekeeping', kitchen: 'Kitchen', maintenance: 'Maintenance', manager: 'Manager' };

/** The words on the staff phone: the room first (that is what a person looks for), then who it is for and what it is. Nothing private. */
export function staffMessage(n: Pick<StaffNote, 'room' | 'team' | 'label' | 'urgent' | 'id' | 'type'>): { title: string; body: string; url: string; tag: string; urgent: boolean; kind: 'staff' } {
  return {
    title: `${n.urgent ? '🚨 URGENT · ' : ''}${n.room ? `Room ${n.room}` : 'New request'}`,
    body: `${n.type === 'order' ? '' : `${TEAM[n.team] ?? n.team}: `}${n.label}`,
    url: '/padharosaa/desk',
    tag: `staff-${n.id}`,
    urgent: n.urgent,
    kind: 'staff',
  };
}

async function send(note: StaffNote | null): Promise<void> {
  if (!note || note.targets.length === 0) return;
  await deliver(note.targets, staffMessage(note), (id) => rpc('padh_staff_push_drop', { p_id: id }), { ttl: 3600, urgency: 'high', tag: `staff-${note.type}` });
}

/** After a guest request is made: tell the people who handle it. Never throws; a failed message must never fail the guest's request. */
export async function notifyStaffOfRequest(requestId: string): Promise<void> {
  if (!vapid()) return;
  try { await send(await rpc<StaffNote | null>('padh_staff_push_for_request', { p_request: requestId })); } catch { /* a courtesy message */ }
}

/** After a food order from a hotel room. Orders from tables or from a restaurant that is not a hotel are ignored by the database. */
export async function notifyStaffOfOrder(slug: string, orderNo: number): Promise<void> {
  if (!vapid()) return;
  try { await send(await rpc<StaffNote | null>('padh_staff_push_for_order', { p_slug: slug, p_order_no: orderNo })); } catch { /* a courtesy message */ }
}
