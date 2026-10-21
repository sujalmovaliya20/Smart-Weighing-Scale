import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ICONS_DIR = path.join(process.cwd(), 'icons');
fs.mkdirSync(ICONS_DIR, { recursive: true });

// SVG for standard scale icon with #07111f background
const standardScaleSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bodyGrad" x1="100" y1="90" x2="412" y2="422" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#16253b"/>
      <stop offset="100%" stop-color="#0b1728"/>
    </linearGradient>
    <linearGradient id="borderGrad" x1="100" y1="90" x2="412" y2="422" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5bd4ff" stop-opacity="0.9"/>
      <stop offset="50%" stop-color="#39d98a" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#5bd4ff" stop-opacity="0.2"/>
    </linearGradient>
    <linearGradient id="displayGrad" x1="180" y1="130" x2="332" y2="195" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#040b14"/>
      <stop offset="100%" stop-color="#0a1524"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" rx="96" fill="#07111f"/>

  <!-- Scale Platform Body -->
  <rect x="96" y="86" width="320" height="340" rx="40" fill="url(#bodyGrad)" stroke="url(#borderGrad)" stroke-width="4"/>

  <!-- Four Corner Sensors -->
  <rect x="116" y="106" width="36" height="36" rx="10" fill="#1b2e47" stroke="#39d98a" stroke-width="2"/>
  <circle cx="134" cy="124" r="7" fill="#39d98a"/>

  <rect x="360" y="106" width="36" height="36" rx="10" fill="#1b2e47" stroke="#39d98a" stroke-width="2"/>
  <circle cx="378" cy="124" r="7" fill="#39d98a"/>

  <rect x="116" y="370" width="36" height="36" rx="10" fill="#1b2e47" stroke="#39d98a" stroke-width="2"/>
  <circle cx="134" cy="388" r="7" fill="#39d98a"/>

  <rect x="360" y="370" width="36" height="36" rx="10" fill="#1b2e47" stroke="#39d98a" stroke-width="2"/>
  <circle cx="378" cy="388" r="7" fill="#39d98a"/>

  <!-- Digital Display Screen -->
  <rect x="166" y="116" width="180" height="74" rx="16" fill="url(#displayGrad)" stroke="#5bd4ff" stroke-width="2" stroke-opacity="0.6"/>

  <!-- Bluetooth Symbol -->
  <path d="M 198 144 L 206 153 L 200 159 L 200 141 L 206 147 L 198 156" stroke="#5bd4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>

  <!-- Digital Weight Readout -->
  <text x="264" y="159" font-family="monospace, sans-serif" font-size="24" font-weight="800" fill="#39d98a" text-anchor="middle" letter-spacing="2">0.000</text>
  <text x="318" y="152" font-family="sans-serif" font-size="12" font-weight="700" fill="#5bd4ff">kg</text>

  <!-- Center Circular Target -->
  <circle cx="256" cy="286" r="92" fill="#101f33" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
  <circle cx="256" cy="286" r="68" fill="none" stroke="#5bd4ff" stroke-width="1.5" stroke-opacity="0.35" stroke-dasharray="5 4"/>

  <!-- Crosshairs & Center Node -->
  <path d="M256 244 L256 328 M214 286 L298 286" stroke="#39d98a" stroke-width="3" stroke-linecap="round" opacity="0.9"/>
  <circle cx="256" cy="286" r="14" fill="#39d98a" opacity="0.25"/>
  <circle cx="256" cy="286" r="7" fill="#5bd4ff"/>
</svg>
`;

// Maskable SVG with safe zone padding (scale artwork scaled down to 78% inside #07111f background)
const maskableScaleSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#07111f"/>
  <g transform="translate(56, 56) scale(0.78)">
    ${standardScaleSvg.replace(/<\/?svg[^>]*>/g, '').replace(/<rect width="512" height="512"[^>]*\/>/, '')}
  </g>
</svg>
`;

// Crisp favicon SVG
const faviconSvg = standardScaleSvg;

async function buildIcons() {
  console.log('Generating PWA icons with sharp...');

  // 1. icon-192.png
  await sharp(Buffer.from(standardScaleSvg))
    .resize(192, 192)
    .png()
    .toFile(path.join(ICONS_DIR, 'icon-192.png'));
  console.log('✓ icons/icon-192.png');

  // 2. icon-512.png
  await sharp(Buffer.from(standardScaleSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(ICONS_DIR, 'icon-512.png'));
  console.log('✓ icons/icon-512.png');

  // 3. icon-maskable-512.png
  await sharp(Buffer.from(maskableScaleSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(ICONS_DIR, 'icon-maskable-512.png'));
  console.log('✓ icons/icon-maskable-512.png');

  // 4. apple-touch-icon-180.png
  await sharp(Buffer.from(standardScaleSvg))
    .resize(180, 180)
    .png()
    .toFile(path.join(ICONS_DIR, 'apple-touch-icon-180.png'));
  console.log('✓ icons/apple-touch-icon-180.png');

  // 5. favicon.svg at root
  fs.writeFileSync(path.join(process.cwd(), 'favicon.svg'), faviconSvg, 'utf8');
  console.log('✓ favicon.svg');

  console.log('All PWA icons generated successfully!');
}

buildIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
