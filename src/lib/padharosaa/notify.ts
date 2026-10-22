import { rpc } from '@/lib/guest/rpc';

interface Claimed { id: string; template: string; payload: { room?: string; label?: string; urgent?: boolean }; attempts: number; to: string | null }
export interface WhatsAppConfig { token: string; phoneId: string; template: string; lang: string }
export interface DispatchResult { claimed: number; sent: number; retried: number; suppressed: number }

/** Sends one approved template message through the WhatsApp Business Cloud API. The three body parameters are: room, problem, urgency. */
export async function sendWhatsApp(cfg: WhatsAppConfig, to: string, n: Claimed, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  const clean = (s: string | undefined) => (s ?? '-').replace(/[\r\n\t]+/g, ' ').slice(0, 120);
  try {
    const res = await fetchImpl(`https://graph.facebook.com/v20.0/${cfg.phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'template',
        template: { name: cfg.template, language: { code: cfg.lang }, components: [{ type: 'body', parameters: [clean(n.payload.room), clean(n.payload.label), n.payload.urgent ? 'URGENT' : 'Normal'].map((text) => ({ type: 'text', text })) }] },
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `http_${res.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** One pass of the outbox worker: claim due alerts, send them, record the outcome. Safe to run from several workers at once. */
export async function dispatchDue(cfg: WhatsAppConfig | null, fetchImpl: typeof fetch = fetch): Promise<DispatchResult> {
  if (!cfg) return { claimed: 0, sent: 0, retried: 0, suppressed: 0 }; // not configured: alerts simply wait in the outbox, no attempts are burnt
  const rows = await rpc<Claimed[]>('padh_claim_notifications', { p_limit: 20 });
  const out: DispatchResult = { claimed: rows.length, sent: 0, retried: 0, suppressed: 0 };
  for (const n of rows) {
    if (!n.to) { await rpc('padh_finish_notification', { p_id: n.id, p_ok: false, p_error: 'no_recipient' }); out.suppressed++; continue; }
    const r = await sendWhatsApp(cfg, n.to, n, fetchImpl);
    await rpc('padh_finish_notification', { p_id: n.id, p_ok: r.ok, p_error: r.error ?? null });
    if (r.ok) out.sent++; else out.retried++;
  }
  return out;
}
