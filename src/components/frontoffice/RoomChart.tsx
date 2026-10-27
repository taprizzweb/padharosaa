'use client';

import Link from 'next/link';
import { ns } from '@/components/ui/ns';
import { addDays, barSpan, dayHead, HK_LABEL, type Chart, type ChartBar } from '@/lib/padharosaa/frontoffice';
import type { Draft } from './Reservations';

const HK_DOT: Record<string, string> = { clean: 'bg-emerald-500', dirty: 'bg-red-500', cleaning: 'bg-amber-500', out_of_order: 'bg-stone-500' };

/** Every room (rows) by day (columns): a guest in the house is a solid bar, a booking is a lighter one. An empty day starts a new booking. */
export function RoomChart({ chart, onShift, onToday, onBook }: { chart: Chart; onShift: (n: number) => void; onToday: () => void; onBook: (d: Draft) => void }) {
  const days = Array.from({ length: chart.days }, (_, i) => addDays(chart.from, i));
  const cols = { gridTemplateColumns: `repeat(${chart.days}, minmax(2.5rem, 1fr))` };
  const barsOf = (roomId: string | null) => chart.bars.filter((b) => b.room_id === roomId);
  const unassigned = barsOf(null);
  const href = (b: ChartBar) => (b.kind === 'stay' ? `/padharosaa/billing?stay=${b.id}` : null);

  const Bars = ({ bars }: { bars: ChartBar[] }) => (
    <>
      {bars.map((b) => {
        const sp = barSpan(b.from, b.to, chart.from, chart.days);
        if (!sp) return null;
        const style = { gridColumn: `${sp.col} / span ${sp.span}`, gridRow: 1 };
        const cls = `z-10 mx-0.5 my-1 flex min-w-0 items-center truncate rounded-md px-2 text-xs font-semibold ${b.kind === 'stay' ? 'bg-indigo-700 text-white' : 'border border-indigo-300 bg-indigo-100 text-indigo-950'}`;
        const label = b.kind === 'booking' ? `B${b.seq} ${b.guest}` : b.guest;
        return b.kind === 'stay'
          ? <Link key={b.id} href={href(b)!} prefetch={false} style={style} className={cls} title={`${b.guest} (in the hotel) · open the bill`}>{label}</Link>
          : <button key={b.id} type="button" style={style} className={cls} title={`${b.guest} (booked)`} onClick={() => onBook({ edit: b.id })}>{label}</button>;
      })}
    </>
  );

  return (
    <section className="mt-4" aria-label="Room chart">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ns.secondary} onClick={() => onShift(-7)} aria-label="Earlier">←</button>
        <button type="button" className={ns.secondary} onClick={onToday}>Today</button>
        <button type="button" className={ns.secondary} onClick={() => onShift(7)} aria-label="Later">→</button>
        <button type="button" className={`${ns.primary} ml-auto`} onClick={() => onBook({})}>New booking</button>
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <div className="min-w-[44rem]" data-testid="room-chart">
          <div className="grid grid-cols-[7.5rem_1fr] border-b border-stone-200 bg-stone-50">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[.08em] text-stone-500">Room</div>
            <div className="grid" style={cols}>
              {days.map((d) => { const h = dayHead(d); return (
                <div key={d} className={`py-1.5 text-center text-xs ${d === chart.today ? 'bg-indigo-50 font-semibold text-indigo-900' : 'text-stone-600'}`}><div>{h.dow}</div><div className="text-sm font-semibold">{h.dom}</div></div>
              ); })}
            </div>
          </div>
          {unassigned.length > 0 && (
            <div className="grid grid-cols-[7.5rem_1fr] border-b border-stone-200 bg-amber-50/50">
              <div className="px-3 py-2 text-sm font-semibold text-amber-900">No room yet</div>
              <div className="grid" style={cols}><Bars bars={unassigned} /></div>
            </div>
          )}
          {chart.rooms.length === 0 && <p className="p-4 text-sm text-stone-600">No rooms yet. Rooms are added in the owner console (Hotel).</p>}
          {chart.rooms.map((r) => (
            <div key={r.id} className="grid grid-cols-[7.5rem_1fr] border-b border-stone-100 last:border-0" data-testid="chart-row">
              <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                <span aria-hidden title={HK_LABEL[r.hk_status]} className={`h-2.5 w-2.5 shrink-0 rounded-full ${HK_DOT[r.hk_status]}`} />
                <div className="min-w-0"><p className="text-sm font-semibold">{r.number}</p>{r.type && <p className="truncate text-[11px] text-stone-500">{r.type}</p>}</div>
              </div>
              <div className="relative grid" style={cols}>
                {days.map((d, i) => (
                  <button key={d} type="button" aria-label={`Book room ${r.number} from ${d}`} style={{ gridColumn: i + 1, gridRow: 1 }} disabled={d < chart.today}
                    className={`border-l border-stone-100 hover:bg-indigo-50 disabled:cursor-default disabled:hover:bg-transparent ${d === chart.today ? 'bg-indigo-50/50' : ''}`} onClick={() => onBook({ room: r.id, from: d })} />
                ))}
                <Bars bars={barsOf(r.id)} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        <span><i className="mr-1 inline-block h-2.5 w-4 rounded bg-indigo-700 align-middle" />in the hotel</span>
        <span><i className="mr-1 inline-block h-2.5 w-4 rounded border border-indigo-300 bg-indigo-100 align-middle" />booked</span>
        {(['clean', 'dirty', 'cleaning', 'out_of_order'] as const).map((k) => <span key={k}><i className={`mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle ${HK_DOT[k]}`} />{HK_LABEL[k]}</span>)}
      </p>
    </section>
  );
}
