/**
 * generate-missing-assets.js
 * Generates all Steam assets currently missing from dist/screenshots/
 *
 * Creates:
 *   - library-hero-capsule.png (3840x1240) — Wide hero banner
 *   - vertical-capsule.png (748x896) — Portrait/vertical capsule
 *   - screenshot-ai-arena.png (1920x1080) — AI arena scene
 *   - screenshot-combat-action.png (1920x1080) — Action shot with projectiles
 *   - screenshot-tokens.png (1920x1080) — Token collection showcase
 *   - page-background.png (1438x2300) — Steam store page background (optional)
 *
 * Usage: node scripts/generate-missing-assets.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'dist', 'screenshots');

// ─── SVG Generators ──────────────────────────────────────────────────

/**
 * Library Hero Capsule (3840x1240) — Wide hero banner
 */
function getLibraryHeroHTML() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 3840px; height: 1240px; overflow: hidden;
         background: #0a0a0f; font-family: 'Courier New', monospace; }
</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="1240" viewBox="0 0 3840 1240">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur1"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation="20" result="blur2"/>
      <feMerge>
        <feMergeNode in="blur2"/>
        <feMergeNode in="blur1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0f"/>
      <stop offset="40%" stop-color="#0f1530"/>
      <stop offset="100%" stop-color="#0a0a0f"/>
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.5"/>
    </radialGradient>
  </defs>

  <rect width="3840" height="1240" fill="url(#bg)"/>

  <!-- Grid lines -->
  ${Array.from({length: 64}, (_, i) => `<line x1="${i*60}" y1="0" x2="${i*60}" y2="1240" stroke="#1a1a3e" stroke-width="1" opacity="0.25"/>`).join('')}
  ${Array.from({length: 21}, (_, i) => `<line x1="0" y1="${i*60}" x2="3840" y2="${i*60}" stroke="#1a1a3e" stroke-width="1" opacity="0.25"/>`).join('')}

  <!-- Scanlines -->
  ${Array.from({length: 310}, (_, i) => `<line x1="0" y1="${i*4}" x2="3839" y2="${i*4+1}" stroke="#ffffff" stroke-width="1" opacity="0.015"/>`).join('')}

  <!-- Left side: player character silhouette -->
  <g transform="translate(600, 620)">
    <polygon points="0,-300 -240,200 0,120 240,200" fill="#00ff88" opacity="0.15" stroke="#00ff88" stroke-width="4" filter="url(#glow)"/>
    <polygon points="0,-300 -240,200 0,120 240,200" fill="#00ff88" opacity="0.5"/>
    <circle cx="0" cy="0" r="15" fill="#ffffff" opacity="0.9"/>
    <text x="0" y="-340" text-anchor="middle" fill="#00ff88" font-size="36" font-family="monospace" opacity="0.7">[ PLAYER 01 ]</text>
  </g>

  <!-- Right side: AI agent silhouette -->
  <g transform="translate(3240, 620)">
    <polygon points="0,-300 -240,200 0,120 240,200" fill="#ff006e" opacity="0.15" stroke="#ff006e" stroke-width="4" filter="url(#glow)"/>
    <polygon points="0,-300 -240,200 0,120 240,200" fill="#ff006e" opacity="0.5"/>
    <circle cx="0" cy="0" r="15" fill="#ffffff" opacity="0.9"/>
    <text x="0" y="-340" text-anchor="middle" fill="#ff006e" font-size="36" font-family="monospace" opacity="0.7">[ AI AGENT ]</text>
  </g>

  <!-- VS symbol in center -->
  <g transform="translate(1920, 620)">
    <text text-anchor="middle" fill="#00d4ff" font-size="200" font-family="monospace" font-weight="bold" filter="url(#glow)">VS</text>
  </g>

  <!-- Title block -->
  <g transform="translate(1920, 320)">
    <text text-anchor="middle" fill="#00ff88" font-size="180" font-weight="bold" font-family="monospace" filter="url(#glow)" letter-spacing="20">TOKEN WARS</text>
    <text x="0" y="100" text-anchor="middle" fill="#00d4ff" font-size="80" font-family="monospace" filter="url(#glow)" letter-spacing="20">算 力 征 途</text>
    <text x="0" y="240" text-anchor="middle" fill="#ffaa00" font-size="40" font-family="monospace" opacity="0.7">COMPUTE IS POWER // 算力即力量</text>
  </g>

  <!-- Decorative hexagons -->
  ${[
    {x:300, y:200, c:'#ff006e'},{x:3540, y:300, c:'#00d4ff'},
    {x:200, y:1040, c:'#00ff88'},{x:3640, y:1000, c:'#ffaa00'},
    {x:1400, y:1080, c:'#ff006e'},{x:2440, y:1080, c:'#00d4ff'}
  ].map(h => `<polygon points="${hexPoints(h.x, h.y, 40)}" fill="${h.c}" opacity="0.15" stroke="${h.c}" stroke-width="2"/>`).join('')}

  <!-- Bottom decorative bar -->
  <rect x="0" y="1180" width="3840" height="60" fill="#00ff88" opacity="0.1"/>
  <line x1="0" y1="1180" x2="3840" y2="1180" stroke="#00ff88" stroke-width="2" opacity="0.4"/>

  <!-- Top status bar -->
  <rect x="0" y="0" width="3840" height="60" fill="#00ff88" opacity="0.05"/>
  <text x="60" y="40" fill="#00ff88" font-size="24" font-family="monospace" opacity="0.6">[SYS] TOKEN WARS :: 算力征途 v0.3.0 :: CYBERPUNK EDITION :: READY</text>

  <rect width="3840" height="1240" fill="url(#vignette)" pointer-events="none"/>
