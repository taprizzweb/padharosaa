import { POWERED_BY, instagramUrl } from '@/lib/brand';

/** "Powered by Taprizz" (and the platform's Instagram) inside the footer line at the bottom of the public menu. */
export function PoweredBy() {
  const url = instagramUrl(POWERED_BY.instagram);
  return (
    <span>
      Powered by <span className="font-bold text-stone-900">{POWERED_BY.name}</span>
      {url && (
        <>
          {' · '}
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-stone-900 underline underline-offset-2">
            @{POWERED_BY.instagram.replace(/^@/, '')}
          </a>
        </>
      )}
    </span>
  );
}
