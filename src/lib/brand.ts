/** The platform's own credit shown at the bottom of every public menu. */
export const POWERED_BY = { name: 'Taprizz', instagram: 'taprizz.in' } as const;

/** Only a plain Instagram handle (letters, digits, dot, underscore) becomes a link, so this can never point anywhere else. */
export const instagramUrl = (handle: string): string | null => {
  const h = handle.trim().replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? `https://www.instagram.com/${h}` : null;
};
