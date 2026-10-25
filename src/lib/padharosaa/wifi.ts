/**
 * The hotel's Wi-Fi system gives a list of logins, one per guest: a username (often numbers) and a short password. The owner pastes it as it is:
 * one login per line, the two parts separated by a space, a comma, a semicolon or a tab. Anything that is not a login is reported, never guessed at.
 */
export interface Voucher { username: string; password: string }

export function parseVoucherLines(text: string): { ok: Voucher[]; bad: string[] } {
  const ok: Voucher[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(username|user|login)\b.*\b(password|pass|pwd)\b/i.test(line)) continue; // a header row
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length !== 2 || parts[0]!.length > 64 || parts[1]!.length > 64) { bad.push(line.slice(0, 60)); continue; }
    if (seen.has(parts[0]!)) continue;
    seen.add(parts[0]!);
    ok.push({ username: parts[0]!, password: parts[1]! });
  }
  return { ok, bad };
}
