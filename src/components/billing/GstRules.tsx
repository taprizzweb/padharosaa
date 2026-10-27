'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { Card, ns } from '@/components/ui/ns';
import { pct } from '@/lib/padharosaa/billing';
import { Label, errText, field, td, th, type Flash } from './common';

interface Rules { usual_bp: number; rates: { name: string; rate_bp: number }[]; rules: { id: string; word: string; rate_bp: number; active: boolean }[] }

/** GST by menu word: "beer" and "whisky" at 18%, "bar" with no GST... A dish is taxed by the rule whose word is in its name or in its section's name. */
export function GstRules({ flash }: { flash: Flash }) {
  const [d, setD] = useState<Rules | null>(null);
  const [word, setWord] = useState('');
  const [rate, setRate] = useState('0');
  const load = useCallback(async () => { try { setD(await apiGet<Rules>('/api/padharosaa/v1/staff/tax-rules')); } catch (e) { flash(false, errText(e)); } }, [flash]);
  useEffect(() => { void load(); }, [load]);
  const save = async (w: string, bp: number, active: boolean, ok: string) => {
    try { await apiPost('/api/padharosaa/v1/staff/tax-rules', { word: w, rate_bp: bp, active }); flash(true, ok); await load(); return true; } catch (e) { flash(false, errText(e)); return false; }
  };
  const label = (bp: number) => (bp === 0 ? 'No GST' : pct(bp));
  return (
    <Card title="GST by menu word" hint="Food from the bar, or a section like Beverages, is often taxed differently from kitchen food. Type a word and pick its GST. Any dish whose name or section has that word gets this GST on room bills and counter bills. Everything else gets your usual food GST.">
      <div data-testid="gst-rules">
        <p className="text-sm text-stone-600">Usual GST for food: <b>{d ? label(d.usual_bp) : '…'}</b> (change it above, under “What each charge is taxed at”).</p>
        {d && d.rules.length > 0 && (
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead><tr className="border-b border-stone-200"><th className={th}>Word</th><th className={th}>GST</th><th className={th}>On</th></tr></thead>
            <tbody>{d.rules.map((r) => (
              <tr key={r.id} className={`border-b border-stone-100 ${r.active ? '' : 'opacity-60'}`}>
                <td className={td}><b>{r.word}</b></td>
                <td className={td}>
                  <select aria-label={`GST for ${r.word}`} className={`${field} !mt-0 !min-h-9 w-40`} value={r.rate_bp} onChange={(e) => void save(r.word, Number(e.target.value), r.active, `${r.word}: ${label(Number(e.target.value))}.`)}>
                    <option value={0}>No GST</option>
                    {d.rates.filter((t) => t.rate_bp > 0).map((t) => <option key={t.rate_bp} value={t.rate_bp}>{t.name}</option>)}
                    {r.rate_bp > 0 && !d.rates.some((t) => t.rate_bp === r.rate_bp) && <option value={r.rate_bp}>{pct(r.rate_bp)}</option>}
                  </select>
                </td>
                <td className={td}><button type="button" className={`${ns.secondary} !min-h-9`} aria-label={`${r.active ? 'Switch off' : 'Switch on'} ${r.word}`} onClick={() => void save(r.word, r.rate_bp, !r.active, r.active ? `${r.word} switched off.` : `${r.word} switched on.`)}>{r.active ? 'On' : 'Off'}</button></td>
              </tr>))}</tbody></table></div>
        )}
        {d && d.rules.length === 0 && <p className="mt-3 text-sm font-semibold text-amber-900">No rules yet, so every dish takes the usual food GST.</p>}
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (word.trim() && await save(word.trim(), Number(rate), true, 'Rule saved.')) setWord(''); }}>
          <Label text="Word in the dish or section name"><input className={`${field} !mt-1 w-56`} value={word} maxLength={29} placeholder="beer, whisky, bar..." onChange={(e) => setWord(e.target.value)} /></Label>
          <Label text="GST"><select aria-label="GST for the new word" className={`${field} !mt-1 w-44`} value={rate} onChange={(e) => setRate(e.target.value)}><option value="0">No GST</option>{d?.rates.filter((t) => t.rate_bp > 0).map((t) => <option key={t.rate_bp} value={t.rate_bp}>{t.name}</option>)}</select></Label>
          <button type="submit" className={ns.primary} disabled={word.trim().length < 2}>Add the rule</button>
        </form>
        <p className="mt-2 text-xs text-stone-500">Letters and numbers only. “beer” also catches “beers”. If two words fit one dish, the longer word wins. A rule is never deleted; switch it off instead.</p>
      </div>
    </Card>
  );
}
