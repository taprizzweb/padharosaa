import type { Metadata } from 'next';
import { renderArea } from '../area';

export const metadata: Metadata = { title: 'Padharosaa inventory', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Stock of kitchen and housekeeping supplies: owner, manager and kitchen. The database decides who may do what.
export default function InventoryPage() {
  return renderArea('inventory');
}