</svg>
</body></html>`;
}

/**
 * Vertical Capsule (748x896) — Portrait orientation
 */
function getVerticalCapsuleHTML() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 748px; height: 896px; overflow: hidden;
         background: #0a0a0f; font-family: 'Courier New', monospace; }
</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="748" height="896" viewBox="0 0 748 896">
  <defs>
    <filter id="neonGlow"><feGaussianBlur stdDeviation="3" result="b1"/><feGaussianBlur stdDeviation="8" result="b2"/><feMerge><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0f"/>
      <stop offset="50%" stop-color="#0f1530"/>
      <stop offset="100%" stop-color="#0a0a0f"/>
    </linearGradient>
  </defs>

  <rect width="748" height="896" fill="url(#bg)"/>

  <!-- Grid -->
  ${Array.from({length: 13}, (_, i) => `<line x1="${i*60}" y1="0" x2="${i*60}" y2="896" stroke="#1a1a3e" opacity="0.25"/>`).join('')}
  ${Array.from({length: 15}, (_, i) => `<line x1="0" y1="${i*60}" x2="748" y2="${i*60}" stroke="#1a1a3e" opacity="0.25"/>`).join('')}

  <!-- Corner brackets -->
  <path d="M40 90 L40 40 L90 40" stroke="#00ff88" stroke-width="2" fill="none" opacity="0.6"/>
  <path d="M658 40 L708 40 L708 90" stroke="#00ff88" stroke-width="2" fill="none" opacity="0.6"/>
  <path d="M40 806 L40 856 L90 856" stroke="#00ff88" stroke-width="2" fill="none" opacity="0.6"/>
  <path d="M658 856 L708 856 L708 806" stroke="#00ff88" stroke-width="2" fill="none" opacity="0.6"/>

  <!-- Main icon: large hex token -->
  <g transform="translate(374, 320)">
    <polygon points="${hexPoints(0, 0, 180)}" fill="#00ff88" opacity="0.15" stroke="#00ff88" stroke-width="4" filter="url(#neonGlow)"/>
    <polygon points="${hexPoints(0, 0, 120)}" fill="#00d4ff" opacity="0.3" stroke="#00d4ff" stroke-width="2"/>
    <text text-anchor="middle" y="20" fill="#ffffff" font-size="80" font-weight="bold" font-family="monospace" filter="url(#neonGlow)">T</text>
  </g>

  <!-- Title -->
  <text x="374" y="600" text-anchor="middle" fill="#00ff88" font-size="80" font-weight="bold" font-family="monospace" filter="url(#neonGlow)" letter-spacing="6">TOKEN WARS</text>
  <text x="374" y="660" text-anchor="middle" fill="#00d4ff" font-size="40" font-family="monospace" letter-spacing="10">算力征途</text>

  <!-- Tagline -->
  <text x="374" y="740" text-anchor="middle" fill="#ffaa00" font-size="20" font-family="monospace" opacity="0.8">COMPUTE IS POWER</text>

  <!-- Accent line -->
  <rect x="240" y="770" width="268" height="2" fill="#ff006e" opacity="0.5"/>

  <!-- Decorative hexagons -->
  ${[
    {x: 80, y: 200, c: '#ff006e'},
    {x: 668, y: 250, c: '#00d4ff'},
    {x: 60, y: 700, c: '#00ff88'},
    {x: 688, y: 720, c: '#ffaa00'}
  ].map(h => `<polygon points="${hexPoints(h.x, h.y, 25)}" fill="${h.c}" opacity="0.2" stroke="${h.c}" stroke-width="2"/>`).join('')}

  <!-- Version tag -->
  <text x="688" y="836" text-anchor="end" fill="#00d4ff" font-size="14" font-family="monospace" opacity="0.5">v0.3.0</text>
</svg>
</body></html>`;
}

/**
 * AI Arena screenshot — show three-panel layout with agent list, detail, leaderboard
 */
