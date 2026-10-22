import type { Translator } from '@/lib/i18n';

/** Full-page friendly state (suspended, not found, too many requests, server error). Server- and client-safe. */
export function StatePage({ title, body, t, action }: { title: string; body: string; t: Translator; action?: { href: string; label: string } }) {
  void t;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p className="mt-3 text-stone-700">{body}</p>
      {action && (
        <a href={action.href} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-stone-900 px-6 font-semibold text-white">
          {action.label}
        </a>
      )}
    </main>
  );
}
