/**
 * Token Wars — Screenshot Capture Script
 *
 * Captures key game scenes for store page materials.
 * Usage: node scripts/capture-screenshots.js
 * Output: dist/screenshots/ directory
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const GAME_URL = 'http://localhost:3000';
const OUTPUT_DIR = path.join(__dirname, '..', 'dist', 'screenshots');

const scenes = [
  {
    name: '01-login-screen',
    description: '登录界面 — 标题和认证',
    waitFor: () => document.querySelector('canvas') || document.body.innerText.includes('TOKEN'),
  },
  {
    name: '02-lobby-hub',
    description: '核心大厅 — 游戏入口',
    waitFor: () => document.body.innerText.includes('算力核心大厅'),
    // This will need auth - we should capture whatever is rendered
  },
  {
    name: '03-mining',
    description: '挖矿系统 — 被动收益',
    waitFor: () => document.body.innerText.includes('挂机挖矿'),
  },
  {
    name: '04-skill-arena',
    description: '战斗场景 — 地图与战斗',
    waitFor: () => {
      // Check for canvas rendering (Phaser)
      const canvas = document.querySelector('canvas');
      return canvas && canvas.width > 0;
    },
  },
  {
    name: '05-shop',
    description: '算力商城 — Token包购买',
    waitFor: () => document.body.innerText.includes('算力商城'),
  },
  {
    name: '06-inventory',
    description: '背包与技能盘 — Token管理',
    waitFor: () => document.body.innerText.includes('背包'),
  },
];

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          resolve(res.statusCode);
          res.resume();
        });
        req.on('error', reject);
        req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Server not ready after ${timeoutMs}ms`);
}

async function capture() {
  console.log('[Screenshots] Starting capture...\n');

  // Ensure server is running
  await waitForServer(GAME_URL);
  console.log('  ✓ Game server is running\n');

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Launch browser
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
  });

  const page = await browser.newPage();

  // Intercept and log console messages for debugging
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`  [browser] ${msg.text()}`);
    }
  });

  try {
    // Navigate to the game
    console.log('  Navigating to game...');
    await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000)); // Let Phaser initialize

    // Take screenshots of all scenes we can access
    for (const scene of scenes) {
      console.log(`\n  [${scene.name}] ${scene.description}`);

      // Wait a moment for the scene to render
      await new Promise(r => setTimeout(r, 1500));

      // Take a full-page screenshot
      const outputPath = path.join(OUTPUT_DIR, `${scene.name}.png`);
      await page.screenshot({
        path: outputPath,
        fullPage: false,
        type: 'png',
      });

      const stats = fs.statSync(outputPath);
      console.log(`  ✓ Saved: ${scene.name}.png (${(stats.size / 1024).toFixed(0)}KB)`);
    }

    // Also take a responsive set
    console.log('\n  Taking responsive screenshots...');
    const viewports = [
      { width: 1280, height: 720, name: 'desktop' },
      { width: 960, height: 640, name: 'default' },
    ];

    for (const vp of viewports) {
      await page.setViewport(vp);
      await new Promise(r => setTimeout(r, 500));
      const outputPath = path.join(OUTPUT_DIR, `responsive-${vp.name}.png`);
      await page.screenshot({ path: outputPath, type: 'png' });
      console.log(`  ✓ ${vp.name} (${vp.width}x${vp.height})`);
    }

  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
  } finally {
    await browser.close();
  }

  // Summary
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
  console.log(`\n  ─────────────────────`);
  console.log(`  Total screenshots: ${files.length}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log(`  Size: ${(fs.statSync(OUTPUT_DIR).size / 1024).toFixed(0)}KB`);
  console.log('');
}

capture().catch(console.error);
