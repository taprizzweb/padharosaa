'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Notice, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { dashPost, errText, inputCls } from './api';

export interface HelpLink { enabled: boolean; url: string | null; qr: string | null; topics: string[] }

/** The hotel's "Call for problems" page: guests type their room, tap what is wrong, and reception sees it live. Owner edits; managers can view. */
export function HelpLinkCard({ link, canEdit }: { link: HelpLink; canEdit: boolean }) {
  const router = useRouter();
  const [topics, setTopics] = useState(link.topics.join('\n'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = async (body: { enabled: boolean; rotate?: boolean }, ok: string) => {
    setErr(null); setMsg(null);
    const list = topics.split('\n').map((x) => x.trim()).filter(Boolean);
    if (list.length > 20) return setErr('Up to 20 problems can be listed.');
    if (list.some((x) => x.length > 40)) return setErr('Each problem can be up to 40 characters.');
    setBusy(true);
    try { await dashPost('help-link-save', { topics: list, ...body }); setMsg(ok); router.refresh(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setErr('Could not copy. Select the link and copy it by hand.'); }
  };

  return (
    <section aria-labelledby="help-link-h" className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="help-link-h" className="mr-auto text-lg font-extrabold">Call for problems link</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${link.enabled ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-900'}`}>{link.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-stone-800">For hotels: one link for guests who need something (towel, water, light, TV, WiFi...). Add it as a button on your Smart page. The guest types their room number, taps the problems that apply and may add a few words. It appears on your staff screen at once, with a sound, until someone taps Done.</p>
      <div className="mt-3 space-y-2" aria-live="polite">
        {err && <Alert>{err}</Alert>}
        {msg && <Notice>{msg}</Notice>}
      </div>

      {link.enabled && link.url && link.qr && (
        <div className="mt-3 flex flex-wrap gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={link.qr} alt="QR code for the call for problems link" width={128} height={128} className="h-32 w-32 rounded-lg border border-stone-200" />
          <div className="min-w-0 flex-1">
            <label className="block text-sm font-semibold">Problems link
              <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} text-sm`} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={btnSecondary} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
              <a href="/dash/print?layout=help" target="_blank" rel="noopener" className={btnSecondary}>Print card (A4)</a>
            </div>
          </div>
        </div>
      )}

      {canEdit ? (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save({ enabled: true }, link.enabled ? 'Problems list saved.' : 'Call for problems is on. Add the link to your Smart page or print the card.'); }}>
          <label className="block text-sm font-semibold">Problems guests can tap (one per line)
            <textarea value={topics} onChange={(e) => setTopics(e.target.value)} rows={8} maxLength={1200} className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base font-normal" />
          </label>
          <p className="text-sm text-stone-800">Guests can also write their own words. The room number is checked against the rooms you listed under Room service link (empty list: any room number is accepted).</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>{link.enabled ? 'Save problems' : 'Turn on call for problems'}</button>
            {link.enabled && <button type="button" disabled={busy} className={btnSecondary} onClick={() => void save({ enabled: false }, 'Call for problems is off. The old link stopped working.')}>Turn off</button>}
            {link.enabled && <button type="button" disabled={busy} className={btnSecondary} onClick={() => { if (window.confirm('The current link and QR will stop working. You will need to update your Smart page. Continue?')) void save({ enabled: true, rotate: true }, 'New link created. The old one no longer works.'); }}>New link</button>}
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-stone-800">Only the owner can change this.</p>
      )}
    </section>
  );
}
