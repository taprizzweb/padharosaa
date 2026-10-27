import { describe, expect, it } from 'vitest';
import { buildPush, normalizeRevision, toRanges, type PushDay } from '@/lib/padharosaa/channex';

const d = (day: string, o: Partial<PushDay> = {}): PushDay => ({ day, rate_paise: 300000, stop_sell: false, min_stay: null, free: 3, ...o });

describe('what is sent to the channel service', () => {
  it('days with the same values become one range; a change or a gap starts a new one', () => {
    const r = toRanges([d('2026-11-01'), d('2026-11-02'), d('2026-11-03', { free: 2 }), d('2026-11-05', { free: 2 })], (a, b) => a.free === b.free);
    expect(r.map((x) => [x.from, x.to])).toEqual([['2026-11-01', '2026-11-02'], ['2026-11-03', '2026-11-03'], ['2026-11-05', '2026-11-05']]);
  });
  it('prices (per rate plan) and rooms left (per room type) are built separately, in paise, and a month end is not a gap', () => {
    const p = buildPush({ property_id: 'P', ext_room_type_id: 'RT', ext_rate_plan_id: 'RP', days: [d('2026-10-31'), d('2026-11-01'), d('2026-11-02', { rate_paise: 350000, stop_sell: true, min_stay: 2, free: 0 })] });
    expect(p.restrictions).toEqual([
      { property_id: 'P', rate_plan_id: 'RP', date_from: '2026-10-31', date_to: '2026-11-01', rate: 300000, stop_sell: false, min_stay_arrival: 1 },
      { property_id: 'P', rate_plan_id: 'RP', date_from: '2026-11-02', date_to: '2026-11-02', rate: 350000, stop_sell: true, min_stay_arrival: 2 },
    ]);
    expect(p.availability).toEqual([
      { property_id: 'P', room_type_id: 'RT', date_from: '2026-10-31', date_to: '2026-11-01', availability: 3 },
      { property_id: 'P', room_type_id: 'RT', date_from: '2026-11-02', date_to: '2026-11-02', availability: 0 },
    ]);
  });
});

describe('what arrives from the channel service', () => {
  const rev = (o: Record<string, unknown> = {}) => ({
    id: 'rev-1', type: 'booking_revision',
    attributes: { booking_id: 'bk-123', status: 'new', ota_name: 'Booking.com', ota_reservation_code: '4455667788', arrival_date: '2026-12-01', departure_date: '2026-12-03', amount: '5000.00',
      customer: { name: 'Anita', surname: 'Rao', phone: '+919811122233' }, rooms: [{ room_type_id: 'rt-1', occupancy: { adults: 2 } }], ...o },
  });
  it('a booking becomes one line with the guest, the dates, the nightly rate in paise and the site\'s own number', () => {
    expect(normalizeRevision(rev())).toEqual([{ ext_id: 'bk-123#0', revision: 'rev-1', status: 'new', channel: 'Booking.com', guest: 'Anita Rao', mobile: '+919811122233', adults: 2, check_in: '2026-12-01', check_out: '2026-12-03',
      ext_room_type_id: 'rt-1', rate_paise: 250000, notes: 'Booking.com booking 4455667788' }]);
  });
  it('two rooms are two reservations that split the amount; cancelled and modified keep their status', () => {
    const two = normalizeRevision(rev({ status: 'cancelled', rooms: [{ room_type_id: 'rt-1' }, { room_type_id: 'rt-2', occupancy: { adults: 3 } }] }));
    expect(two.map((x) => [x.ext_id, x.status, x.ext_room_type_id, x.adults, x.rate_paise])).toEqual([['bk-123#0', 'cancelled', 'rt-1', 1, 125000], ['bk-123#1', 'cancelled', 'rt-2', 3, 125000]]);
    expect(normalizeRevision(rev({ status: 'modified' }))[0]!.status).toBe('modified');
  });
  it('anything odd is skipped, not guessed: no status, no booking number, no rooms, no id, not an object', () => {
    for (const bad of [rev({ status: 'weird' }), rev({ booking_id: '' }), rev({ rooms: [] }), { attributes: {} }, null, 'x']) expect(normalizeRevision(bad)).toEqual([]);
  });
  it('control characters in a guest name are removed', () => {
    expect(normalizeRevision(rev({ customer: { name: 'A\u0000na\nnd', surname: '' } }))[0]!.guest).toBe('A na nd');
  });
});
