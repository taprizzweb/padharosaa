'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Notice, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { dashPost, errText, inputCls } from './api';

export interface TableLink { enabled: boolean; url: string | null; qr: string | null }

/** One shared link for all tables: the guest picks their table number, then orders. Only real tables are offered. Owner edits; managers can view. */
export function TableLinkCard({ link, canEdit }: { link: TableLink; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = async (body: { enabled: boolean; rotate?: boolean }, ok: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await dashPost('table-link-save', body); setMsg(ok); router.refresh(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setErr('Could not copy. Select the link and copy it by hand.'); }
  };

  return (
    <section aria-labelledby="tlink-h" className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="tlink-h" className="mr-auto text-lg font-extrabold">Shared table link</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${link.enabled ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-900'}`}>{link.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-stone-800">One link or QR for all tables (menu card, website, WhatsApp). The guest picks their table number from the list of your tables, then orders. It shows tables only, never rooms. Use it instead of, or along with, the separate QR code for each table below.</p>
      <div className="mt-3 space-y-2" aria-live="polite">
        {err && <Alert>{err}</Alert>}
        {msg && <Notice>{msg}</Notice>}
      </div>

      {link.enabled && link.url && link.qr && (
        <div className="mt-3 flex flex-wrap gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={link.qr} alt="QR code for the shared table link" width={128} height={128} className="h-32 w-32 rounded-lg border border-stone-200" />
          <div className="min-w-0 flex-1">
            <label className="block text-sm font-semibold">Table link
              <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} text-sm`} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={btnSecondary} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
              <a href="/dash/print?layout=tablelink" target="_blank" rel="noopener" className={btnSecondary}>Print card (A4)</a>
            </div>
          </div>
        </div>
      )}

      {canEdit ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {!link.enabled && <button type="button" disabled={busy} className={btnPrimary} onClick={() => void save({ enabled: true }, 'Shared table link is on. Share the link or print the card.')}>Turn on shared table link</button>}
          {link.enabled && <button type="button" disabled={busy} className={btnSecondary} onClick={() => void save({ enabled: false }, 'Shared table link is off. The old link stopped working.')}>Turn off</button>}
          {link.enabled && <button type="button" disabled={busy} className={btnSecondary} onClick={() => { if (window.confirm('The current link and QR will stop working. You will need to share the new one. Continue?')) void save({ enabled: true, rotate: true }, 'New link created. The old one no longer works.'); }}>New link</button>}
        </div>
      ) : (
        <p className="mt-3 text-sm text-stone-800">Only the owner can change this.</p>
      )}
    </section>
  );
}
