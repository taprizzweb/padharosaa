'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatPaise } from '@/lib/money';
import { ApiFailure, askBill, callWaiter, currentPosition, placeOrder, sendOrderEta, sendOrderPay } from '@/lib/guest/client';
import type { MenuData, MenuItem, PayMode, WaiterReason } from '@/lib/guest/types';
import { errorMessageKey, t } from '@/lib/i18n';
import { trackEvent, type TrackIds } from '@/lib/guest/analytics';
import type { MenuEvent } from '@/lib/schemas/guest';
import { CartSheet } from './CartSheet';
import { BillSheet, WaiterSheet } from './HelpSheets';
import { MenuView } from './MenuView';
import { RestaurantHero, RestaurantInfo } from './RestaurantHero';
import { ItemOptionsSheet } from './ItemOptionsSheet';
import { LinkPicker } from './LinkPicker';
import { barItemIds, markFor, parseDietParam } from '@/lib/guest/filters';
import { PoweredBy } from './PoweredBy';
import { StatusView, ThankYou } from './StatusView';
import { forgetIdempotencyKey, idempotencyKeyFor, useCart, useLiveStatus } from './hooks';
import { IconBell, IconCart, IconList, IconReceipt, Notice, Alert } from './ui';

export function GuestApp({
  menu, slug, token, hasCookie, imageBase,
}: {
  menu: MenuData; slug: string; token: string | null; hasCookie: boolean; imageBase: string;
}) {
  const router = useRouter();
  // Optional hand-over from the Padharosaa hotel app: which room, where "back" goes, and which food chips were already picked.
  const qs = useSearchParams();
  const roomParam = (qs.get('room') ?? '').slice(0, 10) || null;
  const backRaw = qs.get('back') ?? '';
  const back = /^\/(?![/\\])/.test(backRaw) || /^https:\/\/[^\s]+$/i.test(backRaw) ? backRaw.slice(0, 300) : null;
  const catsParam = (qs.get('cats') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 30);
  const dietParam = parseDietParam(qs.get('diet'));
  // Set only by the Padharosaa hotel app: rd=1 means the hotel delivers to rooms, rd=0 means it does not. Shows the Room delivery / Takeaway choice.
  const rdRaw = qs.get('rd');
  const rd = rdRaw === '1' || rdRaw === '0' ? rdRaw : null;
  const [handover, setHandover] = useState<'deliver' | 'takeaway'>(rdRaw === '0' ? 'takeaway' : 'deliver');
  const carry = [rd ? `&rd=${rd}` : '', back ? `&back=${encodeURIComponent(back)}` : '', catsParam.length ? `&cats=${catsParam.join(',')}` : '', dietParam.length ? `&diet=${dietParam.join(',')}` : ''].join('');
  const categories = useMemo(() => menu.categories ?? [], [menu.categories]);
  const items = useMemo(() => new Map<string, MenuItem>(categories.flatMap((c) => c.items).map((i) => [i.id, i])), [categories]);
  const barIds = useMemo(() => barItemIds(categories), [categories]);
  // an order line only keeps the dish name, so its mark is found by that name (a bar dish, or an unknown name, has none)
  const dietOfName = useMemo(() => { const m = new Map<string, MenuItem>(); for (const i of items.values()) if (!m.has(i.name_en)) m.set(i.name_en, i); return (name: string) => { const i = m.get(name); return i ? markFor(i, barIds) : null; }; }, [items, barIds]);
  const cart = useCart(slug, items);

  const tokenValid = !!menu.token_valid && !!token;
  const [view, setView] = useState<'menu' | 'status'>('menu');
  const [hasSession, setHasSession] = useState(hasCookie);
  const [sheet, setSheet] = useState<null | 'cart' | 'waiter' | 'bill'>(null);
  // the dish whose size / options are being chosen
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpError, setHelpError] = useState<string | null>(null);
  // The bill sheet shows the newly chosen payment mode at once; the server's answer replaces it a moment later.
  const [payOverride, setPayOverride] = useState<PayMode | null>(null);
  const [online, setOnline] = useState(true);
  const placingRef = useRef(false);
  const autoShown = useRef(false);

  const track = useCallback(
    (event: MenuEvent, ids?: TrackIds) => trackEvent(slug, tokenValid ? token : null, event, ids),
    [slug, token, tokenValid],
  );
  useEffect(() => {
    track('menu_opened');
    if (tokenValid) track('qr_landing');
    // once per page load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = useLiveStatus(slug, hasSession && tokenValid);
  // Ignore a session that belongs to a different table than the QR just scanned.
  const status = live.data && (!menu.table_label || live.data.table_label === menu.table_label) ? live.data : null;
  const closed = status?.state === 'closed';
  const openRequests = status?.state === 'open' ? (status.requests ?? []) : [];
  const waiterReq = openRequests.find((r) => r.type === 'waiter');
  const serverBillReq = openRequests.find((r) => r.type === 'bill');
  const billReq = serverBillReq && payOverride ? { ...serverBillReq, pay_mode: payOverride } : serverBillReq;
  const orderCount = status?.state === 'open' ? (status.orders ?? []).filter((o) => o.status !== 'cancelled').length : 0;

  const msg = useCallback(
    (e: unknown): string => {
      if (e instanceof ApiFailure) {
        const base = e.key === 'network' ? t('error.network') : t(errorMessageKey(e.key));
        return e.requestId && e.status >= 500 ? `${base} ${t('error.reference', { id: e.requestId.slice(0, 8) })}` : base;
      }
      return t('error.server_error');
    },
    [],
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // A returning guest whose table was just settled sees the thank-you screen straight away (once).
  useEffect(() => {
    if (closed && !autoShown.current) {
      autoShown.current = true;
      setView('status');
    }
  }, [closed]);

  const place = async () => {
    if (placingRef.current || !token || cart.lines.length === 0) return;
    placingRef.current = true;
    setPlacing(true);
    setOrderError(null);
    const payload = {
      items: cart.lines.map((l) => ({
        item_id: l.item_id, qty: l.qty,
        ...(l.variant_id ? { variant_id: l.variant_id } : {}),
        ...(l.option_ids?.length ? { option_ids: l.option_ids } : {}),
        ...(l.note?.trim() ? { note: l.note.trim() } : {}),
      })),
      note: cart.note.trim() || undefined,
      ...(rd ? { handover: rd === '0' ? ('takeaway' as const) : handover } : {}),
    };
    try {
      const idem = idempotencyKeyFor(slug, JSON.stringify(payload));
      try {
        await placeOrder({ slug, token, ...payload, idempotency_key: idem });
      } catch (first) {
        // A cafe that only takes orders from guests who are there asks for the position; then we retry once with it.
        if (!(first instanceof ApiFailure) || first.key !== 'location_required') throw first;
        await placeOrder({ slug, token, ...payload, idempotency_key: idem, geo: await currentPosition() });
      }
      forgetIdempotencyKey(slug);
      cart.clear();
      setSheet(null);
      setHasSession(true);
      setView('status');
      live.refresh();
      window.scrollTo({ top: 0 });
    } catch (e) {
      setOrderError(msg(e));
      // Sold-out / removed dishes: reload the menu so the cart can be corrected.
      if (e instanceof ApiFailure && (e.key === 'item_unavailable' || e.key === 'item_not_found')) router.refresh();
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  };

  useEffect(() => {
    if (payOverride && (!serverBillReq || serverBillReq.pay_mode === payOverride)) setPayOverride(null);
  }, [payOverride, serverBillReq]);

  const help = async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (helpBusy) return false;
    setHelpBusy(true);
    setHelpError(null);
    try {
      await fn();
      setHasSession(true);
      live.refresh();
      return true;
    } catch (e) {
      setHelpError(msg(e));
      return false;
    } finally {
      setHelpBusy(false);
    }
  };

  const accent = menu.restaurant.accent ?? 'saffron';
  const canOrder = tokenValid;
  const showStatus = view === 'status';

  return (
    <div data-accent={accent} data-narrow={back ? 'true' : undefined} className="min-h-dvh pb-44">
      {back && <div className="mx-auto max-w-5xl px-4 pt-3"><a href={back} className="inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-2">← {t('back.hotel')}</a></div>}
      <RestaurantHero r={menu.restaurant} imageBase={imageBase} tableLabel={menu.table_label} t={t} compact={showStatus} />

      {!online && <div className="mx-auto max-w-5xl px-4 pt-3"><Notice>{t('state.offline')}</Notice></div>}
      {menu.room_link && token && (
        <div className="mx-auto max-w-5xl px-4 pt-4"><LinkPicker kind="room" slug={slug} token={token} options={menu.rooms} prefill={roomParam} carry={carry} /></div>
      )}
      {menu.table_link && token && (
        <div className="mx-auto max-w-5xl px-4 pt-4"><LinkPicker kind="table" slug={slug} token={token} options={menu.tables} /></div>
      )}
      {!tokenValid && !menu.room_link && !menu.table_link && (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          {token ? <Alert>{t('state.invalidQr.title')}. {t('state.invalidQr.body')}</Alert> : <Notice>{t('state.noQr.title')}. {t('state.noQr.body')}</Notice>}
        </div>
      )}

      <main>
        {showStatus && closed && status ? (
          <ThankYou data={status} t={t} onBack={() => setView('menu')} exploreCode={menu.restaurant.explore_code} onExplore={() => track('explore_click')} />
        ) : showStatus ? (
          <StatusView data={status} t={t} dietOf={dietOfName} imageBase={imageBase} onPay={async (orderNo, method) => { if (!token) return; await sendOrderPay({ slug, token, order_no: orderNo, method }); live.refresh(); }} onAddMore={() => setView('menu')} onEta={async (orderNo, minutes) => { if (!token) return; await sendOrderEta({ slug, token, order_no: orderNo, minutes }); live.refresh(); }} />
        ) : (
          <MenuView initialCats={catsParam} initialDiet={dietParam} categories={categories} t={t} canOrder={canOrder} imageBase={imageBase} qtyOf={cart.qtyOf} onAdd={(id) => { track('cart_add', { item_id: id }); cart.add(id); }} onSet={cart.setQty} onCustomise={setChoosing} onTrack={track} />
        )}
        {!showStatus && <RestaurantInfo r={menu.restaurant} t={t} onTrack={track} />}
      </main>

      {canOrder && !(showStatus && closed) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-2xl space-y-2 px-3 py-2">
            {!showStatus && cart.count > 0 && (
              <button type="button" onClick={() => { setOrderError(null); setSheet('cart'); }} className="flex min-h-14 w-full items-center justify-between rounded-xl bg-accent px-4 text-white">
                <span className="flex items-center gap-2 font-bold"><IconCart /> {t('cart.view')} · {cart.count === 1 ? t('cart.item') : t('cart.items', { n: cart.count })}</span>
                <span className="text-lg font-extrabold">{formatPaise(cart.totalPaise)}</span>
              </button>
            )}
            {(waiterReq || billReq) && (
              <p className="text-center text-sm font-semibold text-green-800" role="status">
                {waiterReq && t('help.waiterOnWay')}{waiterReq && billReq && ' · '}{billReq && t('help.billOnWay')}
              </p>
            )}
            <div className="flex gap-2">
              {hasSession && status?.state !== 'expired' && (
                <button type="button" onClick={() => { setView(showStatus ? 'menu' : 'status'); window.scrollTo({ top: 0 }); }} className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-sm font-bold">
                  <IconList /> {showStatus ? t('status.menu') : t('status.myOrders')}
                </button>
              )}
              {!closed && (
                <>
                  <button type="button" onClick={() => { setHelpError(null); setSheet('waiter'); }} className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-sm font-bold">
                    <IconBell /> {t('help.callWaiter')}
                  </button>
                  <button type="button" onClick={() => { setHelpError(null); setSheet('bill'); }} disabled={orderCount === 0 && !billReq && hasSession && status !== null} aria-describedby={orderCount === 0 && !billReq ? 'bill-hint' : undefined} className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-sm font-bold disabled:opacity-50">
                    <IconReceipt /> {t('help.askBill')}
                  </button>
                </>
              )}
            </div>
            <span id="bill-hint" className="sr-only">{t('help.billNeedsOrder')}</span>
          </div>
        </div>
      )}

      <ItemOptionsSheet
        item={choosing}
        t={t}
        onClose={() => setChoosing(null)}
        onAdd={(item, variantId, optionIds, qty) => {
          track('cart_add', { item_id: item.id });
          cart.addConfigured(item.id, variantId, optionIds, qty);
          setChoosing(null);
        }}
      />
      <CartSheet open={sheet === 'cart'} onClose={() => setSheet(null)} t={t} cart={cart} items={items} barIds={barIds} placing={placing} error={orderError} adjusted={cart.adjusted} onPlace={place} handoverUi={rd ? { roomDining: rd === '1', mode: handover, setMode: setHandover } : null} />
      <WaiterSheet open={sheet === 'waiter'} onClose={() => setSheet(null)} t={t} openRequest={waiterReq} busy={helpBusy} error={helpError} onPick={(r: WaiterReason) => token && void help(() => callWaiter(slug, token, r))} />
      <BillSheet open={sheet === 'bill'} onClose={() => setSheet(null)} t={t} openRequest={billReq} busy={helpBusy} error={helpError} onPick={(m: PayMode) => {
        if (!token) return;
        setPayOverride(m);
        void help(() => askBill(slug, token, m)).then((ok) => { if (!ok) setPayOverride(null); });
      }} />

      <footer className="mx-auto max-w-2xl px-4 pb-4 pt-8 text-center text-xs text-stone-600">
        <Link href="/privacy" className="inline-flex min-h-11 min-w-11 items-center justify-center px-3 underline underline-offset-2">{t('app.privacy')}</Link> · <PoweredBy />
      </footer>
    </div>
  );
}
