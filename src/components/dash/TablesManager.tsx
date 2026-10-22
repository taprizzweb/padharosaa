'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Notice, Sheet, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { dashPost, errText, inputCls } from './api';
import { HelpLinkCard, type HelpLink } from './HelpLinkCard';
import { RoomServiceCard, type RoomService } from './RoomServiceCard';
import { TableLinkCard, type TableLink } from './TableLinkCard';

export interface TableRow { id: string; label: string; active: boolean; qr: string }
const smallBtn = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50';

export function TablesManager({ tables, roomService, tableLink, helpLink, canEditLinks }: { tables: TableRow[]; roomService: RoomService; tableLink: TableLink; helpLink: HelpLink; canEditLinks: boolean }) {
  const router = useRouter();
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rotate, setRotate] = useState<TableRow | null>(null);
  const [rename, setRename] = useState<TableRow | null>(null);
  const [label, setLabel] = useState('');

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); router.refresh(); return true; } catch (e) { setErr(errText(e)); return false; } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Tables &amp; QR codes</h1>
        <a href="/dash/print?layout=sheet" target="_blank" rel="noopener" className={btnSecondary}>Print QR sheet (A4)</a>
        <a href="/dash/print?layout=tent" target="_blank" rel="noopener" className={btnSecondary}>Print table tents (A4)</a>
      </div>
      <div className="mt-3 space-y-2" aria-live="polite">
        {err && <Alert>{err}</Alert>}
        {msg && <Notice>{msg}</Notice>}
      </div>

      <form className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4" onSubmit={(e) => {
        e.preventDefault();
        void run(() => dashPost('tables-create', { from: Number(from), to: Number(to) }), 'Tables created. Tables that already existed were left as they are.');
      }}>
        <p className="w-full font-semibold">Add tables numbered…</p>
        <label className="text-sm font-semibold">From
          <input type="number" min={1} max={999} required value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-28`} />
        </label>
        <label className="text-sm font-semibold">To
          <input type="number" min={1} max={999} required value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-28`} />
        </label>
        <button type="submit" disabled={busy} className={btnPrimary}>Create tables</button>
      </form>

      <p className="mt-3 text-sm text-stone-800">Three ways to take orders. Use any of them: <strong>a separate QR for each table</strong> (below), <strong>one shared table link</strong>, and <strong>one shared room link</strong> for room service. Tables never show rooms and rooms never show tables.</p>
      <TableLinkCard link={tableLink} canEdit={canEditLinks} />
      <RoomServiceCard rs={roomService} canEdit={canEditLinks} />
      <HelpLinkCard link={helpLink} canEdit={canEditLinks} />
      <h2 className="mt-6 text-lg font-extrabold">A separate QR for each table</h2>

      {tables.length === 0 && <p className="mt-6 text-stone-800">No tables yet. Create your first tables above, then print their QR codes.</p>}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {tables.map((t) => (
          <li key={t.id} className="flex gap-3 rounded-2xl border border-stone-200 bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.qr} alt={`QR code for table ${t.label}`} width={112} height={112} className="h-28 w-28 shrink-0 rounded-lg border border-stone-200" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold">Table {t.label}{!t.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold">Off</span>}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <a href={`/dash/print?layout=tent&t=${t.id}`} target="_blank" rel="noopener" className={smallBtn} aria-label={`Print table ${t.label}`}>Print</a>
                <button type="button" className={smallBtn} onClick={() => { setRename(t); setLabel(t.label); }} aria-label={`Rename table ${t.label}`}>Rename</button>
                <button type="button" className={smallBtn} disabled={busy} onClick={() => void run(() => dashPost('table-save', { id: t.id, label: t.label, active: !t.active }), t.active ? 'Table switched off. Its QR code stops working.' : 'Table switched on.')} aria-label={`${t.active ? 'Switch off' : 'Switch on'} table ${t.label}`}>{t.active ? 'Switch off' : 'Switch on'}</button>
                <button type="button" className={smallBtn} onClick={() => setRotate(t)} aria-label={`New QR code for table ${t.label}`}>New QR</button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Sheet open={!!rotate} onClose={() => setRotate(null)} title={`New QR code for table ${rotate?.label ?? ''}?`} closeLabel="Close">
        <p className="text-stone-800">The old printed QR code for this table will <strong>stop working immediately</strong>. Use this if someone has copied or misused the code. You will need to print and place the new one.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setRotate(null)}>Cancel</button>
          <button type="button" className={`${btnPrimary} flex-1`} disabled={busy} onClick={async () => { const t = rotate; setRotate(null); if (t) await run(() => dashPost('table-rotate', { id: t.id }), `Table ${t.label} has a new QR code. Print it again.`); }}>Yes, make a new QR</button>
        </div>
      </Sheet>
      <Sheet open={!!rename} onClose={() => setRename(null)} title="Rename table" closeLabel="Close">
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const t = rename; if (!t) return; if (await run(() => dashPost('table-save', { id: t.id, label, active: t.active }), 'Table renamed.')) setRename(null); }}>
          <label className="block text-sm font-semibold">Table name
            <input required maxLength={20} value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
          </label>
          {err && <Alert>{err}</Alert>}
          <button type="submit" className={`${btnPrimary} w-full`}>Save</button>
        </form>
      </Sheet>
    </div>
  );
}
