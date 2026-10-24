import { describe, expect, it } from 'vitest';
import { normInsta, normPhone, normUrl, normWhatsapp } from '@/lib/padharosaa/normalize';
import { brandingBody, stayBody } from '@/lib/padharosaa/schemas';

describe('normalisers', () => {
  it('phones', () => {
    for (const [i, o] of [['9828114008', '919828114008'], ['+91 98281 14008', '919828114008'], ['098281-14008', '919828114008'], ['(91) 98281 14008', '919828114008'], ['919828114008', '919828114008']]) expect(normPhone(i), i).toBe(o);
    expect(normPhone('call me')).toBe('call me'); // still refused by the strict check
  });
  it('whatsapp', () => {
    for (const [i, o] of [['9828114008', '+919828114008'], ['98281 14008', '+919828114008'], ['+91 98281-14008', '+919828114008'], ['919828114008', '+919828114008'], ['098281 14008', '+919828114008'], ['+44 7911 123456', '+447911123456']]) expect(normWhatsapp(i), i).toBe(o);
    expect(normWhatsapp('')).toBeNull();
    expect(normWhatsapp('hello')).toBe('hello');
  });
  it('links', () => {
    expect(normUrl('www.tripadvisor.in/Hotel_Review-g1')).toBe('https://www.tripadvisor.in/Hotel_Review-g1');
    expect(normUrl('http://g.page/r/x/review')).toBe('https://g.page/r/x/review');
    expect(normUrl('https://g.page/r/x')).toBe('https://g.page/r/x');
    expect(normUrl('  ')).toBeNull();
    expect(normUrl('javascript:alert(1)')).toBe('javascript:alert(1)'); // never made safe, only refused below
  });
  it('instagram', () => {
    expect(normInsta('@hotel.rambagh')).toBe('hotel.rambagh');
    expect(normInsta('https://www.instagram.com/hotel.rambagh/?hl=en')).toBe('hotel.rambagh');
    expect(normInsta('instagram.com/hotel_x')).toBe('hotel_x');
  });
  it('the strict schemas accept the friendly spellings and still refuse the unsafe ones', () => {
    expect(stayBody.parse({ reception_phone: '+91 98281 14008' }).reception_phone).toBe('919828114008');
    expect(stayBody.safeParse({ reception_phone: 'abc' }).success).toBe(false);
    expect(stayBody.safeParse({ reception_phone: '123' }).success).toBe(false);
    const b = brandingBody.parse({ google_review_url: 'g.page/r/x/review', tripadvisor_url: 'http://www.tripadvisor.in/x', instagram: 'https://instagram.com/rambagh_hotel/' });
    expect([b.google_review_url, b.tripadvisor_url, b.instagram]).toEqual(['https://g.page/r/x/review', 'https://www.tripadvisor.in/x', 'rambagh_hotel']);
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'ftp://x.com', 'not a link']) expect(brandingBody.safeParse({ google_review_url: bad }).success, bad).toBe(false);
  });
});
