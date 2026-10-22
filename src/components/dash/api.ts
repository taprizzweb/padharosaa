'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '@/lib/guest/client';
import { errorMessageKey, t } from '@/lib/i18n';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new ApiFailure('network', 0);
  }
  const body = (await res.json().catch(() => null)) as { error?: { key?: string }; requestId?: string } | null;
  if (!res.ok) {
    if (res.status === 403 && body?.error?.key === 'mfa_required') window.location.assign(`/account/mfa?next=${encodeURIComponent(location.pathname)}`);
    if (res.status === 401) window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new ApiFailure(body?.error?.key ?? 'server_error', res.status, body?.requestId);
  }
  return body as T;
}

export const dashGet = <T,>(action: string, query?: Record<string, string | number>) =>
  call<T>(`/api/dash/${action}${query ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}` : ''}`);
export const dashPost = <T,>(action: string, data: unknown) =>
  call<T>(`/api/dash/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const errText = (e: unknown) => t(errorMessageKey(e instanceof ApiFailure ? (e.status === 0 ? 'network' : e.key) : 'server_error'));

/** Loads a dashboard read and lets the page reload it after a change. */
export function useDashData<T>(action: string, query?: Record<string, string | number>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = query ? JSON.stringify(query) : '';
  const load = useCallback(async () => {
    try {
      setData(await dashGet<T>(action, key ? (JSON.parse(key) as Record<string, string | number>) : undefined));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [action, key]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, reload: load, setData };
}

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso));

export const inputCls = 'mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-normal';
