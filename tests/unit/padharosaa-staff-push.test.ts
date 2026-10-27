import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { name: string; args: Record<string, unknown> }[] = [];
let note: unknown = null;
const send = vi.fn(async () => ({}) as never);
vi.mock('@/lib/guest/rpc', () => ({ rpc: async (name: string, args: Record<string, unknown> = {}) => { calls.push({ name, args }); return name.startsWith('padh_staff_push_for') ? note : null; } }));
vi.mock('@/env', () => ({ serverEnv: () => ({ VAPID_PUBLIC_KEY: 'p'.repeat(87), VAPID_PRIVATE_KEY: 'k'.repeat(43), VAPID_SUBJECT: 'mailto:a@b.co' }) }));
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => (send as unknown as (...x: unknown[]) => unknown)(...a) } }));
vi.mock('server-only', () => ({}));

const { staffMessage, notifyStaffOfRequest, notifyStaffOfOrder } = await import('@/lib/padharosaa/staff-push');
beforeEach(() => { calls.length = 0; note = null; send.mockClear(); });

describe('staff push messages', () => {
  it('puts the room first, then who it is for and what; urgent says so and stays on screen', () => {
    expect(staffMessage({ room: '204', team: 'housekeeping', label: 'Extra towels', urgent: false, id: 'r1', type: 'housekeeping' }))
      .toMatchObject({ title: 'Room 204', body: 'Housekeeping: Extra towels', url: '/padharosaa/desk', tag: 'staff-r1', urgent: false, kind: 'staff' });
    expect(staffMessage({ room: '101', team: 'maintenance', label: 'AC not working', urgent: true, id: 'r2', type: 'help' }).title).toBe('🚨 URGENT · Room 101');
    expect(staffMessage({ room: '305', team: 'kitchen', label: 'Food order ₹620', urgent: false, id: 'o1', type: 'order' }).body).toBe('Food order ₹620');
    expect(staffMessage({ room: null, team: 'front_desk', label: 'Hello', urgent: false, id: 'x', type: 'help' }).title).toBe('New request');
  });
  it('sends one message to each target; says nothing when nobody is to be told; a failure never throws', async () => {
    note = { hotel: 'H', room: '204', type: 'housekeeping', team: 'housekeeping', label: 'Towels', urgent: true, id: 'r1', targets: [{ id: 'a', sub: { endpoint: 'https://p/1' } }, { id: 'b', sub: { endpoint: 'https://p/2' } }] };
    await notifyStaffOfRequest('r1');
    expect(send).toHaveBeenCalledTimes(2);
    const payload = JSON.parse((send.mock.calls[0] as unknown as [unknown, string])[1]);
    expect(payload).toMatchObject({ title: '🚨 URGENT · Room 204', urgent: true, kind: 'staff' });
    send.mockClear();
    note = { ...(note as object), targets: [] };
    await notifyStaffOfRequest('r1');
    expect(send).not.toHaveBeenCalled();
    note = null;
    await notifyStaffOfOrder('slug', 7);
    expect(send).not.toHaveBeenCalled();
    expect(calls.map((c) => c.name)).toEqual(['padh_staff_push_for_request', 'padh_staff_push_for_request', 'padh_staff_push_for_order']);
    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    note = { hotel: 'H', room: '1', type: 'order', team: 'kitchen', label: 'x', urgent: false, id: 'o', targets: [{ id: 'z', sub: { endpoint: 'https://p/9' } }] };
    await expect(notifyStaffOfOrder('slug', 8)).resolves.toBeUndefined();
    expect(calls.some((c) => c.name === 'padh_staff_push_drop' && c.args.p_id === 'z')).toBe(true); // a gone device is forgotten
  });
});
