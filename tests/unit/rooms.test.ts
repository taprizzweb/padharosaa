import { describe, expect, it } from 'vitest';
import { normalizeRoom, parseRooms, tableName } from '@/lib/rooms';
import { roomServiceSave } from '@/lib/schemas/dash';
import { roomBody } from '@/lib/schemas/guest';

describe('room list', () => {
  it('expands ranges, accepts commas and new lines, removes duplicates and tidies case', () => {
    expect(parseRooms('101-103, 201\nsuite 1; 101')).toEqual({ ok: true, rooms: ['101', '102', '103', '201', 'SUITE 1'] });
    expect(parseRooms('')).toEqual({ ok: true, rooms: [] });
    expect(parseRooms(' , ;\n ')).toEqual({ ok: true, rooms: [] });
  });
  it('refuses backwards, huge and junk entries so a typo cannot create thousands of rooms', () => {
    for (const bad of ['110-101', '1-5000', 'ro$om', '<b>1</b>', 'x'.repeat(11)]) expect(parseRooms(bad).ok, bad).toBe(false);
    expect(parseRooms(Array.from({ length: 301 }, (_, i) => String(i + 1)).join(',')).ok).toBe(false);
    expect(parseRooms(Array.from({ length: 300 }, (_, i) => String(i + 1)).join(',')).ok).toBe(true);
  });
});

describe('room number typed by a guest', () => {
  it('is cleaned to the form the database stores, or refused', () => {
    expect(normalizeRoom('  suite   1 ')).toBe('SUITE 1');
    expect(normalizeRoom('204')).toBe('204');
    for (const bad of ['', '   ', '-1', 'a;b', 'x'.repeat(11), '<script>']) expect(normalizeRoom(bad), bad).toBe('');
  });
  it('request body accepts a room, strips control characters and refuses extras', () => {
    const base = { slug: 'spice-garden', token: 'a'.repeat(64) };
    expect(roomBody.parse({ ...base, room: ' 204 ' }).room).toBe('204');
    expect(roomBody.safeParse({ ...base, room: '' }).success).toBe(false);
    expect(roomBody.safeParse({ ...base, room: '1'.repeat(30) }).success).toBe(false);
    expect(roomBody.safeParse({ ...base, room: '204', extra: 1 }).success).toBe(false);
    expect(roomBody.safeParse({ slug: 'x', token: 'short', room: '204' }).success).toBe(false);
  });
});

describe('owner form and names', () => {
  it('validates the room list text the owner typed', () => {
    expect(roomServiceSave.safeParse({ enabled: true, rooms: '101-110, 201' }).success).toBe(true);
    expect(roomServiceSave.safeParse({ enabled: true, rooms: '110-101' }).success).toBe(false);
    expect(roomServiceSave.safeParse({ enabled: true, rooms: '', extra: 1 }).success).toBe(false);
  });
  it('shows rooms as "Room 204" and tables as "Table 5"', () => {
    expect(tableName('Room 204')).toBe('Room 204');
    expect(tableName('5')).toBe('Table 5');
    expect(tableName('A1')).toBe('Table A1');
  });
});
