/** Renders the PWA icons (public/icons/*.png) from an inline SVG with the browser Playwright already has. Run: tsx scripts/make-icons.ts */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const pre = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const svg = (size: number, pad: number, round: boolean) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${round ? 112 : 0}" fill="#1c1917"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - pad * 2) / 512})">
    <path d="M150 170h212M150 256h212M150 342h120" stroke="#f59e0b" stroke-width="44" stroke-linecap="round" fill="none"/>
  </g>
</svg>`;

(async () => {
  mkdirSync('public/icons', { recursive: true });
  const browser = await chromium.launch({ executablePath: existsSync(pre) ? pre : undefined, args: ['--no-sandbox'] });
  const jobs: [string, number, number, boolean][] = [
    ['icon-192.png', 192, 40, true],
    ['icon-512.png', 512, 40, true],
    ['maskable-512.png', 512, 110, false], // maskable: glyph stays inside the central safe zone
  ];
  for (const [name, size, pad, round] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0;background:transparent">${svg(size, pad, round)}</body>`);
    writeFileSync(`public/icons/${name}`, await page.screenshot({ omitBackground: true, type: 'png' }));
    await page.close();
  }
  await browser.close();
  console.log('icons written');
})();
