'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/components/staff/hooks';
import { dateLabel, payModeLabel, pct, rupees2, type InvoiceResponse } from '@/lib/padharosaa/billing';
import { errText } from './common';

/** The invoice as it is printed: the hotel, the guest, the lines, the tax by rate, what was paid. Print it or save it as a PDF from the browser. */
export function InvoiceView({ stayId }: { stayId: string }) {
  const [inv, setInv] = useState<InvoiceResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { apiGet<InvoiceResponse>(`/api/padharosaa/v1/staff/stays/${stayId}/invoice`).then(setInv).catch((e) => setErr(errText(e, 'The invoice could not be loaded.'))); }, [stayId]);
  if (err) return <main className="p-8 text-center font-semibold" role="alert">{err}</main>;
  if (!inv) return <main className="p-8 text-center" role="status">…</main>;
  const { hotel, folio: f } = inv;
  const s = f.stay;
  const name = hotel.legal_name || hotel.name;
  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-sm text-stone-900 print:max-w-none print:p-0" data-testid="invoice">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <button type="button" className="inline-flex min-h-11 items-center rounded-lg bg-indigo-900 px-4 text-sm font-semibold text-white" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <header className="flex items-start justify-between gap-4 border-b border-stone-300 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
          {hotel.address && <p className="mt-1 whitespace-pre-line text-stone-600">{hotel.address}</p>}
          {hotel.gstin && <p className="mt-1 font-semibold">GSTIN {hotel.gstin}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">{hotel.gstin ? 'Tax invoice' : 'Invoice'}</p>
          <p className="mt-1 text-lg font-semibold" data-testid="invoice-number">{inv.number}</p>
          <p className="text-stone-600">{dateLabel(inv.issued_at)}</p>
        </div>
      </header>
      <section className="grid gap-4 border-b border-stone-300 py-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">Billed to</p>
          <p className="mt-1 font-semibold">{s.company_name || s.guest_name}</p>
          {s.company_name && <p>Guest: {s.guest_name}</p>}
          {s.company_gstin && <p>GSTIN {s.company_gstin}</p>}
          {s.address && <p className="whitespace-pre-line text-stone-600">{s.address}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">Stay</p>
          <p className="mt-1">Room {s.room}{s.room_type ? ` · ${s.room_type}` : ''}</p>
          <p>{dateLabel(s.check_in_at)} to {dateLabel(s.check_out_on)} · {s.nights} night{s.nights === 1 ? '' : 's'}</p>
        </div>
      </section>
      <table className="mt-4 w-full">
        <thead><tr className="border-b border-stone-300 text-left text-xs uppercase tracking-[.08em] text-stone-500"><th className="py-2">Description</th><th className="py-2">SAC</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Amount</th><th className="py-2 text-right">Tax</th></tr></thead>
        <tbody>{f.lines.map((l, i) => (
          <tr key={i} className="border-b border-stone-100"><td className="py-2">{l.description}</td><td className="py-2 text-stone-500">{l.sac ?? ''}</td><td className="py-2 text-right tabular-nums">{l.qty}</td><td className="py-2 text-right tabular-nums">{rupees2(l.amount_paise)}</td><td className="py-2 text-right text-stone-500">{l.tax_bp ? pct(l.tax_bp) : '–'}</td></tr>
        ))}</tbody>
      </table>
      <table className="ml-auto mt-4 w-full max-w-md" data-testid="invoice-totals">
        <tbody>
          <tr><td className="py-1">Amount before tax</td><td className="py-1 text-right tabular-nums">{rupees2(f.subtotal_paise)}</td></tr>
          {f.tax_groups.filter((g) => g.tax_paise !== 0).map((g) => s.inter_state
            ? <tr key={g.tax_bp} className="text-stone-600"><td className="py-1">IGST {pct(g.tax_bp)} on {rupees2(g.taxable_paise)}</td><td className="py-1 text-right tabular-nums">{rupees2(g.igst_paise)}</td></tr>
            : [<tr key={`${g.tax_bp}c`} className="text-stone-600"><td className="py-1">CGST {pct(g.tax_bp / 2)} on {rupees2(g.taxable_paise)}</td><td className="py-1 text-right tabular-nums">{rupees2(g.cgst_paise)}</td></tr>,
               <tr key={`${g.tax_bp}s`} className="text-stone-600"><td className="py-1">SGST {pct(g.tax_bp / 2)} on {rupees2(g.taxable_paise)}</td><td className="py-1 text-right tabular-nums">{rupees2(g.sgst_paise)}</td></tr>])}
          {f.round_off_paise !== 0 && <tr className="text-stone-600"><td className="py-1">Round off</td><td className="py-1 text-right tabular-nums">{rupees2(f.round_off_paise)}</td></tr>}
          <tr className="border-t border-stone-300 text-base font-semibold"><td className="py-2">Total</td><td className="py-2 text-right tabular-nums">{rupees2(f.total_paise)}</td></tr>
        </tbody>
      </table>
      {f.payments.length > 0 && (
        <section className="mt-4 border-t border-stone-300 pt-3">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">Received</p>
          <ul className="mt-1">{f.payments.map((p) => <li key={p.id} className="flex justify-between py-0.5"><span>{p.kind === 'refund' ? 'Given back' : p.kind === 'advance' ? 'Advance' : 'Payment'} · {payModeLabel(p.mode)}</span><span className="tabular-nums">{p.kind === 'refund' ? '−' : ''}{rupees2(p.amount_paise)}</span></li>)}</ul>
        </section>
      )}
      {hotel.terms && <p className="mt-6 whitespace-pre-line border-t border-stone-300 pt-3 text-xs text-stone-600">{hotel.terms}</p>}
      <p className="mt-6 text-center text-xs text-stone-400">Thank you for staying with us.</p>
    </main>
  );
}
