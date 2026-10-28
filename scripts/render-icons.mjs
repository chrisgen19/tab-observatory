// Renders the extension icons into public/icons/. Run: node scripts/render-icons.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'icons');

// Brand green and amber bar from the dashboard tokens (src/dashboard/styles.css).
const BRAND = '#166e57';
const AMBER = '#e2c27c';
const LIGHT = '#d7efe6';

// Full detail for 48px and up: telescope with eyepiece and lens hood on a tripod, plus a three-bar meter.
const DETAILED = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="${BRAND}"/>
  <g fill="${LIGHT}">
    <rect x="14" y="90" width="12" height="20" rx="3"/>
    <rect x="31" y="80" width="12" height="30" rx="3"/>
  </g>
  <rect x="48" y="72" width="12" height="38" rx="3" fill="${AMBER}"/>
  <g stroke="#fff" stroke-width="7" stroke-linecap="round">
    <line x1="86" y1="54" x2="72" y2="110"/>
    <line x1="86" y1="54" x2="102" y2="110"/>
  </g>
  <g transform="translate(86 42) rotate(-40)" fill="#fff">
    <rect x="-24" y="-9" width="44" height="18" rx="5"/>
    <rect x="-34" y="-6" width="12" height="12" rx="3"/>
    <rect x="18" y="-13" width="12" height="26" rx="4"/>
  </g>
</svg>`;

// Simplified for 16/32px toolbar sizes: fewer, thicker shapes so the silhouette survives downscaling.
const SMALL = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="${BRAND}"/>
  <rect x="3" y="20" width="5" height="9" rx="1" fill="${LIGHT}"/>
  <rect x="10" y="14" width="5" height="15" rx="1" fill="${AMBER}"/>
  <g stroke="#fff" stroke-width="2.5" stroke-linecap="round">
    <line x1="21" y1="16" x2="18" y2="29"/>
    <line x1="21" y1="16" x2="26" y2="29"/>
  </g>
  <g transform="translate(21 12) rotate(-40)" fill="#fff">
    <rect x="-7" y="-3.5" width="12" height="7" rx="1.5"/>
    <rect x="4" y="-4.5" width="4" height="9" rx="1.5"/>
  </g>
</svg>`;

const SIZES = [
  { size: 16, svg: SMALL },
  { size: 32, svg: SMALL },
  { size: 48, svg: DETAILED },
  { size: 128, svg: DETAILED },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const page = await browser.newPage();
  for (const { size, svg } of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.locator('svg').screenshot({ path: path.join(out, `icon-${size}.png`), omitBackground: true });
  }
} finally {
  await browser.close();
}
