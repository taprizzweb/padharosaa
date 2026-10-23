// People type phone numbers and links the way they know them. These turn the common spellings into the one strict form the
// database accepts, so a manager is never told "could not be saved" for "+91 98281 14008" or "www.tripadvisor.com/...".
// Anything that still does not fit is passed through unchanged and refused by the strict check that follows.

/** "+91 98281-14008", "098281 14008", "9828114008" -> "919828114008" (Indian 10-digit mobiles get 91 in front). */
export function normPhone(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const d = v.replace(/[\s()+.-]/g, '');
  if (!/^\d+$/.test(d)) return v;
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d;
}

/** "www.x.com/a", "x.com/a", "http://x.com/a" -> "https://..."; empty -> null. */
export function normUrl(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t) return null;
  if (/^https:\/\//i.test(t)) return t;
  if (/^http:\/\//i.test(t)) return `https://${t.slice(7)}`;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|$|\?)/i.test(t)) return `https://${t}`;
  return t;
}

/** "@hotel", "hotel", "https://www.instagram.com/hotel/?hl=en" -> "hotel"; empty -> null. */
export function normInsta(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  let t = v.trim();
  if (!t) return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(t);
  if (m) t = m[1]!;
  return t.replace(/^@/, '');
}
