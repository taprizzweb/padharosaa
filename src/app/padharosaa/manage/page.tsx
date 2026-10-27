import type { Metadata } from 'next';
import { renderArea } from '../area';

export const metadata: Metadata = { title: 'Padharosaa manage', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// The old address of the console: it opens the owner's or manager's dashboard.
export default function ManagePage() {
  return renderArea('manager');
}
