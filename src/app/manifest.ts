import type { MetadataRoute } from 'next';

// Makes the staff screen installable on a tablet ("Add to home screen"), opening full screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Taprizz Staff',
    short_name: 'Taprizz',
    description: 'Live orders, waiter calls and bills for restaurant staff.',
    start_url: '/staff',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#fafaf9',
    theme_color: '#1c1917',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
