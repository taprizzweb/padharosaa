import type { Metadata } from 'next';
import { renderArea } from '../area';

export const metadata: Metadata = { title: 'Padharosaa billing', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Check-in, each guest's bill and invoice, and (owner and manager) the taxes and rates. The database decides who may do what.
export default function BillingPage() {
  return renderArea('billing');
}
