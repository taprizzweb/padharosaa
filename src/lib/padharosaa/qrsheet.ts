/** The address printed on one room's QR code: the hotel's link with the room added. The secret key in the link is the same for every room. */
export function roomLink(link: string, room: string): string {
  const u = new URL(link);
  u.searchParams.set('r', room.trim().toUpperCase());
  return u.toString();
}
