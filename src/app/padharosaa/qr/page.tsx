import type { Metadata } from 'next';
import { renderArea } from '../area';

export const metadata: Metadata = { title: 'Padharosaa QR codes', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// The printable QR sheet: one code for the hotel, or one for every room with the room already filled in. Owner and manager only.
export default function QrPage() {
  return renderArea('qr');
}
