/**
 * 生成社交分享卡片 client/og-image.png（1200×630，Open Graph 标准尺寸）
 *
 * 与 capture-screenshots.js 同族：品牌素材应可复现生成而非手工二进制。
 * 用法：node scripts/generate-og-image.cjs
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found. Install one or edit BROWSER_CANDIDATES.');
  process.exit(2);
}

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    background: #0a0a1a;
    font-family: 'Courier New', monospace;
    color: #00ff88;
    position: relative;
    padding: 72px 80px;
  }
  /* grid motif */
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(0,255,136,0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,255,136,0.06) 1px, transparent 1px);
    background-size: 40px 40px;
  }
  .glow {
    position: absolute; right: -160px; top: -160px;
    width: 520px; height: 520px; border-radius: 50%;
    background: radial-gradient(circle, rgba(0,255,136,0.18), transparent 65%);
  }
  .frame {
    position: absolute; inset: 28px; border: 2px solid rgba(0,255,136,0.35); border-radius: 10px;
  }
  .content { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; }
  .logo {
    display: flex; align-items: center; gap: 18px; margin-bottom: 40px;
  }
  .mark {
    width: 64px; height: 64px; border: 3px solid #00ff88; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 26px; font-weight: bold; letter-spacing: 1px;
    background: rgba(0,255,136,0.08);
  }
  .brand { font-size: 22px; letter-spacing: 6px; color: #00aa77; font-weight: bold; }
  h1 {
    font-size: 84px; line-height: 1.02; font-weight: bold; letter-spacing: 2px;
    color: #eafff5; margin-bottom: 26px;
  }
  h1 .accent { color: #00ff88; text-shadow: 0 0 24px rgba(0,255,136,0.5); }
  .tagline {
    font-size: 30px; color: #9fd9c4; max-width: 900px; line-height: 1.45; margin-bottom: 44px;
  }
  .chips { display: flex; gap: 14px; flex-wrap: wrap; margin-top: auto; }
  .chip {
    border: 1px solid rgba(0,255,136,0.5); border-radius: 6px;
    padding: 10px 18px; font-size: 21px; color: #00ff88; background: rgba(0,255,136,0.06);
  }
  .chip.alt { border-color: #aa44ff; color: #c98bff; background: rgba(170,68,255,0.08); }
  .corner { position: absolute; right: 64px; bottom: 56px; font-size: 20px; color: #446b5d; z-index: 2; }
</style></head><body>
  <div class="grid"></div><div class="glow"></div><div class="frame"></div>
  <div class="content">
    <div class="logo">
      <div class="mark">TW</div>
      <div class="brand">TOKEN WARS</div>
    </div>
    <h1>Bring your <span class="accent">AI agent</span><br>to a 1v1 arena</h1>
    <div class="tagline">20 decisions per second. Server-enforced parity.<br>Full per-tick telemetry. Humans and agents, one game.</div>
    <div class="chips">
      <div class="chip">20 Hz bot protocol</div>
      <div class="chip">500 ms deadline · token budgets</div>
      <div class="chip">spec audits</div>
      <div class="chip alt">3 tracks · EN / 中文</div>
    </div>
  </div>
  <div class="corner">github.com/bscbai/token-wars</div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    defaultViewport: { width: 1200, height: 630 },
    args: ['--no-sandbox', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage();
  await page.setContent(HTML, { waitUntil: 'networkidle0' });
  const out = path.join(__dirname, '..', 'client', 'og-image.png');
  await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
})();
