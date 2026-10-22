'use client';
import type { PayMode, StatusRequest, WaiterReason } from '@/lib/guest/types';
import type { Translator } from '@/lib/i18n';
import { Alert, IconCheck, Sheet, btnSecondary } from './ui';
import { useState } from 'react';

const REASONS: WaiterReason[] = ['water', 'cutlery', 'cleaning', 'help', 'other'];
const MODES: PayMode[] = ['cash', 'upi', 'card'];

const choice = (selected = false) =>
  `flex min-h-14 w-full items-center justify-between rounded-xl border-2 px-4 text-left text-base font-semibold disabled:opacity-60 ${selected ? 'border-accent bg-accent text-white' : 'border-stone-300 bg-white text-stone-900'}`;

export function WaiterSheet({
  open, onClose, t, openRequest, busy, error, onPick,
}: {
  open: boolean; onClose: () => void; t: Translator; openRequest?: StatusRequest; busy: boolean; error: string | null; onPick: (r: WaiterReason) => void;
}) {
  const [sent, setSent] = useState(false);
  const showSent = sent || !!openRequest;
  return (
    <Sheet open={open} onClose={() => { setSent(false); onClose(); }} title={t('help.callWaiter')} closeLabel={t('help.close')}>
      {showSent ? (
        <div className="space-y-4 py-2 text-center" role="status">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-800"><IconCheck /></span>
          <p className="text-lg font-bold">{t('help.waiterOnWay')}</p>
          <p className="text-stone-600">{t('help.waiterSent')}</p>
          <button type="button" onClick={() => { setSent(false); onClose(); }} className={`${btnSecondary} w-full`}>{t('help.close')}</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-semibold">{t('help.waiterTitle')}</p>
          {REASONS.map((r) => (
            <button key={r} type="button" disabled={busy} className={choice()} onClick={() => { onPick(r); setSent(true); }}>
              {t(`help.reason.${r}` as 'help.reason.water')}
            </button>
          ))}
          {error && <Alert>{error}</Alert>}
        </div>
      )}
      {error && showSent && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Sheet>
  );
}

export function BillSheet({
  open, onClose, t, openRequest, busy, error, onPick,
}: {
  open: boolean; onClose: () => void; t: Translator; openRequest?: StatusRequest; busy: boolean; error: string | null; onPick: (m: PayMode) => void;
}) {
  const [changing, setChanging] = useState(false);
  const mode = openRequest?.pay_mode ?? null;
  const showChooser = !openRequest || changing;
  return (
    <Sheet open={open} onClose={() => { setChanging(false); onClose(); }} title={t('help.askBill')} closeLabel={t('help.close')}>
      {showChooser ? (
        <div className="space-y-3">
          <p className="font-semibold">{t('help.billTitle')}</p>
          {MODES.map((m) => (
            <button key={m} type="button" disabled={busy} aria-pressed={mode === m} className={choice(mode === m)} onClick={() => { onPick(m); setChanging(false); }}>
              {t(`help.pay.${m}` as 'help.pay.cash')}
              {mode === m && <IconCheck />}
            </button>
          ))}
          {error && <Alert>{error}</Alert>}
        </div>
      ) : (
        <div className="space-y-4 py-2 text-center" role="status">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-800"><IconCheck /></span>
          <p className="text-lg font-bold">{t('help.billOnWay')}</p>
          {mode && <p className="text-stone-600">{t('help.billMode', { mode: t(`help.pay.${mode}` as 'help.pay.cash') })}</p>}
          <button type="button" onClick={() => setChanging(true)} className={`${btnSecondary} w-full`}>{t('help.changePay')}</button>
          <button type="button" onClick={() => { setChanging(false); onClose(); }} className={`${btnSecondary} w-full`}>{t('help.close')}</button>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </Sheet>
  );
}
