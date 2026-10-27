import type { Metadata } from 'next';
import { renderArea } from '../area';

export const metadata: Metadata = { title: 'Padharosaa channels', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// The channel manager: owner and manager only.
export default function Page() {
  return renderArea('channels');
}
