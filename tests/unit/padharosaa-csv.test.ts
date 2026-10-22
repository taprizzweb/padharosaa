import { describe, expect, it } from 'vitest';
import { parseStaffCsv } from '@/lib/padharosaa/csv';

describe('staff CSV', () => {
  it('reads rows with or without a header, maps reception to front_desk, flags heads, skips bad lines', () => {
    const r = parseStaffCsv('name,email,department,whatsapp,head\r\nMeera, meera@h.com, Reception, +91 98111 00001, yes\nPrakash,p@h.com,maintenance,,no\n\nNoEmail,,kitchen\nBad,b@h.com,spa');
    expect(r.bad).toBe(2);
    expect(r.rows).toEqual([
      { name: 'Meera', email: 'meera@h.com', department: 'front_desk', whatsapp: '+91 98111 00001', is_head: true },
      { name: 'Prakash', email: 'p@h.com', department: 'maintenance', whatsapp: null, is_head: false },
    ]);
  });
});
