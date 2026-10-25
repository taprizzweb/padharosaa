import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { rpc } from '@/lib/guest/rpc';
import { slug as slugSchema } from '@/lib/padharosaa/schemas';
import { DemoStart } from './DemoStart';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Try the hotel guest app', robots: { index: false, follow: false } };

// The public demo link of a hotel the platform admin switched to demo: a short page with one button, no sign-in. Any other hotel is a 404.
export default async function TryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();
  const info = await rpc<{ name: string; slug: string } | null>('padh_demo_info', { p_slug: parsed.data }).catch(() => null);
  if (!info) notFound();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-10" style={{ background: '#faf7f2', color: '#1c1917' }}>
      <p className="text-sm font-bold uppercase tracking-widest" style={{ color: '#a8493c' }}>Padharosaa demo</p>
      <h1 className="text-3xl font-extrabold leading-tight">{info.name}</h1>
      <p className="text-base">This is how your guests will see the hotel on their own phone: order food to the room, ask for housekeeping, a cab or laundry pick-up, see today&apos;s buffet and the Jaipur guide. Nothing here is real. No sign-in, no number, no app to install.</p>
      <ul className="list-disc space-y-1 pl-5 text-base">
        <li>Tap the button, you are a guest in a demo room.</li>
        <li>Send a request. It is answered by itself in about 20 seconds, so you can watch it move.</li>
        <li>Place a food order and watch it go from placed to served.</li>
      </ul>
      <DemoStart slug={info.slug} />
      <p className="text-xs" style={{ color: '#57534e' }}>Powered by Taprizz. Your demo visit ends by itself after a few hours.</p>
    </main>
  );
}
