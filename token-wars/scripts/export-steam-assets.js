const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const assets = [
  {
    name: '01-steam-library-capsule',
    width: 616, height: 353,
    svg: 'steam-capsule.svg',
    description: 'Library Capsule',
  },
  {
    name: '02-steam-header-capsule',
    width: 460, height: 215,
    svg: 'steam-capsule.svg',
    description: 'Header Capsule',
  },
  {
    name: '03-steam-small-capsule',
    width: 231, height: 87,
    svg: 'steam-capsule.svg',
    description: 'Small Capsule',
  },
  {
    name: '04-steam-main-capsule',
    width: 616, height: 353,
    svg: 'steam-capsule.svg',
    description: 'Main Capsule',
  },
];

async function render() {
  console.log('[Steam Export] Starting...\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  for (const asset of assets) {
    console.log(`  Rendering ${asset.name} (${asset.width}x${asset.height})...`);

    const page = await browser.newPage();
    await page.setViewport({ width: asset.width, height: asset.height, deviceScaleFactor: 2 });

    // Read SVG and embed in HTML at target size
    const svgPath = path.join(OUT, asset.svg);
    const svgContent = fs.readFileSync(svgPath, 'utf-8');
    const html = `<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;background:#0a0a1a}</style></head><body>${svgContent}</body></html>`;

    await page.setContent(html, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));

    await page.screenshot({
      path: path.join(OUT, `${asset.name}.png`),
      type: 'png',
      fullPage: false,
    });

    const size = fs.statSync(path.join(OUT, `${asset.name}.png`)).size;
    console.log(`    ✓ ${(size / 1024).toFixed(0)}KB`);

    await page.close();
  }

  // Render a concept screenshot at 1920x1080 using the game's look
  console.log(`\n  Rendering concept screenshot (1920x1080)...`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  const conceptHtml = `<!DOCTYPE html><html><head><style>
    body{margin:0;overflow:hidden;background:#0a0a1a;font-family:monospace}
    .game{position:relative;width:1920px;height:1080px}
    .grid{position:absolute;top:0;left:0;right:0;bottom:40px;background:#0f0f20}
    .hud{position:absolute;top:10px;left:20px;right:20px;display:flex;gap:20px;color:#888;font-size:14px}
    .hud span{color:#0f0}
    .skills{position:absolute;bottom:5px;left:50%;transform:translateX(-50%);display:flex;gap:8px}
    .skill{width:48px;height:48px;border:2px solid #00ff88;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#00ff88;font-size:18px;font-weight:bold;background:#0a1a0a}
    .skill.f{color:#ff8800;border-color:#ff8800;background:#1a0a0a}
    .overlay{position:absolute;bottom:10px;left:20px;color:#ffaa00;font-size:14px}
  </style></head><body>
  <div class="game">
    <div class="hud">
      <div>HP: <span>80/100</span></div>
      <div>Shield: <span style="color:#4488ff">20/50</span></div>
      <div style="margin-left:auto">Tokens: <span style="color:#ffaa00">32</span></div>
      <div>PvP: <span style="color:#ff8800">1125</span></div>
    </div>
    <div class="grid">
      <svg viewBox="0 0 680 383" xmlns="http://www.w3.org/2000/svg" width="1920" height="1040" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width="680" height="383" fill="#0f0f20"/>
        <g stroke="#1a1a30" stroke-width="0.5">
          <line x1="0" y1="32" x2="480" y2="32"/><line x1="0" y1="64" x2="480" y2="64"/><line x1="0" y1="96" x2="480" y2="96"/><line x1="0" y1="128" x2="480" y2="128"/><line x1="0" y1="160" x2="480" y2="160"/><line x1="0" y1="192" x2="480" y2="192"/><line x1="0" y1="224" x2="480" y2="224"/><line x1="0" y1="256" x2="480" y2="256"/><line x1="0" y1="288" x2="480" y2="288"/>
          <line x1="32" y1="0" x2="32" y2="320"/><line x1="64" y1="0" x2="64" y2="320"/><line x1="96" y1="0" x2="96" y2="320"/><line x1="128" y1="0" x2="128" y2="320"/><line x1="160" y1="0" x2="160" y2="320"/><line x1="192" y1="0" x2="192" y2="320"/><line x1="224" y1="0" x2="224" y2="320"/><line x1="256" y1="0" x2="256" y2="320"/><line x1="288" y1="0" x2="288" y2="320"/><line x1="320" y1="0" x2="320" y2="320"/><line x1="352" y1="0" x2="352" y2="320"/><line x1="384" y1="0" x2="384" y2="320"/><line x1="416" y1="0" x2="416" y2="320"/><line x1="448" y1="0" x2="448" y2="320"/>
        </g>
        <g fill="#2a2a4e">
          <rect x="0" y="0" width="480" height="32"/><rect x="0" y="288" width="480" height="32"/>
          <rect x="0" y="0" width="32" height="320"/><rect x="448" y="0" width="32" height="320"/>
          <rect x="96" y="96" width="32" height="32"/><rect x="352" y="96" width="32" height="32"/>
          <rect x="96" y="192" width="32" height="32"/><rect x="352" y="192" width="32" height="32"/>
        </g>
        <text x="48" y="308" text-anchor="middle" fill="#00ff88" font-size="9" font-family="monospace" opacity="0.5">SPAWN A</text>
        <text x="432" y="308" text-anchor="middle" fill="#ff4444" font-size="9" font-family="monospace" opacity="0.5">SPAWN B</text>
        <g transform="translate(60,280)"><circle cx="0" cy="0" r="12" fill="#00ff88" opacity="0.15"/><circle cx="0" cy="0" r="8" fill="none" stroke="#00ff88" stroke-width="2"/><circle cx="0" cy="0" r="3" fill="#88ffcc"/><text x="0" y="-18" text-anchor="middle" fill="#88ffcc" font-size="9" font-family="monospace">player 1</text></g>
        <g transform="translate(90,280)"><circle cx="0" cy="0" r="12" fill="#00ff88" opacity="0.15"/><circle cx="0" cy="0" r="8" fill="none" stroke="#00ff88" stroke-width="2"/><circle cx="0" cy="0" r="3" fill="#88ffcc"/></g>
        <g transform="translate(390,120)"><circle cx="0" cy="0" r="12" fill="#ff4444" opacity="0.15"/><circle cx="0" cy="0" r="8" fill="none" stroke="#ff4444" stroke-width="2"/><circle cx="0" cy="0" r="3" fill="#ff8888"/><text x="0" y="-18" text-anchor="middle" fill="#ff8888" font-size="9" font-family="monospace">enemy 1</text></g>
        <g transform="translate(360,100)"><circle cx="0" cy="0" r="12" fill="#ff4444" opacity="0.15"/><circle cx="0" cy="0" r="8" fill="none" stroke="#ff4444" stroke-width="2"/><circle cx="0" cy="0" r="3" fill="#ff8888"/></g>
        <g transform="translate(200,180)"><circle cx="0" cy="0" r="4" fill="#ffff00" opacity="0.8"/><circle cx="0" cy="0" r="8" fill="none" stroke="#ffff00" stroke-width="1" opacity="0.4"/></g>
        <line x1="200" y1="180" x2="340" y2="160" stroke="#ffff00" stroke-width="1" opacity="0.3" stroke-dasharray="2,2"/>
        <g transform="translate(160,120)"><circle cx="0" cy="0" r="24" fill="#ff0000" opacity="0.08"/><circle cx="0" cy="0" r="24" fill="none" stroke="#ff0000" stroke-width="1" opacity="0.4"/></g>
        <text x="390" y="85" fill="#ffff00" font-size="13" font-family="monospace" font-weight="bold" opacity="0.8">-15</text>
        <text x="100" y="255" fill="#ff4444" font-size="13" font-family="monospace" font-weight="bold" opacity="0.7">-8</text>
      </svg>
    </div>
    <div class="skills">
      <div class="skill">Q</div><div class="skill">E</div><div class="skill">R</div><div class="skill f">F</div>
    </div>
    <div class="overlay">round 2 of 3  |  shrink in 30s</div>
  </div>
  </body></html>`;

  await page.setContent(conceptHtml, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));

  // Take 3 different screenshots at different "crop" positions
  await page.screenshot({ path: path.join(OUT, '05-screenshot-combat.png'), type: 'png' });
  console.log(`    ✓ screenshot-combat (${(fs.statSync(path.join(OUT, '05-screenshot-combat.png')).size / 1024).toFixed(0)}KB)`);

  // Lobby concept
  const lobbyHtml = `<!DOCTYPE html><html><head><style>
    body{margin:0;overflow:hidden;background:#0a0a1a;font-family:monospace}
    .lobby{width:1920px;height:1080px;display:flex;flex-direction:column;align-items:center;padding-top:40px}
    h1{color:#00ff88;font-size:32px;letter-spacing:4px;margin:0}
    h2{color:#008866;font-size:18px;letter-spacing:6px;margin:10px 0 30px}
    .stats{display:flex;gap:40px;margin-bottom:30px}
    .stat-card{background:#111122;border:1px solid #00ff88;border-radius:8px;padding:15px 25px;min-width:280px}
    .stat-card .name{color:#00ff88;font-size:24px;font-weight:bold}
    .stat-card .level{color:#ffaa00;font-size:14px}
    .stat-card .bar{margin:8px 0;display:flex;align-items:center;gap:10px}
    .stat-card .bar-label{color:#666;font-size:12px;width:30px}
    .stat-card .bar-fill{height:12px;border-radius:3px}
    .grid-btns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;width:900px}
    .btn{border:2px solid;border-radius:8px;padding:20px;text-align:center;font-size:20px;font-weight:bold;cursor:pointer}
    .btn .desc{font-size:12px;opacity:0.7;font-weight:normal}
  </style></head><body>
  <div class="lobby">
    <h1>TOKEN WARS</h1><h2>算力核心大厅</h2>
    <div class="stats">
      <div class="stat-card">
        <div class="name">player_name</div><div class="level">Lv.5</div>
        <div class="bar"><span class="bar-label">HP</span><div class="bar-fill" style="width:200px;background:linear-gradient(90deg,#00ff44 90%,#333 90%)"></div><span style="color:#aaa;font-size:12px">90/100</span></div>
        <div class="bar"><span class="bar-label">XP</span><div class="bar-fill" style="width:200px;background:linear-gradient(90deg,#8844ff 60%,#333 60%)"></div><span style="color:#aaa;font-size:12px">800/2000</span></div>
        <div style="color:#ff4444;font-size:14px;margin-top:8px">ATK: 28</div>
        <div style="color:#4488ff;font-size:14px">DEF: 12</div>
        <div style="color:#ffaa00;font-size:14px">Tokens: 32  |  Credits: 450</div>
      </div>
    </div>
    <div class="grid-btns">
      <div class="btn" style="color:#00aaff;border-color:#00aaff;background:#0a1a2a22">Mine<div class="desc">passive rewards</div></div>
      <div class="btn" style="color:#ff4444;border-color:#ff4444;background:#2a0a0a22">PvE<div class="desc">dungeons &amp; bosses</div></div>
      <div class="btn" style="color:#ff8800;border-color:#ff8800;background:#2a1a0a22">PvP<div class="desc">1v1 &amp; 3v3</div></div>
      <div class="btn" style="color:#44ffaa;border-color:#44ffaa;background:#0a2a1a22">AI Arena<div class="desc">auto-battle</div></div>
      <div class="btn" style="color:#aa44ff;border-color:#aa44ff;background:#1a0a2a22">Shop<div class="desc">token packs</div></div>
      <div class="btn" style="color:#44ff88;border-color:#44ff88;background:#0a2a1a22">Inventory<div class="desc">skill disk</div></div>
    </div>
    <div style="background:#111122;border:1px solid #333;border-radius:6px;padding:15px 30px;margin-top:30px;width:860px;display:flex;gap:60px">
      <span style="color:#888;font-size:14px">players online: <span style="color:#00ff88;font-size:18px">42</span></span>
      <span style="color:#888;font-size:14px">season: <span style="color:#ff8800;font-size:14px">quantum awakens</span></span>
      <span style="color:#888;font-size:14px">season lv: <span style="color:#ff0;font-size:14px">18</span></span>
    </div>
  </div>
  </body></html>`;

  await page.setContent(lobbyHtml, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, '06-screenshot-lobby.png'), type: 'png' });
  console.log(`    ✓ screenshot-lobby (${(fs.statSync(path.join(OUT, '06-screenshot-lobby.png')).size / 1024).toFixed(0)}KB)`);

  await browser.close();
  console.log(`\n  All screenshots exported to ${OUT}/`);
}

render().catch(err => { console.error(err); process.exit(1); });
