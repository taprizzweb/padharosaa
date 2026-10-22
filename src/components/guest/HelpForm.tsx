'use client';
import { useId, useState } from 'react';
import { ApiFailure, sendHelp } from '@/lib/guest/client';
import type { AccentKey } from '@/lib/accent';
import { errorMessageKey, t } from '@/lib/i18n';
import { normalizeRoom } from '@/lib/rooms';
import { PoweredBy } from './PoweredBy';
import { Alert, IconCheck, btnPrimary, btnSecondary } from './ui';

/** "Call for problems": room number, tap the problems that apply, optional note, send. Reception sees it on the live screen at once. */
export function HelpForm({ slug, token, name, accent, topics, rooms }: { slug: string; token: string; name: string; accent: AccentKey; topics: string[]; rooms: string[] }) {
  const uid = useId();
  const [room, setRoom] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ room: string; topics: string[]; note: string } | null>(null);
  const list = rooms.length > 0 && rooms.length <= 80 ? rooms : null;

  const toggle = (topic: string) => setPicked((cur) => (cur.includes(topic) ? cur.filter((x) => x !== topic) : [...cur, topic]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeRoom(room);
    if (!clean) return setError(t('help.needRoom'));
    if (picked.length === 0 && note.trim() === '') return setError(t('help.needOne'));
    setBusy(true);
    setError(null);
    try {
      const r = await sendHelp({ slug, token, room: clean, topics: picked, ...(note.trim() ? { note: note.trim() } : {}) });
      setSent({ room: r.room, topics: picked, note: note.trim() });
    } catch (err) {
      setError(err instanceof ApiFailure ? (err.key === 'network' ? t('error.network') : t(errorMessageKey(err.key))) : t('error.server_error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-accent={accent} className="min-h-dvh bg-stone-50">
      <header className="bg-accent px-5 pb-6 pt-8 text-white">
        <div className="mx-auto max-w-lg">
          <p className="text-sm font-semibold">{name}</p>
          <h1 className="mt-1 font-serif text-3xl font-bold">{t('help.title')}</h1>
          <p className="mt-2 text-base">{t('help.intro')}</p>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-5 py-6">
        {sent ? (
          <section aria-live="polite" className="rounded-2xl border border-stone-200 bg-white p-5 text-center shadow-sm">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-800"><IconCheck /></span>
            <h2 className="mt-3 text-xl font-extrabold">{t('help.sentTitle')}</h2>
            <p className="mt-1 text-stone-800">{t('help.sentBody', { room: sent.room })}</p>
            {(sent.topics.length > 0 || sent.note) && (
              <ul className="mt-3 flex flex-wrap justify-center gap-2">
                {sent.topics.map((x) => <li key={x} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-bold text-white">{x}</li>)}
                {sent.note && <li className="rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-semibold">“{sent.note}”</li>}
              </ul>
            )}
            <button type="button" className={`${btnSecondary} mt-5 w-full`} onClick={() => { setSent(null); setPicked([]); setNote(''); }}>{t('help.another')}</button>
          </section>
        ) : (
          <form onSubmit={submit} className="space-y-6" noValidate>
            <div>
              <label htmlFor={`${uid}-room`} className="block text-base font-bold">{t('help.room')}</label>
              {list ? (
                <select id={`${uid}-room`} value={room} onChange={(e) => setRoom(e.target.value)} className="mt-2 h-14 w-full rounded-xl border border-stone-300 bg-white px-3 text-lg" required>
                  <option value="">{t('help.roomChoose')}</option>
                  {list.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <input id={`${uid}-room`} value={room} onChange={(e) => setRoom(e.target.value)} maxLength={10} autoComplete="off" inputMode="text" placeholder={t('help.roomPlaceholder')} className="mt-2 h-14 w-full rounded-xl border border-stone-300 bg-white px-3 text-lg" required />
              )}
            </div>

            <fieldset>
              <legend className="text-base font-bold">{t('help.what')} <span className="ml-1 text-sm font-semibold text-stone-700">{t('help.whatHint')}</span></legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {topics.map((x) => {
                  const on = picked.includes(x);
                  return (
                    <label key={x} className={`inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border-2 px-4 text-base font-semibold ${on ? 'border-accent bg-accent text-white' : 'border-stone-300 bg-white text-stone-900'}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(x)} className="sr-only" />
                      {on && <IconCheck />} {x}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div>
              <label htmlFor={`${uid}-note`} className="block text-base font-bold">{t('help.note')}</label>
              <p className="text-sm text-stone-700">{t('help.noteHint')}</p>
              <textarea id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base" />
            </div>

            <div aria-live="polite">{error && <Alert>{error}</Alert>}</div>
            <button type="submit" disabled={busy} className={`${btnPrimary} w-full min-h-14 text-lg`}>{busy ? t('help.sending') : t('help.send')}</button>
          </form>
        )}
      </main>
      <footer className="px-4 pb-8 text-center text-xs text-stone-700"><PoweredBy /></footer>
    </div>
  );
}
