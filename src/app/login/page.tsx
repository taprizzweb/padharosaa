import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Staff sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <h1 className="text-3xl font-extrabold">Staff sign in</h1>
      <p className="mt-2 text-stone-700">Use the email and password your manager gave you.</p>
      <LoginForm next={next} />
    </main>
  );
}
