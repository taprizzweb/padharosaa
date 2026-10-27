'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { Card, ns } from '@/components/ui/ns';
import { ApiFailure } from '@/lib/guest/client';
import { prettyPhone } from '@/lib/padharosaa/phone';

interface G { id: string; name: string; title: string | null; about: string | null; languages: string | null; charges: string | null; phone: string | null; whatsapp: string | null; instagram: string | null; linkedin: string | null; active: boolean; sort: number }
const BLANK = { id: '', name: '', title: '', about: '', languages: '', charges: '', phone: '', whatsapp: '', instagram: '', linkedin: '', active: true, sort: '100' };
type Form = typeof BLANK;
const base = '/api/padharosaa/v1/staff/local-guides';
const input = 'mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900';

/** Owner and manager: the people guests can contact (guides, drivers, photographers). Optional for the hotel; only a name and one contact are needed. */
export function LocalGuidesManager({ flash }: { flash: (ok: boolean, text: string) => void }) {
  const [list, setList] = useState<G[] | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setList((await apiGet<{ guides: G[] }>(base)).guides); } catch { flash(false, 'The guides could not be loaded.'); setList([]); } }, [flash]);
  useEffect(() => { void load(); }, [load]);

  const edit = (g: G) => setF({ id: g.id, name: g.name, title: g.title ?? '', about: g.about ?? '', languages: g.languages ?? '', charges: g.charges ?? '', phone: g.phone ?? '', whatsapp: g.whatsapp ?? '', instagram: g.instagram ?? '', linkedin: g.linkedin ?? '', active: g.active, sort: String(g.sort) });
  const body = (x: Form) => ({ id: x.id || null, name: x.name.trim(), title: x.title.trim() || null, about: x.about.trim() || null, languages: x.languages.trim() || null, charges: x.charges.trim() || null,
    phone: x.phone.trim() || null, whatsapp: x.whatsapp.trim() || null, instagram: x.instagram.trim() || null, linkedin: x.linkedin.trim() || null, active: x.active, sort: Math.max(0, Math.min(10000, Number(x.sort) || 100)) });
  const send = async (x: Form, done: string) => {
    setBusy(true);
    try { await apiPost(base, body(x)); flash(true, done); setF(null); await load(); }
    catch (e) { flash(false, e instanceof ApiFailure && e.status === 400 ? 'A guide needs a name and at least one way to reach them: a phone number, WhatsApp, an Instagram name or a LinkedIn link (https://...).' : e instanceof ApiFailure && e.key === 'limit_exceeded' ? 'You can list up to 40 guides.' : 'That could not be saved. Please try again.'); }
    setBusy(false);
  };
  const toggle = (g: G) => void send({ id: g.id, name: g.name, title: g.title ?? '', about: g.about ?? '', languages: g.languages ?? '', charges: g.charges ?? '', phone: g.phone ?? '', whatsapp: g.whatsapp ?? '', instagram: g.instagram ?? '', linkedin: g.linkedin ?? '', active: !g.active, sort: String(g.sort) }, g.active ? `${g.name} is hidden from guests.` : `${g.name} is shown to guests.`);
  const set = (k: keyof Form, v: string | boolean) => setF((p) => (p ? { ...p, [k]: v } : p));
  const field = (k: keyof Form, label: string, props: { hint?: string; area?: boolean; max?: number; mode?: 'tel' | 'text' | 'url' } = {}) => (
    <label className="block text-sm font-semibold">{label}
      {props.area
        ? <textarea className={`${input} py-2`} rows={3} maxLength={props.max} value={String(f![k])} onChange={(e) => set(k, e.target.value)} />
        : <input className={input} inputMode={props.mode} maxLength={props.max} value={String(f![k])} onChange={(e) => set(k, e.target.value)} />}
      {props.hint && <span className="mt-1 block text-xs font-normal text-stone-500">{props.hint}</span>}
    </label>
  );
  return (
    <Card title="Local guides (people)" hint="Guides, drivers or photographers you recommend. Guests see them under 'Local guides' with their charges and contacts, and can call or message them. Every detail except the name is optional, but add at least one way to reach them.">
      {list === null && <p role="status">…</p>}
      {list && list.length === 0 && !f && <p className="text-sm text-stone-600">No guides yet. Guests see the &quot;Local guides&quot; tile only after you add one.</p>}
      <ul className="divide-y divide-stone-100" data-testid="lguide-list">
        {list?.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className={`font-semibold ${g.active ? '' : 'text-stone-400 line-through'}`}>{g.name}{g.title ? <span className="font-normal text-stone-500"> · {g.title}</span> : null}</p>
              <p className="text-xs text-stone-500">{[g.phone ? prettyPhone(g.phone) : null, g.whatsapp ? `WhatsApp ${prettyPhone(g.whatsapp)}` : null, g.instagram ? `@${g.instagram}` : null, g.linkedin ? 'LinkedIn' : null, g.charges].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={`${ns.secondary} !min-h-9`} onClick={() => edit(g)}>Edit</button>
              <button type="button" className={`${ns.secondary} !min-h-9`} disabled={busy} onClick={() => toggle(g)}>{g.active ? 'Hide' : 'Show'}</button>
            </div>
          </li>
        ))}
      </ul>
      {!f && <button type="button" className={`${ns.primary} mt-3`} onClick={() => setF({ ...BLANK })}>+ Add a guide</button>}
      {f && (
        <form className="mt-4 grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) void send(f, f.id ? 'Guide saved.' : 'Guide added.'); }}>
          {field('name', 'Name', { max: 80 })}
          {field('title', 'What they do', { max: 80, hint: 'For example: Heritage walk guide' })}
          <div className="sm:col-span-2">{field('about', 'About (optional)', { area: true, max: 500 })}</div>
          {field('languages', 'Languages', { max: 100, hint: 'English, Hindi, French' })}
          {field('charges', 'Charges (optional)', { max: 160, hint: 'For example: ₹1,500 for 3 hours' })}
          {field('phone', 'Phone', { mode: 'tel', max: 25 })}
          {field('whatsapp', 'WhatsApp (if different)', { mode: 'tel', max: 25 })}
          {field('instagram', 'Instagram', { max: 100, hint: 'The name or the link' })}
          {field('linkedin', 'LinkedIn link', { mode: 'url', max: 300, hint: 'Starts with https://' })}
          {field('sort', 'Order (1 comes first)', { max: 5 })}
          <label className="flex min-h-11 items-center gap-3 self-end text-sm font-semibold"><input type="checkbox" className="size-5" checked={f.active} onChange={(e) => set('active', e.target.checked)} />Show to guests</label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={ns.primary} disabled={busy || !f.name.trim()}>{f.id ? 'Save' : 'Add the guide'}</button>
            <button type="button" className={ns.secondary} onClick={() => setF(null)}>Cancel</button>
          </div>
        </form>
      )}
    </Card>
  );
}
