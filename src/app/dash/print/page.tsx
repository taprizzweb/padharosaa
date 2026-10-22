import { PrintButton } from '@/components/dash/PrintButton';
import { dashContext } from '@/lib/dash/context';
import { helpUrl, qrDataUri, tableUrl } from '@/lib/dash/qr';
import { userClient } from '@/lib/supabase/server';

export const metadata = { title: 'Print QR codes' };

export default async function PrintPage({ searchParams }: { searchParams: Promise<{ layout?: string; t?: string }> }) {
  const { layout, t } = await searchParams;
  const tent = layout === 'tent';
  const c = await dashContext();
  const db = await userClient();
  if (layout === 'help') {
    const { data: hl } = await db.rpc('mgr_get_help_link');
    const hr = hl as { enabled: boolean; token: string | null } | null;
    const qr = hr?.enabled && hr.token ? await qrDataUri(helpUrl(c.appOrigin, c.me.restaurant.slug, hr.token)) : null;
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
          <h1 className="mr-auto text-2xl font-extrabold">Call for problems card</h1>
          <PrintButton />
        </div>
        {!qr && <p className="print:hidden">Call for problems is off. Turn it on in Tables &amp; QR codes first.</p>}
        {qr && (
          <div className="print-tent flex flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-3xl font-extrabold">{c.me.restaurant.name}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to call for problems" width={320} height={320} className="h-80 w-80" />
            <p className="text-4xl font-extrabold">Need something?</p>
            <p className="text-xl font-bold">Scan, enter your room number and tell us what is wrong</p>
          </div>
        )}
      </div>
    );
  }
  if (layout === 'tablelink') {
    const { data: tl } = await db.rpc('mgr_get_table_link');
    const tr = tl as { enabled: boolean; token: string | null } | null;
    const qr = tr?.enabled && tr.token ? await qrDataUri(tableUrl(c.appOrigin, c.me.restaurant.slug, tr.token)) : null;
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
          <h1 className="mr-auto text-2xl font-extrabold">Shared table card</h1>
          <PrintButton />
        </div>
        {!qr && <p className="print:hidden">The shared table link is off. Turn it on in Tables &amp; QR codes first.</p>}
        {qr && (
          <div className="print-tent flex flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-3xl font-extrabold">{c.me.restaurant.name}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to order at your table" width={320} height={320} className="h-80 w-80" />
            <p className="text-4xl font-extrabold">Scan to order</p>
            <p className="text-xl font-bold">Pick your table number, then choose your dishes</p>
          </div>
        )}
      </div>
    );
  }
  if (layout === 'room') {
    const { data: room } = await db.rpc('mgr_get_room_service');
    const rr = room as { enabled: boolean; token: string | null } | null;
    const qr = rr?.enabled && rr.token ? await qrDataUri(tableUrl(c.appOrigin, c.me.restaurant.slug, rr.token)) : null;
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
          <h1 className="mr-auto text-2xl font-extrabold">Room service card</h1>
          <PrintButton />
        </div>
        {!qr && <p className="print:hidden">Room service is off. Turn it on in Tables &amp; QR codes first.</p>}
        {qr && (
          <div className="print-tent flex flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-3xl font-extrabold">{c.me.restaurant.name}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code to order room service" width={320} height={320} className="h-80 w-80" />
            <p className="text-4xl font-extrabold">Room service</p>
            <p className="text-xl font-bold">Scan, enter your room number and order</p>
          </div>
        )}
      </div>
    );
  }
  const { data } = await db.rpc('mgr_get_table_tokens');
  const rows = ((data ?? []) as { table_id: string; label: string; active: boolean; qr_token: string }[]).filter((r) => r.active && (!t || r.table_id === t));
  const cards = await Promise.all(rows.map(async (r) => ({ id: r.table_id, label: r.label, qr: await qrDataUri(tableUrl(c.appOrigin, c.me.restaurant.slug, r.qr_token)) })));
  const name = c.me.restaurant.name;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="mr-auto text-2xl font-extrabold">{tent ? 'Table tents' : 'QR sheet'}</h1>
        <PrintButton />
      </div>
      {cards.length === 0 && <p className="print:hidden">There are no active tables to print. Create tables first.</p>}
      {tent ? (
        <div>
          {cards.map((k) => (
            <div key={k.id} className="print-tent flex border border-stone-300 print:border-0">
              {[false, true].map((flip) => (
                <div key={String(flip)} aria-hidden={flip} className={`flex w-1/2 flex-col items-center justify-center gap-3 p-6 text-center ${flip ? 'rotate-180' : ''}`}>
                  <p className="text-2xl font-extrabold">{name}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={k.qr} alt={flip ? '' : `QR code for table ${k.label}`} width={260} height={260} className="h-64 w-64" />
                  <p className="text-3xl font-extrabold">Scan to order</p>
                  <p className="text-xl font-bold">Table {k.label}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="print-sheet grid grid-cols-2 gap-4 print:gap-0">
          {cards.map((k) => (
            <div key={k.id} className="print-card flex flex-col items-center justify-center gap-2 border border-dashed border-stone-400 p-4 text-center">
              <p className="text-xl font-extrabold">{name}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={k.qr} alt={`QR code for table ${k.label}`} width={200} height={200} className="h-48 w-48" />
              <p className="text-2xl font-extrabold">Scan to order</p>
              <p className="text-lg font-bold">Table {k.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
