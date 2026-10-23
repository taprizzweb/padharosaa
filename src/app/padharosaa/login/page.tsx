import type { Metadata } from 'next';
import { LoginForm } from '@/app/login/LoginForm';

export const metadata: Metadata = { title: 'Padharosaa sign in', robots: { index: false, follow: false } };

// Front door of padharosaa.* for hotel staff. Same checked sign-in as the menu app; it lands on the hotel desk.
export default async function PadharosaaLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <p className="text-sm font-bold uppercase tracking-widest text-orange-900">Padharosaa</p>
      <h1 className="mt-1 text-3xl font-extrabold">Hotel staff sign in</h1>
      <p className="mt-2 text-stone-700">Use the email and password your manager gave you. Reception, housekeeping, kitchen and managers all sign in here.</p>
      <LoginForm next={next} />
      <p className="mt-8 text-center text-xs text-stone-600">Powered by Taprizz</p>
    </main>
  );
}
