import 'server-only';
import QRCode from 'qrcode';

/** The address a table's QR code opens. The token is the table's secret; rotating it makes old printed codes useless. */
export const tableUrl = (origin: string, slug: string, token: string): string => `${origin.replace(/\/$/, '')}/${slug}?k=${token}`;

/** The hotel's shared "call for problems" page; reached from the Smart page or its own QR. */
export const helpUrl = (origin: string, slug: string, token: string): string => `${origin.replace(/\/$/, '')}/${slug}/help?k=${token}`;

/** QR drawn on the server as SVG and handed to the page as an image (no QR library is sent to the browser). */
export async function qrDataUri(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
