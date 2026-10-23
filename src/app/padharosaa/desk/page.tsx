import type { Metadata } from 'next';
import { renderArea } from '../area';

export const metadata: Metadata = { title: 'Padharosaa desk', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// The shared live request board: any active staff member sees the requests their own role may act on.
export default function DeskPage() {
  return renderArea('desk');
}
