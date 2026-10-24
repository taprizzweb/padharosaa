'use client';
import { exploreUrl } from '@/lib/profile';
import { formatPaise } from '@/lib/money';
import type { OrderStatus, StatusData, StatusOrder } from '@/lib/guest/types';
import type { Translator } from '@/lib/i18n';
import { btnPrimary, btnSecondary, IconCheck } from './ui';

const STAGES: Exclude<OrderStatus, 'cancelled'>[] = ['placed', 'preparing', 'ready', 'served'];
const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso));

function Stepper({ status, t }: { status: Exclude<OrderStatus, 'cancelled'>; t: Translator }) {
  const current = STAGES.indexOf(status);
  return (
    <ol className="mt-3 grid grid-cols-4 gap-1" aria-label={t(`status.stage.${status}` as 'status.stage.placed')}>
      {STAGES.map((s, i) => {
        const done = i <= current;
        return (
          <li key={s} aria-current={i === current ? 'step' : undefined} className="text-center">
            <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-accent text-white' : 'bg-stone-200 text-stone-600'}`}>
              {i < current || status === 'served' ? <IconCheck className="h-4 w-4" /> : i + 1}
            </span>
            <span className={`mt-1 block text-xs ${i === current ? 'font-bold text-stone-900' : 'text-stone-600'}`}>{t(`status.stage.${s}` as 'status.stage.placed')}</span>
          </li>
        );
      })}
    </ol>
  );
}

function OrderCard({ o, t, roomDining }: { o: StatusOrder; t: Translator; roomDining?: boolean }) {
  const cancelled = o.status === 'cancelled';
  return (
    <li className={`rounded-2xl border bg-white p-4 ${cancelled ? 'border-red-200' : 'border-stone-200'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-bold">{t('status.orderNo', { n: o.order_no })}</h3>
        <span className="text-sm text-stone-600">{fmtTime(o.created_at)}</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {o.items.map((it, idx) => (
          <li key={idx}>
            <span className="font-semibold">{it.qty} ×</span> {it.name_en}
            {it.note && <span className="block text-stone-600">“{it.note}”</span>}
          </li>
        ))}
      </ul>
      {o.note && <p className="mt-2 text-sm text-stone-700">“{o.note}”</p>}
      <p className="mt-2 text-right text-sm font-semibold">{formatPaise(o.total_paise)}</p>
      {cancelled ? (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">
          {t('status.cancelled')}
          {o.cancel_reason && <span className="block font-normal">{t('status.cancelledReason', { reason: o.cancel_reason })}</span>}
        </p>
      ) : (
        <>
          {o.handover && (
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-950">
              {o.handover === 'takeaway' && roomDining === false && <span className="mb-1 block">{t('status.handover.noRoom')}</span>}
              {o.handover === 'takeaway' && o.handover_minutes ? t('status.handover.takeawayTime', { n: o.handover_minutes }) : t(`status.handover.${o.handover}` as 'status.handover.deliver')}
            </p>
          )}
          <Stepper status={o.status as Exclude<OrderStatus, 'cancelled'>} t={t} />
          {o.status === 'placed' && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm font-semibold text-amber-900">{t('status.notAccepted')}</p>}
        </>
      )}
    </li>
  );
}

export function StatusView({ data, t, onAddMore }: { data: StatusData | null; t: Translator; onAddMore: () => void }) {
  const orders = data?.orders ?? [];
  return (
    <div className="mx-auto max-w-2xl px-4 pb-4 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{t('status.title')}</h2>
        <button type="button" onClick={onAddMore} className={btnSecondary}>{t('status.addMore')}</button>
      </div>
      <div aria-live="polite">
        {!data ? (
          <p className="py-10 text-center text-stone-600">{t('status.updating')}</p>
        ) : orders.length === 0 ? (
          <p className="py-10 text-center text-stone-600">{t('status.noOrders')}</p>
        ) : (
          <>
            <ul className="mt-3 space-y-3">{[...orders].reverse().map((o) => <OrderCard key={o.order_no} o={o} t={t}  roomDining={data?.room_dining} />)}</ul>
            <div className="mt-4 flex items-baseline justify-between rounded-2xl bg-stone-900 px-4 py-3 text-white">
              <span className="font-semibold">{t('status.tableTotal')}</span>
              <span className="text-xl font-extrabold">{formatPaise(data.total_paise ?? 0)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ThankYou({ data, t, onBack, exploreCode, onExplore }: { data: StatusData; t: Translator; onBack: () => void; exploreCode?: string | null; onExplore?: () => void }) {
  return (
    <div className="mx-auto max-w-md px-6 py-12 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-800"><IconCheck className="h-8 w-8" /></span>
      <h2 className="mt-5 text-3xl font-extrabold">{t('thanks.title')}</h2>
      <p className="mt-2 text-stone-700">{t('thanks.body')}</p>
      <p className="mt-4 text-xl font-bold">{t('thanks.total', { amount: formatPaise(data.total_paise ?? 0) })}</p>
      {exploreCode && (
        <a href={exploreUrl(exploreCode)} target="_blank" rel="noopener noreferrer" onClick={onExplore} className={`${btnPrimary} mt-8 w-full min-h-14 text-lg`}>
          {t('info.exploreMore')}
        </a>
      )}
      <button type="button" onClick={onBack} className={`${btnSecondary} mt-4 w-full`}>{t('status.back')}</button>
    </div>
  );
}
