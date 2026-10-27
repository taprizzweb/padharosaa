'use client';

import { useEffect, useState } from 'react';
import { dialNumber } from '@/lib/padharosaa/phone';
import { fill, type Copy } from './copy';
import { Header, Icon, api, telHref } from './shared';

export interface LGuide { id: string; name: string; title: string | null; about: string | null; languages: string | null; charges: string | null; phone: string | null; whatsapp: string | null; instagram: string | null; linkedin: string | null }

/** The people the hotel recommends. Every contact is optional; the hotel only lists them, so the screen says the charges are the guide's own. */
export function LocalGuidesScreen({ c, back, hotel, room }: { c: Copy; back: () => void; hotel: string; room: string }) {
  const [list, setList] = useState<LGuide[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void api<{ guides: LGuide[] }>('local-guides').then((r) => { if (r.ok) setList(r.data.guides); else setFailed(true); }); }, []);
  const btn = 'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-bold';
  return (
    <main className="flex-1 pb-4" data-testid="local-guides">
      <Header c={c} back={back} title={c.lguidesTitle} />
      <div className="space-y-3 px-5">
        <p className="text-sm">{c.lguidesIntro}</p>
        {failed && <p role="alert" className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.failed}</p>}
        {list && list.length === 0 && <p className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.lguidesEmpty}</p>}
        {list?.map((g) => {
          const wa = g.whatsapp ?? g.phone;
          return (
            <article key={g.id} className="rounded-3xl bg-white p-4 text-stone-900 shadow-sm" data-testid="local-guide">
              <h2 className="text-lg font-extrabold">{g.name}</h2>
              {g.title && <p className="font-semibold" style={{ color: '#7a3a2e' }}>{g.title}</p>}
              {g.about && <p className="mt-1.5 whitespace-pre-line">{g.about}</p>}
              {(g.languages || g.charges) && (
                <dl className="mt-2 grid gap-1 text-sm">
                  {g.languages && <div><dt className="inline font-bold">{c.lguidesLanguages}: </dt><dd className="inline">{g.languages}</dd></div>}
                  {g.charges && <div><dt className="inline font-bold">{c.lguidesCharges}: </dt><dd className="inline">{g.charges}</dd></div>}
                </dl>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {g.phone && <a className={btn} style={{ borderColor: '#1F6B3E', color: '#1F6B3E', background: '#E2F1E7' }} href={telHref(g.phone)}><Icon name="phone" size={18} />{c.lguidesCall}</a>}
                {wa && <a className={btn} style={{ borderColor: '#1F6B3E', color: '#1F6B3E' }} target="_blank" rel="noopener noreferrer" href={`https://wa.me/${dialNumber(wa).replace('+', '')}?text=${encodeURIComponent(fill(c.lguidesMsg, { hotel, room }))}`}><Icon name="whatsapp" size={18} />{c.lguidesWhatsapp}</a>}
                {g.instagram && <a className={btn} style={{ borderColor: '#b45309', color: '#8a3b05' }} target="_blank" rel="noopener noreferrer" href={`https://www.instagram.com/${g.instagram}/`}><Icon name="instagram" size={18} />{c.lguidesInstagram}</a>}
                {g.linkedin && <a className={btn} style={{ borderColor: '#1d4ed8', color: '#1e40af' }} target="_blank" rel="noopener noreferrer" href={g.linkedin}><Icon name="linkedin" size={18} />{c.lguidesLinkedin}</a>}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
