'use client';
import { useId, useState } from 'react';
import { ApiFailure, openRoom, openTable } from '@/lib/guest/client';
import { errorMessageKey, t } from '@/lib/i18n';
import { normalizeRoom } from '@/lib/rooms';
import { Alert, btnPrimary } from './ui';

/**
 * Shown on a shared link. Room link: the guest says which room. Table link: the guest picks their table.
 * Either way the page then reloads as that room's / table's own link, exactly like scanning its QR.
 * A room link only ever asks for rooms and a table link only ever asks for tables.
 */
export function LinkPicker({ kind, slug, token, options }: { kind: 'room' | 'table'; slug: string; token: string; options: string[] | null | undefined }) {
  const id = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = kind === 'room';
  const list = options && options.length > 0 && options.length <= (room ? 80 : 400) ? options : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = room ? normalizeRoom(value) : value.trim();
    if (!clean) {
      setError(t(room ? 'room.invalid' : 'tablepick.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = room ? await openRoom(slug, token, clean) : await openTable(slug, token, clean);
      // A full load: the page now behaves exactly like a scan of this room's / table's own link.
      window.location.assign(`/${slug}?k=${r.token}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiFailure ? (err.key === 'network' ? t('error.network') : t(errorMessageKey(err.key))) : t('error.server_error'));
    }
  };

  const k = room ? 'room' : 'tablepick';
  return (
    <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-extrabold">{t(`${k}.title`)}</h2>
      <p className="mt-1 text-sm text-stone-800">{t(`${k}.body`)}</p>
      <label htmlFor={id} className="mt-3 block text-sm font-semibold">{t(`${k}.label`)}</label>
      {list ? (
        <select id={id} value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base" required>
          <option value="">{t(`${k}.choose`)}</option>
          {list.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      ) : (
        <input id={id} value={value} onChange={(e) => setValue(e.target.value)} maxLength={room ? 10 : 20} autoComplete="off" inputMode="text" placeholder={t(`${k}.placeholder`)} className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base" required />
      )}
      <div className="mt-3" aria-live="polite">{error && <Alert>{error}</Alert>}</div>
      <button type="submit" disabled={busy} className={`${btnPrimary} mt-3 w-full`}>{busy ? t(`${k}.checking`) : t(`${k}.continue`)}</button>
    </form>
  );
}
