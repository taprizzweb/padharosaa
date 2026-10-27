'use client';

import { useState } from 'react';
import { apiPost } from '@/components/staff/hooks';
import { errText, small, type Flash } from '@/components/billing/common';
import { HK_LABEL, type Chart, type HkStatus } from '@/lib/padharosaa/frontoffice';

const TONE: Record<HkStatus, string> = { clean: 'border-emerald-300 bg-emerald-50', dirty: 'border-red-300 bg-red-50', cleaning: 'border-amber-300 bg-amber-50', out_of_order: 'border-stone-300 bg-stone-100' };
const NEXT: Record<HkStatus, [HkStatus, string][]> = {
  dirty: [['cleaning', 'Start cleaning'], ['clean', 'Mark clean']], cleaning: [['clean', 'Mark clean']], clean: [['dirty', 'Mark dirty']], out_of_order: [['dirty', 'Back in service']],
};

/** One card per room with its cleaning status. A room becomes dirty by itself when a guest checks out. */
export function Housekeeping({ chart, flash, onChanged }: { chart: Chart; flash: Flash; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<HkStatus | 'all'>('all');
  const set = async (room: string, status: HkStatus, note?: string) => {
    setBusy(room);
    try { await apiPost('/api/padharosaa/v1/staff/frontoffice/housekeeping', { room, status, note: note ?? null }); onChanged(); } catch (e) { flash(false, errText(e, 'The room could not be updated.')); }
    setBusy(null);
  };
  const order: HkStatus[] = ['dirty', 'cleaning', 'clean', 'out_of_order'];
  const rooms = chart.rooms.filter((r) => filter === 'all' || r.hk_status === filter).sort((a, b) => order.indexOf(a.hk_status) - order.indexOf(b.hk_status) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  return (
    <section className="mt-4" aria-label="Housekeeping">
      <div role="group" aria-label="Show rooms" className="flex flex-wrap gap-2">
        {(['all', ...order] as const).map((k) => {
          const n = k === 'all' ? chart.rooms.length : chart.rooms.filter((r) => r.hk_status === k).length;
          return <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${filter === k ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white'}`}>{k === 'all' ? 'All' : HK_LABEL[k]} {n}</button>;
        })}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((r) => (
          <div key={r.id} className={`rounded-xl border p-4 ${TONE[r.hk_status]}`} data-testid="hk-card">
            <div className="flex items-baseline justify-between gap-2"><p className="text-xl font-semibold">{r.number}</p><p className="text-xs font-semibold uppercase tracking-wide text-stone-600">{HK_LABEL[r.hk_status]}</p></div>
            <p className="text-xs text-stone-600">{r.type ?? 'No type'} · {r.occupied ? 'guest in the room' : 'empty'}</p>
            {r.hk_note && <p className="mt-1 text-sm">{r.hk_note}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {NEXT[r.hk_status].map(([to, label]) => <button key={to} type="button" disabled={busy === r.id} className={small} onClick={() => void set(r.id, to)}>{label}</button>)}
              {r.hk_status !== 'out_of_order' && !r.occupied && (
                <button type="button" disabled={busy === r.id} className={small} onClick={() => { const note = window.prompt(`Why is room ${r.number} out of order? (leak, AC repair…)`); if (note !== null) void set(r.id, 'out_of_order', note.trim()); }}>Out of order…</button>
              )}
            </div>
          </div>
        ))}
        {rooms.length === 0 && <p className="text-sm text-stone-600">No rooms here.</p>}
      </div>
    </section>
  );
}
