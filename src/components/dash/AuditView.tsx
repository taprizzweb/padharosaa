'use client';
import { useEffect, useState } from 'react';
import { Alert, btnSecondary } from '@/components/guest/ui';
import { dashGet, errText, fmtDateTime } from './api';

interface Entry { id: number; created_at: string; action: string; entity: string; entity_id: string | null; details: Record<string, unknown> | null; actor_role: string | null; actor_name: string }

const NOUN: Record<string, string> = { items: 'dish', categories: 'category', dining_tables: 'table', restaurants: 'settings', staff: 'staff member', orders: 'order', table_sessions: 'table session', service_requests: 'request' };
const SPECIAL: Record<string, string> = {
  item_availability: 'Changed dish availability', menu_import: 'Imported a menu from CSV', order_cancelled: 'Cancelled an order',
  qr_rotated: 'Made a new QR code', staff_password_reset: 'Reset a staff password',
};

export function describe(e: Pick<Entry, 'action' | 'entity'>): string {
  if (SPECIAL[e.action]) return SPECIAL[e.action]!;
  const noun = NOUN[e.entity] ?? e.entity.replace(/_/g, ' ');
  const verb = e.action === 'insert' ? 'Added' : e.action === 'delete' ? 'Removed' : e.action === 'update' ? 'Changed' : e.action.replace(/_/g, ' ');
  return `${verb} ${noun}`;
}

function detail(d: Entry['details'], action: string): string {
  if (!d) return '';
  const hide = new Set(['id', 'restaurant_id', 'created_at', 'updated_at', 'category_id', 'table_id', 'session_id', 'user_id']);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (hide.has(k)) continue;
    const label = k.replace(/_/g, ' ');
    if (action === 'update' && v && typeof v === 'object' && 'old' in v && 'new' in v) {
      const x = v as { old: unknown; new: unknown };
      parts.push(`${label}: ${show(x.old)} → ${show(x.new)}`);
    } else parts.push(`${label}: ${show(v)}`);
    if (parts.length >= 6) break;
  }
  return parts.join(' · ');
}
const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditView() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(before?: number) {
    setBusy(true);
    try {
      const r = await dashGet<{ entries: Entry[] }>('audit', before ? { limit: 50, before } : { limit: 50 });
      setRows((x) => (before ? [...x, ...r.entries] : r.entries));
      setMore(r.entries.length === 50);
      setError(null);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); setLoaded(true); }
  }
  useEffect(() => { void load(); }, []);

  return (
    <div>
      <h1 className="text-2xl font-extrabold">Activity log</h1>
      <p className="mt-1 text-sm text-stone-700">Who changed what, newest first. Entries cannot be edited or removed. Times are in India time.</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {!loaded && <p className="mt-6 text-stone-700">Loading…</p>}
      {loaded && rows.length === 0 && !error && <p className="mt-6 text-stone-800">Nothing has been recorded yet.</p>}
      <ul className="mt-4 space-y-2">
        {rows.map((e) => (
          <li key={e.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
            <p className="font-semibold">{describe(e)}</p>
            <p className="text-sm text-stone-700">{fmtDateTime(e.created_at)} · {e.actor_name}{e.actor_role ? ` (${e.actor_role.replace('_', ' ')})` : ''}</p>
            {detail(e.details, e.action) && <p className="mt-1 break-words text-sm text-stone-800">{detail(e.details, e.action)}</p>}
          </li>
        ))}
      </ul>
      {more && <button type="button" disabled={busy} onClick={() => void load(rows[rows.length - 1]?.id)} className={`${btnSecondary} mt-4 w-full`}>Show older entries</button>}
    </div>
  );
}
