import type { Metadata } from 'next';
import { renderArea } from '../area';

export const metadata: Metadata = { title: 'Padharosaa rooms', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// The room chart, advance bookings and housekeeping. The database lets only the front office through.
export default function RoomsPage() {
  return renderArea('rooms');
}
