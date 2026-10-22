/** Browser-side helpers for the guest API. No secrets here: the only credential is the HttpOnly cookie the browser sends itself. */
import type { PayMode, StatusData, WaiterReason } from './types';

export class ApiFailure extends Error {
  constructor(
    public readonly key: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(key);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new ApiFailure('network', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const b = body as { error?: { key?: string }; requestId?: string } | null;
    throw new ApiFailure(b?.error?.key ?? 'server_error', res.status, b?.requestId ?? res.headers.get('x-request-id') ?? undefined);
  }
  return body as T;
}

const post = <T>(path: string, data: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export interface PlaceOrderInput {
  slug: string;
  token: string;
  items: { item_id: string; qty: number; note?: string; variant_id?: string; option_ids?: string[] }[];
  note?: string;
  idempotency_key: string;
  geo?: { lat: number; lng: number; accuracy: number };
}
export const placeOrder = (input: PlaceOrderInput) =>
  post<{ order_no: number; total_paise: number; status: string; replayed: boolean }>('/api/guest/order', input);

export const openRoom = (slug: string, token: string, room: string) =>
  post<{ token: string; label: string }>('/api/guest/room', { slug, token, room });

export const openTable = (slug: string, token: string, table: string) =>
  post<{ token: string; label: string }>('/api/guest/table', { slug, token, table });

export const sendHelp = (input: { slug: string; token: string; room: string; topics: string[]; note?: string }) =>
  post<{ room: string; replayed: boolean }>('/api/guest/help', input);

export const callWaiter = (slug: string, token: string, reason: WaiterReason) =>
  post<{ request: { type: string; status: string } }>('/api/guest/request', { type: 'waiter', slug, token, reason });

export const askBill = (slug: string, token: string, payMode: PayMode) =>
  post<{ request: { type: string; status: string; pay_mode: PayMode } }>('/api/guest/request', { type: 'bill', slug, token, pay_mode: payMode });

export const fetchStatus = (slug: string, signal?: AbortSignal) => call<StatusData>(`/api/guest/status?slug=${encodeURIComponent(slug)}`, { signal });

/** One-off position for cafes that only take orders from guests who are there. Never stored by the app. */
export function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new ApiFailure('location_unavailable', 0));
    // The browser's own timeout only starts after the guest answers the permission prompt, so add our own: an ignored prompt must not leave "Place order" spinning forever.
    const watchdog = setTimeout(() => reject(new ApiFailure('location_unavailable', 0)), 15000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(watchdog); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      (e) => { clearTimeout(watchdog); reject(new ApiFailure(e.code === 1 ? 'location_denied' : 'location_unavailable', 0)); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}
