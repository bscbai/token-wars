/**
 * generate-icons.js
 * Generate application icon (PNG 256x256 + ICO 256x256) for desktop build.
 *
 * Output:
 *   - dist/icon.png (256x256)
 *   - dist/icon.ico (256x256, multi-size ICO)
 *
 * Usage: node scripts/generate-icons.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'dist');

function getIconHTML() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; }
  body { width: 256px; height: 256px; overflow: hidden; background: transparent; }
</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <filter id="neon" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="b1"/>
      <feGaussianBlur stdDeviation="5" result="b2"/>
      <feMerge><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#0f1530"/>
    </linearGradient>
    <linearGradient id="hexGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#00ff88"/>
      <stop offset="50%" stop-color="#00d4ff"/>
      <stop offset="100%" stop-color="#00ff88"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="256" height="256" fill="url(#bg)" rx="32"/>

  <!-- Outer hexagon -->
  <polygon points="${hexPoints(128, 128, 100)}"
           fill="#000000" fill-opacity="0.4"
           stroke="url(#hexGrad)" stroke-width="4"
           filter="url(#neon)"/>

  <!-- Inner hexagon -->
  <polygon points="${hexPoints(128, 128, 70)}"
           fill="#001a14" fill-opacity="0.9"
           stroke="#00d4ff" stroke-width="2"/>

  <!-- Letter T (Token) -->
  <text x="128" y="158" text-anchor="middle"
        font-family="monospace" font-size="80" font-weight="bold"
        fill="#00ff88" filter="url(#neon)">T</text>

  <!-- Corner ticks -->
  <line x1="20" y1="20" x2="40" y2="20" stroke="#00ff88" stroke-width="3"/>
  <line x1="20" y1="20" x2="20" y2="40" stroke="#00ff88" stroke-width="3"/>
  <line x1="236" y1="20" x2="216" y2="20" stroke="#00ff88" stroke-width="3"/>
  <line x1="236" y1="20" x2="236" y2="40" stroke="#00ff88" stroke-width="3"/>
  <line x1="20" y1="236" x2="40" y2="236" stroke="#00ff88" stroke-width="3"/>
  <line x1="20" y1="236" x2="20" y2="216" stroke="#00ff88" stroke-width="3"/>
  <line x1="236" y1="236" x2="216" y2="236" stroke="#00ff88" stroke-width="3"/>
  <line x1="236" y1="236" x2="236" y2="216" stroke="#00ff88" stroke-width="3"/>
</svg>
</body></html>`;
}

function hexPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`);
  }
  return pts.join(' ');
}

/**
 * Build a Windows .ico file from a single 256x256 PNG.
 * Format: ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes) + PNG data
 */
function buildIco(pngBuffer) {
  const ICONDIR_SIZE = 6;
  const ICONDIRENTRY_SIZE = 16;
  const totalSize = ICONDIR_SIZE + ICONDIRENTRY_SIZE + pngBuffer.length;

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // ICONDIR
  buf.writeUInt16LE(0, offset); offset += 2;        // reserved
  buf.writeUInt16LE(1, offset); offset += 2;        // type (1 = icon)
  buf.writeUInt16LE(1, offset); offset += 2;        // count

  // ICONDIRENTRY
  buf.writeUInt8(0, offset++);                       // width (0 = 256)
  buf.writeUInt8(0, offset++);                       // height (0 = 256)
  buf.writeUInt8(0, offset++);                       // colors in palette
  buf.writeUInt8(0, offset++);                       // reserved
  buf.writeUInt16LE(1, offset); offset += 2;         // color planes
  buf.writeUInt16LE(32, offset); offset += 2;        // bits per pixel
  buf.writeUInt32LE(pngBuffer.length, offset); offset += 4; // size of image data
  buf.writeUInt32LE(ICONDIR_SIZE + ICONDIRENTRY_SIZE, offset); offset += 4; // offset

  // PNG data
  pngBuffer.copy(buf, offset);

  return buf;
}

async function main() {
  console.log('\n[Token Wars] Generating application icons...\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // 1. Render PNG icon
    const page = await browser.newPage();
    await page.setViewport({ width: 256, height: 256 });
    await page.setContent(getIconHTML(), { waitUntil: 'domcontentloaded', timeout: 10000 });
    // Wait a moment for filters to render
    await new Promise(r => setTimeout(r, 200));

    const pngPath = path.join(OUTPUT_DIR, 'icon.png');
    await page.screenshot({ path: pngPath, type: 'png', omitBackground: false });
    const pngBuffer = fs.readFileSync(pngPath);
    console.log(`  [OK] icon.png (256x256, ${(pngBuffer.length / 1024).toFixed(1)}KB)`);
    await page.close();

    // 2. Build .ico file
    const icoBuffer = buildIco(pngBuffer);
    const icoPath = path.join(OUTPUT_DIR, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`  [OK] icon.ico (256x256, ${(icoBuffer.length / 1024).toFixed(1)}KB)`);

    // 3. Also save to build/ for Electron packaging
    const buildDir = path.join(OUTPUT_DIR, '..', 'build');
    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
    }
    fs.copyFileSync(pngPath, path.join(buildDir, 'icon.png'));
    fs.copyFileSync(icoPath, path.join(buildDir, 'icon.ico'));
    console.log(`  [OK] build/icon.png + build/icon.ico`);

    console.log('\n[Token Wars] Icons generated!\n');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
