import { ApiFailure } from '@/lib/guest/client';

export async function adminPost<T>(action: string, data: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(data) });
  } catch {
    throw new ApiFailure('network', 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { key?: string } }) | null;
  if (!res.ok) throw new ApiFailure(body?.error?.key ?? 'server_error', res.status);
  return body as T;
}

export async function adminGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiFailure('network', 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { key?: string } }) | null;
  if (res.status === 401) window.location.assign('/login?next=/admin');
  if (!res.ok) throw new ApiFailure(body?.error?.key ?? 'server_error', res.status);
  return body as T;
}

export interface Plan { id: string; name: string; points: string[]; setup_fee_paise: number; monthly_paise: number; yearly_paise: number; active: boolean; sort_order: number; in_use: string | number }
