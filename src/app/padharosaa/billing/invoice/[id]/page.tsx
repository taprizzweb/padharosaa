import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InvoiceView } from '@/components/billing/InvoiceView';
import { idParam } from '@/lib/padharosaa/schemas';

export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// The printable invoice. Sign-in is checked by the middleware; the database decides whether this person may see this hotel's invoice.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idParam.safeParse(id).success) notFound();
  return <InvoiceView stayId={id} />;
}