function getAIArenaScreenshotHTML() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; overflow: hidden;
         background: #0a0a12; font-family: 'Courier New', monospace; color: #00ff88; }

  .container { display: flex; width: 100%; height: 100%; }

  /* Top HUD */
  .hud { position: absolute; top: 0; left: 0; right: 0; height: 60px;
         background: rgba(0, 20, 10, 0.9); border-bottom: 1px solid #00ff88;
         display: flex; align-items: center; padding: 0 24px; }
  .hud-title { font-size: 24px; font-weight: bold; }
  .hud-info { margin-left: auto; font-size: 14px; color: #00d4ff; }

  /* Three panel layout */
  .panel { background: rgba(10, 20, 15, 0.7); border: 1px solid #00ff4455; }
  .panel-header { background: rgba(0, 80, 30, 0.5); padding: 12px 16px; font-size: 18px; font-weight: bold; border-bottom: 1px solid #00ff44; }

  .left-panel { width: 380px; margin-left: 16px; margin-top: 76px; height: 980px; }
  .center-panel { flex: 1; margin: 76px 16px 16px 16px; height: 980px; }
  .right-panel { width: 380px; margin-right: 16px; margin-top: 76px; height: 980px; }

  /* Agent list */
  .agent-item { padding: 12px 16px; border-bottom: 1px solid #00ff4422; cursor: pointer; }
  .agent-item:hover { background: rgba(0, 80, 40, 0.3); }
  .agent-item.selected { background: rgba(0, 100, 60, 0.5); border-left: 4px solid #00ff88; }
  .agent-name { font-size: 16px; }
  .agent-info { font-size: 12px; color: #00d4ff; margin-top: 4px; }
  .stars { color: #ffaa00; }
  .deployed { color: #ff006e; }

  /* Center detail */
  .detail-section { padding: 16px; border-bottom: 1px solid #00ff4422; }
  .detail-title { font-size: 16px; color: #00d4ff; margin-bottom: 12px; }
  .stat-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
  .stat-label { color: #888; }
  .stat-value { color: #00ff88; font-weight: bold; }

  /* Token disk grid */
  .token-disk { width: 60px; height: 60px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 11px; text-align: center; margin: 4px;
                background: rgba(0,0,0,0.6); border: 2px solid; }
  .disk-rarity-common { border-color: #888; }
  .disk-rarity-uncommon { border-color: #00d4ff; }
  .disk-rarity-rare { border-color: #ffaa00; }
  .disk-rarity-epic { border-color: #ff006e; }
  .disk-empty { border-color: #333; color: #555; }
  .disk-grid { display: flex; flex-wrap: wrap; }

  /* Weight bar */
  .weight-row { margin: 8px 0; }
  .weight-label { font-size: 12px; color: #888; display: flex; justify-content: space-between; }
  .weight-bar { height: 8px; background: rgba(0,0,0,0.5); border-radius: 4px; overflow: hidden; margin-top: 4px; }
  .weight-fill { height: 100%; }
  .weight-attack { background: #ff4444; }
  .weight-defense { background: #44aaff; }
  .weight-mobility { background: #44ff44; }
  .weight-economy { background: #ffaa00; }

  /* Leaderboard */
  .lb-row { padding: 10px 16px; border-bottom: 1px solid #00ff4422; font-size: 13px;
            display: flex; justify-content: space-between; }
  .lb-rank { width: 30px; font-weight: bold; }
  .lb-rank-1 { color: #ffcc00; }
  .lb-rank-2 { color: #cccccc; }
  .lb-rank-3 { color: #cc8844; }
  .lb-name { flex: 1; }
  .lb-rating { color: #00d4ff; }
  .lb-wl { color: #888; font-size: 11px; }
</style></head>
<body>
<div class="container">
  <!-- Top HUD -->
  <div class="hud">
    <div class="hud-title">🤖 AI 傀儡竞技场 — TOKEN WARS</div>
    <div class="hud-info">玩家: NEON-7  |  Token: 3,247  |  当前赛季: 超频赛季</div>
  </div>

  <!-- Left: Agent list -->
  <div class="panel left-panel">
    <div class="panel-header">我的代理 (3/5)</div>
    <div class="agent-item selected">
      <div class="agent-name">⚡ VOLT-X1</div>
      <div class="agent-info"><span class="stars">★★★</span>  评级: 1247  <span class="deployed">[已部署]</span></div>
    </div>
    <div class="agent-item">
      <div class="agent-name">🛡️ AEGIS-Prime</div>
      <div class="agent-info"><span class="stars">★★☆</span>  评级: 1089</div>
    </div>
    <div class="agent-item">
      <div class="agent-name">⚡ STORM-Δ</div>
      <div class="agent-info"><span class="stars">★★☆</span>  评级: 1034</div>
    </div>
    <div class="agent-item">
      <div class="agent-name">🌟 NOVA-Alpha</div>
      <div class="agent-info"><span class="stars">★☆☆</span>  评级: 892</div>
    </div>
    <div class="agent-item" style="color: #444;">
      <div class="agent-name">+ 新建代理</div>
    </div>
  </div>

  <!-- Center: Detail panel -->
  <div class="panel center-panel">
    <div class="panel-header">代理详情 — VOLT-X1</div>

    <div class="detail-section">
      <div class="detail-title">基础信息</div>
      <div class="stat-row"><span class="stat-label">代理名称</span><span class="stat-value">VOLT-X1</span></div>
      <div class="stat-row"><span class="stat-label">星 级</span><span class="stat-value" style="color:#ffaa00;">★★★</span></div>
      <div class="stat-row"><span class="stat-label">AELO 评级</span><span class="stat-value">1247</span></div>
      <div class="stat-row"><span class="stat-label">特殊行为</span><span class="stat-value" style="color:#ff006e;">狂暴战士 (HP&lt;30% 攻击翻倍)</span></div>
    </div>

    <div class="detail-section">
      <div class="detail-title">Token 磁盘配置 (6/8)</div>
      <div class="disk-grid">
        <div class="token-disk disk-rarity-epic">EPIC<br>ATK</div>
        <div class="token-disk disk-rarity-rare">RARE<br>ATK</div>
        <div class="token-disk disk-rarity-rare">RARE<br>DEF</div>
        <div class="token-disk disk-rarity-uncommon">UNCOM<br>MOB</div>
        <div class="token-disk disk-rarity-uncommon">UNCOM<br>ECO</div>
        <div class="token-disk disk-rarity-common">COM<br>ATK</div>
        <div class="token-disk disk-empty">+</div>
        <div class="token-disk disk-empty">+</div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-title">行为权重分布</div>
      <div class="weight-row">
        <div class="weight-label"><span>⚔️ 攻击</span><span>42%</span></div>
        <div class="weight-bar"><div class="weight-fill weight-attack" style="width:42%"></div></div>
      </div>
      <div class="weight-row">
        <div class="weight-label"><span>🛡️ 防御</span><span>28%</span></div>
        <div class="weight-bar"><div class="weight-fill weight-defense" style="width:28%"></div></div>
      </div>
      <div class="weight-row">
        <div class="weight-label"><span>💨 机动</span><span>18%</span></div>
        <div class="weight-bar"><div class="weight-fill weight-mobility" style="width:18%"></div></div>
      </div>
      <div class="weight-row">
        <div class="weight-label"><span>💰 经济</span><span>12%</span></div>
        <div class="weight-bar"><div class="weight-fill weight-economy" style="width:12%"></div></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-title">对战记录</div>
      <div class="stat-row"><span class="stat-label">胜 / 负 / 平</span><span class="stat-value">87 / 23 / 4</span></div>
      <div class="stat-row"><span class="stat-label">胜率</span><span class="stat-value">76.5%</span></div>
      <div class="stat-row"><span class="stat-label">连胜</span><span class="stat-value" style="color:#ffaa00;">+5</span></div>
    </div>
  </div>

  <!-- Right: Leaderboard -->
  <div class="panel right-panel">
    <div class="panel-header">🏆 全球排行榜</div>
    <div class="lb-row">
      <span class="lb-rank lb-rank-1">1.</span>
      <span class="lb-name">⚡ VOLT-X1</span>
      <span class="lb-rating">1247</span>
    </div>
    <div class="lb-row">
      <span class="lb-rank lb-rank-1">1.</span>
      <span class="lb-name">🌟 NOVA-Beast</span>
      <span class="lb-rating">1247</span>
    </div>
    <div class="lb-row">
      <span class="lb-rank lb-rank-2">2.</span>
      <span class="lb-name">⚡ FUSION-A</span>
      <span class="lb-rating">1203</span>
    </div>
    <div class="lb-row">
      <span class="lb-rank lb-rank-3">3.</span>
      <span class="lb-name">🛡️ AEGIS-Prime</span>
      <span class="lb-rating">1189</span>
    </div>
    <div class="lb-row">
      <span class="lb-rank">4.</span>
      <span class="lb-name">⚡ CYBER-Δ</span>
      <span class="lb-rating">1156</span>
    </div>
    <div class="lb-row">
      <span class="lb-rank">5.</span>
      <span class="lb-name">🌟 PHANTOM-7</span>
      <span class="lb-rating">1134</span>
    </div>
    <div class="lb-row">
      <span class="lb-rank">6.</span>
      <span class="lb-name">⚡ STORM-Δ</span>
      <span class="lb-rating">1034</span>
    </div>
    <div class="lb-row">
      <span class="lb-rank">7.</span>
      <span class="lb-name">🛡️ GUARDIAN-X</span>
      <span class="lb-rating">987</span>
    </div>
    <div class="lb-row">
      <span class="lb-rank">8.</span>
      <span class="lb-name">🌟 NOVA-Alpha</span>
      <span class="lb-rating">892</span>
    </div>

    <div class="panel-header" style="margin-top: 16px;">📅 当前赛季</div>
    <div style="padding: 16px;">
      <div class="stat-row"><span class="stat-label">赛季 Buff</span><span class="stat-value" style="color:#ff006e;">超频 (攻击+20%)</span></div>
      <div class="stat-row"><span class="stat-label">剩余时间</span><span class="stat-value">3天 14h</span></div>
      <div class="stat-row"><span class="stat-label">今日对局</span><span class="stat-value">8 / 10</span></div>
    </div>
  </div>
</div>
</body></html>`;
}

/**
 * Combat action screenshot — Multiple players, projectile trails, explosions
 */
function getCombatActionScreenshotHTML() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; overflow: hidden;
         background: #0a0a1a; font-family: 'Courier New', monospace; color: #00ff88; }
  .game-canvas { position: relative; width: 100%; height: 100%; }

  /* Grid pattern */
  .grid-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                  background-image:
                    linear-gradient(0deg, rgba(0,255,68,0.05) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,255,68,0.05) 1px, transparent 1px);
                  background-size: 50px 50px; }

  /* HUD */
  .top-hud { position: absolute; top: 0; left: 0; right: 0; height: 50px;
             background: rgba(0, 20, 10, 0.7); border-bottom: 1px solid #00ff44;
             display: flex; align-items: center; padding: 0 20px; font-size: 14px; }
  .hp-bar { background: rgba(255,255,255,0.1); border: 1px solid #00ff88; height: 18px; width: 200px; margin: 0 8px; position: relative; }
  .hp-fill { background: linear-gradient(90deg, #00ff88, #00d4ff); height: 100%; width: 78%; }
  .hp-text { position: absolute; top: 0; left: 0; right: 0; text-align: center; line-height: 18px; font-size: 12px; color: #fff; }
  .tokens { color: #ffaa00; font-size: 18px; margin-left: 20px; }
  .timer { color: #00d4ff; font-size: 18px; margin-left: auto; }
  .player-count { color: #ff006e; margin-left: 20px; }

  /* Minimap */
  .minimap { position: absolute; bottom: 16px; right: 16px; width: 200px; height: 200px;
             background: rgba(0,0,0,0.7); border: 1px solid #00ff88; }

  /* Skill bar */
  .skill-bar { position: absolute; bottom: 16px; left: 16px;
               background: rgba(0,0,0,0.7); border: 1px solid #00ff88; padding: 8px 12px; }

  /* Players */
  .player { position: absolute; transform: translate(-50%, -50%); text-align: center; }
  .player-body { width: 0; height: 0; border-left: 18px solid transparent; border-right: 18px solid transparent;
                 border-bottom: 32px solid; margin: 0 auto; }
  .player-name { font-size: 12px; margin-top: 4px; text-shadow: 0 0 4px black; }
  .player-hp { font-size: 10px; color: #00ff88; }

  /* Projectile */
  .projectile { position: absolute; height: 2px; transform-origin: 0 50%;
                background: linear-gradient(90deg, transparent, #ffcc00, #ffffff); }

  /* Explosion */
  .explosion { position: absolute; width: 60px; height: 60px; border-radius: 50%;
               background: radial-gradient(circle, #ffffff 0%, #ffcc00 30%, transparent 70%);
               transform: translate(-50%, -50%); }

  /* Chat bubble */
  .chat { position: absolute; background: rgba(0,0,0,0.7); border: 1px solid #00ff88;
          padding: 4px 8px; font-size: 12px; color: #fff; max-width: 200px; }

  /* Score panel */
  .score-panel { position: absolute; top: 60px; left: 16px; background: rgba(0,0,0,0.8);
                 border: 1px solid #00d4ff; padding: 12px; font-size: 13px; min-width: 250px; }
  .kill-feed { position: absolute; top: 60px; right: 16px; background: rgba(0,0,0,0.8);
               border: 1px solid #ff006e; padding: 12px; font-size: 12px; min-width: 280px; }
  .kill-entry { padding: 4px 0; border-bottom: 1px solid #ff006e22; }
</style></head>
<body>
<div class="game-canvas">
  <div class="grid-overlay"></div>

  <!-- Top HUD -->
  <div class="top-hud">
    <span>// ROOM: ARENA_RANKED_07</span>
    <span style="margin-left: 24px;">HP</span>
    <div class="hp-bar"><div class="hp-fill"></div><div class="hp-text">78/100</div></div>
    <span class="tokens">⚡ 347</span>
    <span class="player-count">👥 5/8</span>
    <span class="timer">⏱ 03:42</span>
  </div>

  <!-- Players (color triangles) -->
  <div class="player" style="left: 720px; top: 540px;">
    <div class="player-body" style="border-bottom-color: #00ff88;"></div>
    <div class="player-hp" style="color: #00ff88;">78 HP</div>
    <div class="player-name" style="color: #00ff88;">NEON-7 (你)</div>
  </div>

  <div class="player" style="left: 1180px; top: 380px; transform: translate(-50%, -50%) rotate(45deg);">
    <div class="player-body" style="border-bottom-color: #ff4488;"></div>
    <div class="player-hp" style="color: #ff4488;">45 HP</div>
    <div class="player-name" style="color: #ff4488;">PHANTOM-7</div>
  </div>

  <div class="player" style="left: 1380px; top: 620px; transform: translate(-50%, -50%) rotate(-30deg);">
    <div class="player-body" style="border-bottom-color: #44aaff;"></div>
    <div class="player-hp" style="color: #44aaff;">92 HP</div>
    <div class="player-name" style="color: #44aaff;">CYBER-Δ</div>
  </div>

  <div class="player" style="left: 920px; top: 760px; transform: translate(-50%, -50%) rotate(15deg);">
    <div class="player-body" style="border-bottom-color: #ffaa00;"></div>
    <div class="player-hp" style="color: #ffaa00;">23 HP</div>
    <div class="player-name" style="color: #ffaa00;">STORM-Δ</div>
  </div>

  <div class="player" style="left: 520px; top: 320px; transform: translate(-50%, -50%) rotate(-60deg);">
    <div class="player-body" style="border-bottom-color: #cc44ff;"></div>
    <div class="player-hp" style="color: #cc44ff;">61 HP</div>
    <div class="player-name" style="color: #cc44ff;">NOVA-X</div>
  </div>

  <!-- Projectile trails (with -45deg angle) -->
  <div class="projectile" style="left: 740px; top: 540px; width: 240px; transform: rotate(-30deg);"></div>
  <div class="projectile" style="left: 1180px; top: 380px; width: 180px; transform: rotate(120deg);"></div>
  <div class="projectile" style="left: 1380px; top: 620px; width: 160px; transform: rotate(-145deg);"></div>

  <!-- Explosion / hit flash -->
  <div class="explosion" style="left: 980px; top: 480px;"></div>
  <div class="explosion" style="left: 1300px; top: 540px; width: 40px; height: 40px;"></div>

  <!-- Mining nodes -->
  <div style="position: absolute; left: 280px; top: 240px; width: 30px; height: 30px;
              background: #00d4ff; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
              transform: translate(-50%, -50%); box-shadow: 0 0 20px #00d4ff;"></div>
  <div style="position: absolute; left: 1620px; top: 800px; width: 30px; height: 30px;
              background: #00d4ff; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
              transform: translate(-50%, -50%); box-shadow: 0 0 20px #00d4ff;"></div>

  <!-- Chat bubble -->
  <div class="chat" style="left: 720px; top: 480px;">🔥 抢我 buff？</div>
  <div class="chat" style="left: 1180px; top: 320px;">来啊！</div>

  <!-- Score panel -->
  <div class="score-panel">
    <div style="color: #00d4ff; font-weight: bold; margin-bottom: 8px;">[SCOREBOARD]</div>
    <div style="display: flex; justify-content: space-between; padding: 3px 0;">
      <span style="color: #00ff88;">NEON-7</span>
      <span>12 K / 3 D / 78%</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 3px 0;">
      <span style="color: #ff4488;">PHANTOM-7</span>
      <span>9 K / 5 D / 64%</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 3px 0;">
      <span style="color: #44aaff;">CYBER-Δ</span>
      <span>8 K / 4 D / 67%</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 3px 0;">
      <span style="color: #ffaa00;">STORM-Δ</span>
      <span>5 K / 9 D / 36%</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 3px 0;">
      <span style="color: #cc44ff;">NOVA-X</span>
      <span>7 K / 6 D / 54%</span>
    </div>
  </div>

  <!-- Kill feed -->
  <div class="kill-feed">
    <div style="color: #ff006e; font-weight: bold; margin-bottom: 8px;">[KILL FEED]</div>
    <div class="kill-entry"><span style="color: #00ff88;">NEON-7</span> ⚔ <span style="color: #ff4488;">PHANTOM-7</span></div>
    <div class="kill-entry"><span style="color: #44aaff;">CYBER-Δ</span> 🏹 <span style="color: #ffaa00;">STORM-Δ</span></div>
    <div class="kill-entry"><span style="color: #00ff88;">NEON-7</span> ⚔ <span style="color: #cc44ff;">NOVA-X</span></div>
    <div class="kill-entry"><span style="color: #ff4488;">PHANTOM-7</span> 🏹 <span style="color: #44aaff;">CYBER-Δ</span></div>
    <div class="kill-entry"><span style="color: #00ff88;">NEON-7</span> ⚔ <span style="color: #ffaa00;">STORM-Δ</span></div>
  </div>

  <!-- Minimap -->
  <div class="minimap">
    <svg width="200" height="200" viewBox="0 0 200 200">
      <rect width="200" height="200" fill="rgba(0,0,0,0.3)"/>
      <line x1="0" y1="100" x2="200" y2="100" stroke="#00ff44" opacity="0.3"/>
      <line x1="100" y1="0" x2="100" y2="200" stroke="#00ff44" opacity="0.3"/>
      <circle cx="80" cy="100" r="4" fill="#00ff88"/>
      <circle cx="130" cy="70" r="3" fill="#ff4488"/>
      <circle cx="150" cy="120" r="3" fill="#44aaff"/>
      <circle cx="100" cy="150" r="3" fill="#ffaa00"/>
      <circle cx="55" cy="60" r="3" fill="#cc44ff"/>
    </svg>
  </div>

  <!-- Skill bar -->
  <div class="skill-bar">
    <div style="font-size: 12px; color: #888; margin-bottom: 4px;">SKILLS</div>
    <div style="display: flex; gap: 8px; font-size: 13px;">
      <span style="color: #00ff88; padding: 2px 8px; border: 1px solid #00ff88;">⚔ J</span>
      <span style="color: #00ff88; padding: 2px 8px; border: 1px solid #00ff88;">🏹 K</span>
      <span style="color: #00ff88; padding: 2px 8px; border: 1px solid #00ff88;">💨 Space</span>
      <span style="color: #00ff88; padding: 2px 8px; border: 1px solid #00ff88;">💊 E</span>
    </div>
  </div>
</div>
</body></html>`;
}

/**
 * Token Collection screenshot — Show token economy + collection + inventory
 */
function getTokenCollectionScreenshotHTML() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; overflow: hidden;
         background: #0a0a12; font-family: 'Courier New', monospace; color: #00ff88; }

  .header { background: rgba(0, 20, 10, 0.9); border-bottom: 1px solid #00ff88;
            padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
  .header-title { font-size: 24px; font-weight: bold; }
  .header-balance { font-size: 18px; color: #ffaa00; }

  .container { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;
               padding: 16px; height: calc(100% - 70px); }

  .panel { background: rgba(10, 20, 15, 0.7); border: 1px solid #00ff4455; padding: 20px; }
  .panel-title { font-size: 20px; color: #00d4ff; font-weight: bold; margin-bottom: 16px;
                 padding-bottom: 8px; border-bottom: 1px solid #00ff4422; }

  /* Token grid */
  .token-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .token { aspect-ratio: 1; border-radius: 8px; display: flex; flex-direction: column;
           align-items: center; justify-content: center; font-size: 12px; text-align: center;
           background: rgba(0,0,0,0.6); padding: 6px; }
  .token-rarity-common { border: 2px solid #888; }
  .token-rarity-uncommon { border: 2px solid #00d4ff; box-shadow: 0 0 8px #00d4ff44; }
  .token-rarity-rare { border: 2px solid #ffaa00; box-shadow: 0 0 12px #ffaa0066; }
  .token-rarity-epic { border: 2px solid #ff006e; box-shadow: 0 0 16px #ff006e88; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { box-shadow: 0 0 16px #ff006e88; } 50% { box-shadow: 0 0 24px #ff006ecc; } }
  .token-icon { font-size: 20px; margin-bottom: 4px; }
  .token-name { font-size: 10px; }
  .token-value { color: #ffaa00; font-size: 11px; font-weight: bold; }

  /* Inventory */
  .inv-slot { width: 100%; aspect-ratio: 1; background: rgba(0,0,0,0.5);
              border: 1px solid #00ff44; display: flex; flex-direction: column;
              align-items: center; justify-content: center; font-size: 11px; }
  .inv-empty { border-color: #333; color: #555; }
  .inv-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }

  /* Stats */
  .stat-row { display: flex; justify-content: space-between; padding: 8px 0;
              border-bottom: 1px solid #00ff4422; font-size: 14px; }
  .stat-label { color: #888; }
  .stat-value { color: #00ff88; font-weight: bold; }
</style></head>
<body>
<div class="header">
  <div class="header-title">⚡ Token 仓库 — 算力征途</div>
  <div class="header-balance">💎 算力余额: 3,247  |  排名: #23</div>
</div>

<div class="container">
  <!-- Token Collection -->
  <div class="panel">
    <div class="panel-title">📦 Token 收藏 (24/50)</div>
    <div class="token-grid">
      <div class="token token-rarity-epic"><div class="token-icon">⚔️</div><div class="token-name">EPIC ATK</div><div class="token-value">+40</div></div>
      <div class="token token-rarity-epic"><div class="token-icon">🛡️</div><div class="token-name">EPIC DEF</div><div class="token-value">+38</div></div>
      <div class="token token-rarity-rare"><div class="token-icon">⚔️</div><div class="token-name">RARE ATK</div><div class="token-value">+25</div></div>
      <div class="token token-rarity-rare"><div class="token-icon">🛡️</div><div class="token-name">RARE DEF</div><div class="token-value">+24</div></div>
      <div class="token token-rarity-rare"><div class="token-icon">💨</div><div class="token-name">RARE MOB</div><div class="token-value">+22</div></div>
      <div class="token token-rarity-rare"><div class="token-icon">💎</div><div class="token-name">RARE ECO</div><div class="token-value">+26</div></div>

      <div class="token token-rarity-uncommon"><div class="token-icon">⚔️</div><div class="token-name">UNC ATK</div><div class="token-value">+15</div></div>
      <div class="token token-rarity-uncommon"><div class="token-icon">🛡️</div><div class="token-name">UNC DEF</div><div class="token-value">+14</div></div>
      <div class="token token-rarity-uncommon"><div class="token-icon">💨</div><div class="token-name">UNC MOB</div><div class="token-value">+13</div></div>
      <div class="token token-rarity-uncommon"><div class="token-icon">💎</div><div class="token-name">UNC ECO</div><div class="token-value">+16</div></div>
      <div class="token token-rarity-common"><div class="token-icon">⚔️</div><div class="token-name">COM ATK</div><div class="token-value">+8</div></div>
      <div class="token token-rarity-common"><div class="token-icon">🛡️</div><div class="token-name">COM DEF</div><div class="token-value">+7</div></div>

      <div class="token token-rarity-common"><div class="token-icon">💨</div><div class="token-name">COM MOB</div><div class="token-value">+6</div></div>
      <div class="token token-rarity-common"><div class="token-icon">💎</div><div class="token-name">COM ECO</div><div class="token-value">+9</div></div>
      <div class="token token-rarity-common"><div class="token-icon">⚔️</div><div class="token-name">COM ATK</div><div class="token-value">+5</div></div>
      <div class="token token-rarity-common"><div class="token-icon">🛡️</div><div class="token-name">COM DEF</div><div class="token-value">+8</div></div>
      <div class="token token-rarity-uncommon"><div class="token-icon">💨</div><div class="token-name">UNC MOB</div><div class="token-value">+11</div></div>
      <div class="token token-rarity-uncommon"><div class="token-icon">💎</div><div class="token-name">UNC ECO</div><div class="token-value">+12</div></div>

      <div class="token token-rarity-rare"><div class="token-icon">⚔️</div><div class="token-name">RARE ATK</div><div class="token-value">+22</div></div>
      <div class="token token-rarity-rare"><div class="token-icon">🛡️</div><div class="token-name">RARE DEF</div><div class="token-value">+21</div></div>
      <div class="token token-rarity-uncommon"><div class="token-icon">⚔️</div><div class="token-name">UNC ATK</div><div class="token-value">+14</div></div>
      <div class="token token-rarity-common"><div class="token-icon">💎</div><div class="token-name">COM ECO</div><div class="token-value">+7</div></div>
      <div class="token token-rarity-common"><div class="token-icon">🛡️</div><div class="token-name">COM DEF</div><div class="token-value">+6</div></div>
      <div class="token token-rarity-uncommon"><div class="token-icon">💨</div><div class="token-name">UNC MOB</div><div class="token-value">+15</div></div>
    </div>
  </div>

  <!-- Inventory -->
  <div class="panel">
    <div class="panel-title">🎒 装备栏 (8/20)</div>
    <div class="inv-grid">
      <div class="inv-slot"><div style="font-size:24px">❤️</div><div>生命药水</div></div>
      <div class="inv-slot"><div style="font-size:24px">💨</div><div>速度提升</div></div>
      <div class="inv-slot"><div style="font-size:24px">🛡️</div><div>护盾</div></div>
      <div class="inv-slot"><div style="font-size:24px">⚡</div><div>伤害增幅</div></div>

      <div class="inv-slot"><div style="font-size:24px">❤️</div><div>生命药水</div></div>
      <div class="inv-slot"><div style="font-size:24px">❤️</div><div>生命药水</div></div>
      <div class="inv-slot"><div style="font-size:24px">💨</div><div>速度提升</div></div>
      <div class="inv-slot inv-empty">+</div>

      <div class="inv-slot inv-empty">+</div>
      <div class="inv-slot inv-empty">+</div>
      <div class="inv-slot inv-empty">+</div>
      <div class="inv-slot inv-empty">+</div>

      <div class="inv-slot inv-empty">+</div>
      <div class="inv-slot inv-empty">+</div>
      <div class="inv-slot inv-empty">+</div>
      <div class="inv-slot inv-empty">+</div>
    </div>

    <div style="margin-top: 24px;">
      <div class="panel-title" style="font-size: 16px;">📊 角色属性</div>
      <div class="stat-row"><span class="stat-label">⚔️ 攻击</span><span class="stat-value">+127 (EPIC + RARE×3)</span></div>
      <div class="stat-row"><span class="stat-label">🛡️ 防御</span><span class="stat-value">+114 (RARE×2 + UNCOM)</span></div>
      <div class="stat-row"><span class="stat-label">💨 移动</span><span class="stat-value">+97 (RARE + UNCOM×3)</span></div>
      <div class="stat-row"><span class="stat-label">💎 经济</span><span class="stat-value">+108 (RARE + UNCOM×2)</span></div>
      <div class="stat-row"><span class="stat-label">❤️ 生命</span><span class="stat-value">+15 (稀有强化)</span></div>
    </div>
  </div>

  <!-- Statistics -->
  <div class="panel">
    <div class="panel-title">📈 经济与战绩</div>

    <div class="stat-row"><span class="stat-label">⚡ 算力收益 (今日)</span><span class="stat-value">+347</span></div>
    <div class="stat-row"><span class="stat-label">⚡ 算力支出 (今日)</span><span class="stat-value">-189</span></div>
    <div class="stat-row"><span class="stat-label">⚡ 净增长</span><span class="stat-value" style="color:#00ff44;">+158</span></div>

    <div style="margin-top: 20px;">
      <div class="panel-title" style="font-size: 16px;">📅 赛季统计</div>
      <div class="stat-row"><span class="stat-label">对战总数</span><span class="stat-value">114</span></div>
      <div class="stat-row"><span class="stat-label">胜 / 负 / 平</span><span class="stat-value">87 / 23 / 4</span></div>
      <div class="stat-row"><span class="stat-label">胜率</span><span class="stat-value">76.5%</span></div>
      <div class="stat-row"><span class="stat-label">最高连杀</span><span class="stat-value" style="color:#ffaa00;">+8</span></div>
      <div class="stat-row"><span class="stat-label">累计 Token 收益</span><span class="stat-value">12,847</span></div>
    </div>

    <div style="margin-top: 20px;">
      <div class="panel-title" style="font-size: 16px;">🎁 每日奖励</div>
      <div style="background: rgba(0, 80, 30, 0.4); border: 1px solid #00ff88;
                  padding: 16px; border-radius: 8px; text-align: center;">
        <div style="font-size: 16px; color: #00d4ff; margin-bottom: 8px;">下次可领取: 02:14:38</div>
        <div class="token token-rarity-rare" style="width: 80px; height: 80px; margin: 0 auto; display: flex; align-items: center; justify-content: center; flex-direction: column;">
          <div style="font-size: 24px;">🛡️</div>
          <div style="font-size: 10px;">RARE DEF</div>
          <div style="font-size: 10px; color: #ffaa00;">+24</div>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;
}

// Helper
function hexPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${Math.round(cx + size * Math.cos(a))},${Math.round(cy + size * Math.sin(a))}`);
  }
  return pts.join(' ');
}

/**
 * Steam Store Page Background (1438x2300) — Optional but recommended
 */
function getPageBackgroundHTML() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; }
  body { width: 1438px; height: 2300px; overflow: hidden;
         background: #050508; font-family: 'Courier New', monospace; }
</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="1438" height="2300" viewBox="0 0 1438 2300">
  <defs>
    <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b1"/>
      <feGaussianBlur stdDeviation="10" result="b2"/>
      <feMerge><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0a0f"/>
      <stop offset="30%" stop-color="#0f1530"/>
      <stop offset="70%" stop-color="#150a30"/>
      <stop offset="100%" stop-color="#0a0a0f"/>
    </linearGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="80%">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.4"/>
    </radialGradient>
  </defs>

  <rect width="1438" height="2300" fill="url(#bgGrad)"/>

  <!-- Grid -->
  ${Array.from({length: 24}, (_, i) => `<line x1="${i*60}" y1="0" x2="${i*60}" y2="2300" stroke="#1a1a3e" opacity="0.2"/>`).join('')}
  ${Array.from({length: 39}, (_, i) => `<line x1="0" y1="${i*60}" x2="1438" y2="${i*60}" stroke="#1a1a3e" opacity="0.2"/>`).join('')}

  <!-- Scanlines -->
  ${Array.from({length: 575}, (_, i) => `<line x1="0" y1="${i*4}" x2="1437" y2="${i*4+1}" stroke="#ffffff" opacity="0.012"/>`).join('')}

  <!-- Floating hexagons (decorative) -->
  ${Array.from({length: 18}, (_, i) => {
    const x = (i * 87) % 1438;
    const y = ((i * 137) % 2100) + 100;
    const size = 20 + (i % 4) * 8;
    const colors = ['#00ff88', '#00d4ff', '#ff006e', '#ffaa00'];
    const c = colors[i % 4];
    return `<polygon points="${hexPoints(x, y, size)}" fill="${c}" opacity="0.08" stroke="${c}" stroke-width="1"/>`;
  }).join('')}

  <!-- Top hero section -->
  <g transform="translate(719, 350)">
    <text text-anchor="middle" fill="#00ff88" font-size="160" font-weight="bold"
          font-family="monospace" filter="url(#neonGlow)" letter-spacing="14">TOKEN WARS</text>
    <text y="90" text-anchor="middle" fill="#00d4ff" font-size="64" font-family="monospace" letter-spacing="20">算 力 征 途</text>
    <text y="170" text-anchor="middle" fill="#ffaa00" font-size="32" font-family="monospace" opacity="0.8">CYBERPUNK EDITION // 算力即力量</text>
  </g>

  <!-- Feature blocks -->
  ${[
    {y: 720, title: '⚔️ 实时 PvP 战斗', desc: 'WASD 操作 + 技能按键 + 闪避冲刺\n在赛博竞技场与全球玩家对决'},
    {y: 1080, title: '🤖 AI 代理养成', desc: '装配 Token 磁盘 + 8 级决策树 AI\n在异步竞技场争夺 AELO 排名'},
    {y: 1440, title: '🏆 赛季与锦标赛', desc: '7 天循环赛季 + 3 种 Buff\nTop 16 单败淘汰巅峰赛'},
    {y: 1800, title: '💎 Token 经济系统', desc: '4 类别 × 4 稀有度 = 16 种 Token\n挖矿、对战、奖励多渠道来源'}
  ].map(f => `
    <g transform="translate(160, ${f.y})">
      <rect x="0" y="0" width="1118" height="280" fill="#0a1a12" fill-opacity="0.6" stroke="#00ff88" stroke-width="1" stroke-opacity="0.4" rx="12"/>
      <text x="40" y="80" fill="#00ff88" font-size="56" font-family="monospace" font-weight="bold" filter="url(#neonGlow)">${f.title}</text>
      <text x="40" y="160" fill="#00d4ff" font-size="32" font-family="monospace" opacity="0.85">${f.desc.split('\n')[0]}</text>
      <text x="40" y="210" fill="#00d4ff" font-size="32" font-family="monospace" opacity="0.85">${f.desc.split('\n')[1] || ''}</text>
    </g>
  `).join('')}

  <!-- Bottom tagline -->
  <text x="719" y="2200" text-anchor="middle" fill="#ff006e" font-size="40" font-family="monospace" opacity="0.7" filter="url(#neonGlow)">[ TOKEN WARS :: COMPUTE IS POWER ]</text>
  <text x="719" y="2250" text-anchor="middle" fill="#00d4ff" font-size="20" font-family="monospace" opacity="0.4">v0.3.0 // AVAILABLE NOW // STEAM</text>

  <rect width="1438" height="2300" fill="url(#vignette)" pointer-events="none"/>
</svg>
</body></html>`;
}

async function renderHTML(browser, html, w, h, filename) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
  const filepath = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: filepath, type: 'png' });
  await page.close();
  console.log(`  [OK] ${filename} (${w}x${h})`);
}

async function main() {
  console.log('\n[Token Wars] Generating missing Steam assets...\n');

  // Ensure output dir
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // 1. Library Hero Capsule
    await renderHTML(browser, getLibraryHeroHTML(), 3840, 1240, 'library-hero-capsule.png');

    // 2. Vertical Capsule
    await renderHTML(browser, getVerticalCapsuleHTML(), 748, 896, 'vertical-capsule.png');

    // 3. AI Arena Screenshot
    await renderHTML(browser, getAIArenaScreenshotHTML(), 1920, 1080, 'screenshot-ai-arena.png');

    // 4. Combat Action Screenshot
    await renderHTML(browser, getCombatActionScreenshotHTML(), 1920, 1080, 'screenshot-combat-action.png');

    // 5. Token Collection Screenshot
    await renderHTML(browser, getTokenCollectionScreenshotHTML(), 1920, 1080, 'screenshot-tokens.png');

    // 6. Store page background (optional, recommended)
    await renderHTML(browser, getPageBackgroundHTML(), 1438, 2300, 'page-background.png');

    console.log('\n[Token Wars] All missing assets generated!\n');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
