import { randomInt } from 'node:crypto';

// No look-alike characters (0/O, 1/l/I) because a person will read this out or type it from a screen.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 16 random characters (about 93 bits). Shown to the owner once, and must be changed at first sign-in. */
export function temporaryPassword(length = 16): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
