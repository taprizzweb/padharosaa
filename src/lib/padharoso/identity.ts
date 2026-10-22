import 'server-only';
import type { SupabaseClient } from '@/lib/padharoso/types';
import { ApiError } from '@/lib/errors';
import { staffRpc } from '@/lib/staff/rpc';

/**
 * IDENTITY PROVIDER BOUNDARY (spec 7.3). Everything in Padharoso that needs "who is this staff member" goes through
 * resolveStaffIdentity() and nothing else. Today it uses the existing Supabase Auth login (password + two-step sign-in); if the
 * login is ever replaced, only this function changes.
 */
export interface StaffIdentity {
  staffId: string;
  hotelId: string;
  role: 'owner' | 'manager' | 'waiter' | 'kitchen';
  displayName: string;
}

export async function resolveStaffIdentity(db: SupabaseClient): Promise<StaffIdentity | null> {
  const me = await staffRpc<{ user_id: string; role: StaffIdentity['role']; display_name: string; restaurant: { id: string } } | null>(db, 'staff_me');
  if (!me) return null;
  return { staffId: me.user_id, hotelId: me.restaurant.id, role: me.role, displayName: me.display_name };
}

export async function requireStaffIdentity(db: SupabaseClient): Promise<StaffIdentity> {
  const id = await resolveStaffIdentity(db);
  if (!id) throw new ApiError(403, 'forbidden');
  return id;
}
