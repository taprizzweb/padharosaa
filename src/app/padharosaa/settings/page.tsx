import type { Metadata } from 'next';
import { renderArea } from '../area';

export const metadata: Metadata = { title: 'Padharosaa Settings', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function Page() {
  return renderArea('settings');
}
