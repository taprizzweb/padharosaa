/**
 * Hotel phone numbers are stored as digits only ("919828114008", no plus sign). A phone dials "tel:919828114008" as a local number and the call
 * fails, so every call link goes through dialNumber, which always gives the international form ("+919828114008"), and screens show prettyPhone.
 */
export function dialNumber(p: string): string {
  const raw = p.trim();
  const d = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return `+${d}`;
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `+91${d.slice(1)}`;
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return d;
}

/** "919828114008" -> "+91 98281 14008"; other international numbers get a plus sign; anything else is shown as typed. */
export function prettyPhone(p: string | null | undefined): string {
  if (!p) return '';
  const n = dialNumber(p);
  const m = /^\+91(\d{5})(\d{5})$/.exec(n);
  return m ? `+91 ${m[1]} ${m[2]}` : n.startsWith('+') ? n : p;
}
