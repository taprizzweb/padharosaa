'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/components/staff/hooks';
import { taxesMissing, type BillingSetup, type StayRow } from '@/lib/padharosaa/billing';
import { CheckIn } from './CheckIn';
import { FolioView } from './FolioView';
import { SetupPanel } from './SetupPanel';
import { Stays } from './Stays';
import { errText } from './common';

const API = '/api/padharosaa/v1/staff';
type Tab = 'house' | 'checkin' | 'past' | 'setup';

/** Front office and billing: who is in the hotel, check-in, each guest's bill and invoice, and (owner and manager) the billing setup. */
export function BillingApp({ role }: { role: string }) {
  const canSetup = role === 'owner' || role === 'manager';
  const [tab, setTab] = useState<Tab>('house');
  const [stayId, setStayId] = useState<string | null>(null);
  const [setup, setSetup] = useState<BillingSetup | null>(null);
  const [inHouse, setInHouse] = useState<StayRow[] | null>(null);
  const [past, setPast] = useState<StayRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = useCallback((ok: boolean, text: string) => { setMsg({ ok, text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  const loadSetup = useCallback(async () => { try { setSetup(await apiGet<BillingSetup>(`${API}/billing`)); } catch (e) { flash(false, errText(e, 'The billing setup could not be loaded.')); } }, [flash]);
  const loadStays = useCallback(async () => {
    try {
      setInHouse((await apiGet<{ stays: StayRow[] }>(`${API}/stays?status=in_house`)).stays);
      setPast((await apiGet<{ stays: StayRow[] }>(`${API}/stays?status=checked_out`)).stays);
    } catch (e) { flash(false, errText(e, 'The guest list could not be loaded.')); }
  }, [flash]);
  useEffect(() => { void loadSetup(); void loadStays(); }, [loadSetup, loadStays]);
  const [presetRoom, setPresetRoom] = useState<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const id = sp.get('stay'); if (id && /^[0-9a-f-]{36}$/i.test(id)) setStayId(id);
    const room = sp.get('checkin'); if (room && /^[0-9a-f-]{36}$/i.test(room)) { setPresetRoom(room); setTab('checkin'); }
  }, []);
  useEffect(() => { const i = setInterval(() => { if (!document.hidden) void loadStays(); }, 30_000); return () => clearInterval(i); }, [loadStays]);

  const open = (id: string) => { setStayId(id); setTab('house'); };
  const tabs: [Tab, string][] = [['house', `In the hotel${inHouse ? ` (${inHouse.length})` : ''}`], ['checkin', 'Check in'], ['past', 'Past guests'], ...(canSetup ? ([['setup', 'Taxes & rates']] as [Tab, string][]) : [])];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-3 text-stone-900">
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{msg.text}</p>}
      {setup && taxesMissing(setup) && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status" data-testid="taxes-missing">
          Taxes are not set yet, so bills show no tax. {canSetup ? <>Set them in <button type="button" className="font-semibold underline" onClick={() => { setStayId(null); setTab('setup'); }}>Taxes &amp; rates</button>.</> : 'Please ask the owner or manager to set them.'}
        </p>
      )}
      <div role="tablist" aria-label="Billing sections" className="-mx-4 mt-4 flex gap-6 overflow-x-auto border-b border-stone-200 px-4">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setStayId(null); }}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-0.5 text-sm font-semibold ${tab === k ? 'border-indigo-900 text-indigo-900' : 'border-transparent text-stone-500'}`}>{label}</button>
        ))}
      </div>
      {!setup ? <p className="mt-6" role="status">…</p> : stayId ? (
        <FolioView stayId={stayId} setup={setup} flash={flash} onBack={() => setStayId(null)} onChanged={() => void loadStays()} />
      ) : (
        <>
          {tab === 'house' && <Stays rows={inHouse} onOpen={open} />}
          {tab === 'checkin' && <CheckIn presetRoom={presetRoom} setup={setup} inHouse={inHouse ?? []} flash={flash} onDone={() => void loadStays()} onOpen={open} />}
          {tab === 'past' && <Stays rows={past} past onOpen={open} />}
          {tab === 'setup' && canSetup && <SetupPanel setup={setup} reload={loadSetup} flash={flash} />}
        </>
      )}
    </div>
  );
}
