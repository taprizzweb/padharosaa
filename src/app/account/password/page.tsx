import type { Metadata } from 'next';
import { PasswordForm } from './PasswordForm';

export const metadata: Metadata = { title: 'Choose your password' };

export default function PasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10" data-accent="saffron">
      <h1 className="text-3xl font-extrabold">Choose your password</h1>
      <p className="mt-2 text-stone-700">You signed in with a temporary password. Please choose your own before you continue. Use at least 12 characters and something that is hard to guess.</p>
      <PasswordForm />
    </main>
  );
}
