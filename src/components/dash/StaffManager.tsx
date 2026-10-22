'use client';
import { useState } from 'react';
import { Alert, Notice, Sheet, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { dashPost, errText, fmtDateTime, inputCls, useDashData } from './api';

interface Member { user_id: string; email: string; display_name: string; role: 'owner' | 'manager' | 'waiter' | 'kitchen'; active: boolean; created_at: string; is_you: boolean }
const ROLES = [['manager', 'Manager'], ['waiter', 'Waiter'], ['kitchen', 'Kitchen']] as const;
const smallBtn = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50';

export function StaffManager({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useDashData<Member[]>('staff');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [reset, setReset] = useState<Member | null>(null);
  const [secret, setSecret] = useState<{ title: string; email: string; password: string } | null>(null);
  const [f, setF] = useState({ email: '', name: '', role: 'waiter' as 'manager' | 'waiter' | 'kitchen' });
  const [copied, setCopied] = useState(false);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true); setErr(null);
    try { const r = await fn(); await reload(); return r; } catch (e) { setErr(errText(e)); return null; } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Staff</h1>
        {canEdit && <button type="button" className={btnPrimary} onClick={() => { setErr(null); setF({ email: '', name: '', role: 'waiter' }); setAdding(true); }}>Add staff member</button>}
      </div>
      {!canEdit && <div className="mt-3"><Notice>Only the owner can add or change staff accounts. You can see the list here.</Notice></div>}
      <div className="mt-3 space-y-2" aria-live="polite">{error && <Alert>{error}</Alert>}{err && !adding && !editing && <Alert>{err}</Alert>}</div>
      {!data && !error && <p className="mt-6 text-stone-700">Loading…</p>}
      <ul className="mt-4 space-y-2">
        {data?.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-semibold">{m.display_name}{m.is_you && ' (you)'}{!m.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold">Deactivated</span>}</p>
              <p className="break-all text-sm text-stone-700">{m.email} · <span className="capitalize">{m.role}</span> · added {fmtDateTime(m.created_at)}</p>
            </div>
            {canEdit && m.role !== 'owner' && (
              <div className="flex flex-wrap gap-1">
                <button type="button" className={smallBtn} onClick={() => { setErr(null); setEditing(m); setF({ email: m.email, name: m.display_name, role: m.role as 'manager' }); }} aria-label={`Edit ${m.display_name}`}>Edit</button>
                <button type="button" className={smallBtn} disabled={busy} aria-label={`${m.active ? 'Deactivate' : 'Reactivate'} ${m.display_name}`} onClick={() => void run(() => dashPost('staff-update', { user_id: m.user_id, name: m.display_name, role: m.role, active: !m.active }))}>{m.active ? 'Deactivate' : 'Reactivate'}</button>
                <button type="button" className={smallBtn} onClick={() => setReset(m)} aria-label={`Reset password for ${m.display_name}`}>Reset password</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add staff member" closeLabel="Close">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => dashPost<{ email: string; temporary_password: string }>('staff-add', f));
          if (r) { setAdding(false); setCopied(false); setSecret({ title: 'Account created', email: r.email, password: r.temporary_password }); }
        }}>
          <label className="block text-sm font-semibold">Name<input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">Email (used to sign in)<input type="email" required inputMode="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">Role
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as typeof f.role })} className={inputCls}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <p className="text-sm text-stone-700">A temporary password is created and shown once. The person must choose their own password the first time they sign in.</p>
          {err && <Alert>{err}</Alert>}
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Create account</button>
        </form>
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit staff member" closeLabel="Close">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!editing) return;
          const r = await run(() => dashPost('staff-update', { user_id: editing.user_id, name: f.name, role: f.role, active: editing.active }));
          if (r) setEditing(null);
        }}>
          <p className="break-all text-sm text-stone-700">{editing?.email}</p>
          <label className="block text-sm font-semibold">Name<input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">Role
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as typeof f.role })} className={inputCls}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          {err && <Alert>{err}</Alert>}
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Save</button>
        </form>
      </Sheet>

      <Sheet open={!!reset} onClose={() => setReset(null)} title={`Reset password for ${reset?.display_name ?? ''}?`} closeLabel="Close">
        <p className="text-stone-800">A new temporary password will be created. The old password stops working, and {reset?.display_name} must choose a new one at next sign-in.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setReset(null)}>Cancel</button>
          <button type="button" className={`${btnPrimary} flex-1`} disabled={busy} onClick={async () => {
            const m = reset; setReset(null); if (!m) return;
            const r = await run(() => dashPost<{ temporary_password: string }>('staff-reset-password', { user_id: m.user_id }));
            if (r) { setCopied(false); setSecret({ title: 'Password reset', email: m.email, password: r.temporary_password }); }
          }}>Yes, reset it</button>
        </div>
      </Sheet>

      <Sheet open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? ''} closeLabel="Close">
        <div className="space-y-3">
          <p className="text-stone-800">Give these sign-in details to {secret?.email}. <strong>This password is shown only once</strong> and cannot be looked up later.</p>
          <p className="break-all rounded-xl bg-stone-100 p-3 font-mono text-lg" data-testid="temp-password">{secret?.password}</p>
          <button type="button" className={`${btnSecondary} w-full`} onClick={async () => { try { await navigator.clipboard.writeText(secret?.password ?? ''); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy password'}</button>
          <button type="button" className={`${btnPrimary} w-full`} onClick={() => setSecret(null)}>I have saved it</button>
        </div>
      </Sheet>
    </div>
  );
}
