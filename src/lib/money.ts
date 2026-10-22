/** Money is always integer paise. Only the UI turns it into rupees, and only for display. */

export function assertPaise(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`paise must be a safe integer, got ${n}`);
  return n;
}

/** 25000 -> "₹250", 25050 -> "₹250.50", 12345600 -> "₹1,23,456" (Indian digit grouping). */
export function formatPaise(paise: number): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${negative ? '-' : ''}₹${grouped}${rem ? `.${String(rem).padStart(2, '0')}` : ''}`;
}

/** Sum of unit price x quantity, for DISPLAY only. The database recomputes the real total. */
export function lineTotal(unitPaise: number, qty: number): number {
  assertPaise(unitPaise);
  assertPaise(qty);
  return unitPaise * qty;
}

/** Parse a rupee string typed by an owner ("250", "250.5", "1,200.00") into paise. Returns null if invalid. */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.trim().replace(/[₹,\s]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [r, p = ''] = cleaned.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}
