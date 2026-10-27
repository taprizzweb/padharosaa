'use client';

import { ns } from '@/components/ui/ns';
import { dateLabel, rupees2, type StayRow } from '@/lib/padharosaa/billing';
import { td, th } from './common';

/** Everyone in the hotel now (or the last guests who left), each with what is still to be paid. */
export function Stays({ rows, past, onOpen }: { rows: StayRow[] | null; past?: boolean; onOpen: (id: string) => void }) {
  if (rows === null) return <p className="mt-6" role="status">…</p>;
  if (rows.length === 0) return <p className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">{past ? 'No guest has checked out yet.' : 'Nobody is checked in. Use "Check in" when a guest arrives.'}</p>;
  const due = rows.reduce((n, r) => n + Math.max(0, r.balance_paise), 0);
  return (
    <section className={`mt-4 ${ns.card} !p-0 overflow-x-auto`} data-testid={past ? 'past-guests' : 'in-house'}>
      <table className="w-full min-w-[620px] text-sm">
        <thead><tr className="border-b border-stone-200 bg-stone-50"><th className={th}>Room</th><th className={th}>Guest</th><th className={th}>{past ? 'Left' : 'Leaving'}</th><th className={`${th} text-right`}>Bill</th><th className={`${th} text-right`}>{past ? 'Invoice' : 'To pay'}</th><th className={th}><span className="sr-only">Open</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
              <td className={`${td} font-semibold`}>{r.room}</td>
              <td className={td}>{r.guest_name}{r.company_name ? <span className="block text-xs text-stone-500">{r.company_name}</span> : null}</td>
              <td className={td}>{dateLabel(past && r.checked_out_at ? r.checked_out_at : r.check_out_on)}</td>
              <td className={`${td} text-right tabular-nums`}>{rupees2(r.total_paise)}</td>
              <td className={`${td} text-right tabular-nums ${!past && r.balance_paise > 0 ? 'font-semibold text-amber-900' : ''}`}>{past ? r.invoice_number : rupees2(r.balance_paise)}</td>
              <td className={`${td} text-right`}><button type="button" className={`${ns.secondary} !min-h-9`} onClick={() => onOpen(r.id)}>{past ? 'Open' : 'Open bill'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!past && <p className="border-t border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-600">{rows.length} guest{rows.length === 1 ? '' : 's'} in the hotel · {rupees2(due)} still to be collected</p>}
    </section>
  );
}
