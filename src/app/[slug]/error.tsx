'use client';

// Shown when something unexpected fails while loading a menu. No technical details are displayed.
export default function MenuError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-extrabold">Something went wrong</h1>
      <p className="mt-3 text-stone-700">Please try again. If it keeps happening, ask a team member.</p>
      {error.digest && <p className="mt-2 text-xs text-stone-600">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-stone-900 px-6 font-semibold text-white">
        Try again
      </button>
    </main>
  );
}
