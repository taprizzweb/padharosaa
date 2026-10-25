import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { name: string; args: Record<string, unknown> }[] = [];
let targets: { id: string; sub: { endpoint: string } }[] = [];
vi.mock('@/lib/guest/rpc', () => ({ rpc: async (name: string, args: Record<string, unknown> = {}) => { calls.push({ name, args }); return name === 'padh_push_targets' ? targets : null; } }));
vi.mock('@/env', () => ({ serverEnv: () => ({ VAPID_PUBLIC_KEY: 'p'.repeat(87), VAPID_PRIVATE_KEY: 'k'.repeat(43), VAPID_SUBJECT: 'mailto:a@b.co' }) }));

const { buffetMessage, pushToHotel } = await import('@/lib/padharosaa/push');
beforeEach(() => { calls.length = 0; targets = []; });

describe('buffet push', () => {
  it('words the message with 12-hour times and the hotel page', () => {
    const m = buffetMessage({ slug: 'sura', hotel: 'Sura', name: 'Thali night', start: '19:30', end: '22:30', venue: 'Courtyard' }, 'saved');
    expect(m).toMatchObject({ title: 'Sura: buffet today', body: 'Thali night · 7:30 PM – 10:30 PM · Courtyard', url: '/padharosaa/sura' });
  });
  it('sends to every phone, forgets a gone phone (410), counts other failures', async () => {
    targets = [1, 2, 3].map((n) => ({ id: `s${n}`, sub: { endpoint: `https://p.example.com/${n}` } }));
    const send = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('/3')) throw Object.assign(new Error('busy'), { statusCode: 500 });
      return {} as never;
    });
    const r = await pushToHotel('rid', { title: 't', body: 'b', url: '/x', tag: 'g' }, send as never);
    expect(r).toMatchObject({ configured: true, targets: 3, sent: 1, dropped: 1, failed: 1, codes: [500] });
    expect(calls.filter((c) => c.name === 'padh_push_drop').map((c) => c.args.p_session)).toEqual(['s2']);
  });
});
