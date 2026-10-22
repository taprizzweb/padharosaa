import type { HelpLink } from '@/components/dash/HelpLinkCard';
import type { TableLink } from '@/components/dash/TableLinkCard';
import type { RoomService } from '@/components/dash/RoomServiceCard';
import { TablesManager, type TableRow } from '@/components/dash/TablesManager';
import { dashContext } from '@/lib/dash/context';
import { helpUrl, qrDataUri, tableUrl } from '@/lib/dash/qr';
import { userClient } from '@/lib/supabase/server';

export default async function TablesPage() {
  const c = await dashContext();
  const db = await userClient();
  const { data } = await db.rpc('mgr_get_table_tokens');
  const rows = (data ?? []) as { table_id: string; label: string; active: boolean; qr_token: string }[];
  const tables: TableRow[] = await Promise.all(
    rows.map(async (r) => ({ id: r.table_id, label: r.label, active: r.active, qr: await qrDataUri(tableUrl(c.appOrigin, c.me.restaurant.slug, r.qr_token)) })),
  );
  const { data: room } = await db.rpc('mgr_get_room_service');
  const rr = (room ?? { enabled: false, token: null, rooms: [] }) as { enabled: boolean; token: string | null; rooms: string[] };
  const url = rr.enabled && rr.token ? tableUrl(c.appOrigin, c.me.restaurant.slug, rr.token) : null;
  const roomService: RoomService = { enabled: rr.enabled, url, qr: url ? await qrDataUri(url) : null, rooms: rr.rooms ?? [] };
  const { data: tl } = await db.rpc('mgr_get_table_link');
  const tr = (tl ?? { enabled: false, token: null }) as { enabled: boolean; token: string | null };
  const turl = tr.enabled && tr.token ? tableUrl(c.appOrigin, c.me.restaurant.slug, tr.token) : null;
  const tableLink: TableLink = { enabled: tr.enabled, url: turl, qr: turl ? await qrDataUri(turl) : null };
  const { data: hl } = await db.rpc('mgr_get_help_link');
  const hr = (hl ?? { enabled: false, token: null, topics: [] }) as { enabled: boolean; token: string | null; topics: string[] };
  const hurl = hr.enabled && hr.token ? helpUrl(c.appOrigin, c.me.restaurant.slug, hr.token) : null;
  const helpLink: HelpLink = { enabled: hr.enabled, url: hurl, qr: hurl ? await qrDataUri(hurl) : null, topics: hr.topics ?? [] };
  return <TablesManager tables={tables} roomService={roomService} tableLink={tableLink} helpLink={helpLink} canEditLinks={c.me.role === 'owner'} />;
}
