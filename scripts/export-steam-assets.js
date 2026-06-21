/**
 * export-steam-assets.js
 * Token Wars: 算力征途 — Steam Asset Exporter
 *
 * Uses Puppeteer to render capsule artwork and concept screenshots
 * at Steam-required dimensions. Outputs to dist/screenshots/.
 *
 * Usage: node scripts/export-steam-assets.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Output directory
const OUTPUT_DIR = path.join(__dirname, '..', 'dist', 'screenshots');

// =============================================================================
// SVG Templates
// =============================================================================

/**
 * Generate inline SVG for capsule art.
 * All capsules share the same cyberpunk neon aesthetic.
 *
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {boolean} simplified - If true, render a simpler design for small sizes
 * @returns {string} SVG markup
 */
function generateCapsuleSVG(width, height, simplified = false) {
  const titleSize = Math.round(Math.min(width, height) * (simplified ? 0.18 : 0.12));
  const subtitleSize = Math.round(titleSize * 0.35);
  const gridSize = simplified ? 30 : 40;

  // Build grid lines
  let gridLines = '';
  for (let x = 0; x <= width; x += gridSize) {
    gridLines += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#1a1a3e" stroke-width="1" opacity="0.3"/>`;
  }
  for (let y = 0; y <= height; y += gridSize) {
    gridLines += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#1a1a3e" stroke-width="1" opacity="0.3"/>`;
  }

  // Glow filter
  const filterDef = `
    <defs>
      <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur1"/>
        <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur2"/>
        <feMerge>
          <feMergeNode in="blur2"/>
          <feMergeNode in="blur1"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="cyanGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur1"/>
        <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur2"/>
        <feMerge>
          <feMergeNode in="blur2"/>
          <feMergeNode in="blur1"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="pinkGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur1"/>
        <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur2"/>
        <feMerge>
          <feMergeNode in="blur2"/>
          <feMergeNode in="blur1"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0a0a0f"/>
        <stop offset="50%" stop-color="#0f0f1a"/>
        <stop offset="100%" stop-color="#0a0a0f"/>
      </linearGradient>
      <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#00ff88"/>
        <stop offset="50%" stop-color="#00d4ff"/>
        <stop offset="100%" stop-color="#00ff88"/>
      </linearGradient>
    </defs>
  `;

  // Decorative elements
  const cornerSize = Math.round(Math.min(width, height) * 0.06);
  const corners = simplified ? '' : `
    <!-- Top-left corner bracket -->
    <path d="M${cornerSize + 20} 20 L20 20 L20 ${cornerSize + 20}" stroke="#00ff88" stroke-width="2" fill="none" opacity="0.6"/>
    <!-- Top-right corner bracket -->
    <path d="M${width - cornerSize - 20} 20 L${width - 20} 20 L${width - 20} ${cornerSize + 20}" stroke="#00ff88" stroke-width="2" fill="none" opacity="0.6"/>
    <!-- Bottom-left corner bracket -->
    <path d="M${cornerSize + 20} ${height - 20} L20 ${height - 20} L20 ${height - cornerSize - 20}" stroke="#00ff88" stroke-width="2" fill="none" opacity="0.6"/>
    <!-- Bottom-right corner bracket -->
    <path d="M${width - cornerSize - 20} ${height - 20} L${width - 20} ${height - 20} L${width - 20} ${height - cornerSize - 20}" stroke="#00ff88" stroke-width="2" fill="none" opacity="0.6"/>
  `;

  // Decorative circuit lines
  const circuitLines = simplified ? '' : `
    <path d="M${width * 0.75} 0 L${width * 0.75} ${height * 0.15} L${width * 0.85} ${height * 0.15}" stroke="#ff006e" stroke-width="1" fill="none" opacity="0.3"/>
    <circle cx="${width * 0.85}" cy="${height * 0.15}" r="3" fill="#ff006e" opacity="0.4"/>
    <path d="M${width * 0.1} ${height} L${width * 0.1} ${height * 0.85} L${width * 0.2} ${height * 0.85}" stroke="#00d4ff" stroke-width="1" fill="none" opacity="0.3"/>
    <circle cx="${width * 0.2}" cy="${height * 0.85}" r="3" fill="#00d4ff" opacity="0.4"/>
  `;

  // Subtle scanlines (only for non-simplified)
  const scanlines = simplified ? '' : Array.from({ length: Math.floor(height / 4) }, (_, i) =>
    `<line x1="0" y1="${i * 4}" x2="${width - 1}" y2="${i * 4 + 1}" stroke="#ffffff" stroke-width="1" opacity="0.015"/>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${filterDef}

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>

  <!-- Grid -->
  <g opacity="0.25">${gridLines}</g>

  <!-- Scanlines -->
  <g>${scanlines}</g>

  <!-- Corner brackets -->
  ${corners}

  <!-- Circuit lines -->
  ${circuitLines}

  <!-- Decorative hexagons (token shapes) -->
  ${generateHexagons(width, height, simplified)}

  <!-- Glitch bar decorations -->
  <rect x="${width * 0.15}" y="${Math.round(height * 0.28)}" width="${Math.round(width * 0.7)}" height="2" fill="#00ff88" opacity="0.3"/>
  <rect x="${width * 0.2}" y="${Math.round(height * 0.65)}" width="${Math.round(width * 0.6)}" height="1" fill="#00d4ff" opacity="0.2"/>

  <!-- Main title: "Token Wars" -->
  <text x="${Math.round(width / 2)}" y="${Math.round(height * 0.42)}"
        text-anchor="middle"
        font-family="monospace"
        font-size="${titleSize}"
        font-weight="bold"
        fill="#00ff88"
        filter="url(#neonGlow)"
        letter-spacing="${Math.round(titleSize * 0.08)}">
    TOKEN WARS
  </text>

  <!-- Subtitle only on full design -->
  ${simplified ? '' : `
  <text x="${Math.round(width / 2)}" y="${Math.round(height * 0.55)}"
        text-anchor="middle"
        font-family="monospace"
        font-size="${subtitleSize}"
        fill="#00d4ff"
        filter="url(#cyanGlow)"
        letter-spacing="${Math.round(subtitleSize * 0.2)}">
    算 力 征 途
  </text>`}

  ${simplified ? '' : `
  <!-- Bottom tagline -->
  <text x="${Math.round(width / 2)}" y="${Math.round(height * 0.72)}"
        text-anchor="middle"
        font-family="monospace"
        font-size="${Math.round(subtitleSize * 0.65)}"
        fill="#ffaa00"
        opacity="0.7">
    COMPUTE IS POWER // 算力即力量
  </text>`}

  <!-- Pink accent line bottom -->
  <rect x="${Math.round(width * 0.3)}" y="${Math.round(height * 0.82)}" width="${Math.round(width * 0.4)}" height="2" fill="#ff006e" opacity="0.5" filter="url(#pinkGlow)"/>

  ${simplified ? '' : `
  <!-- Version text -->
  <text x="${width - 20}" y="${height - 12}"
        text-anchor="end"
        font-family="monospace"
        font-size="${Math.round(subtitleSize * 0.5)}"
        fill="#00d4ff"
        opacity="0.5">
    v0.3.0
  </text>`}
</svg>`;
}

/**
 * Generate decorative hexagons representing Tokens
 */
function generateHexagons(width, height, simplified) {
  const count = simplified ? 2 : 5;
  const hexSize = Math.round(Math.min(width, height) * (simplified ? 0.08 : 0.06));
  let svg = '';

  // Fixed positions for hexagons
  const positions = [
    { x: width * 0.08, y: height * 0.15, color: '#ff006e', opacity: 0.15 },
    { x: width * 0.92, y: height * 0.2, color: '#00d4ff', opacity: 0.15 },
    { x: width * 0.12, y: height * 0.78, color: '#00ff88', opacity: 0.12 },
    { x: width * 0.88, y: height * 0.75, color: '#ffaa00', opacity: 0.12 },
    { x: width * 0.05, y: height * 0.47, color: '#ff006e', opacity: 0.08 },
  ];

  for (let i = 0; i < Math.min(count, positions.length); i++) {
    const p = positions[i];
    const points = hexagonPoints(p.x, p.y, hexSize);
    svg += `<polygon points="${points}" stroke="${p.color}" stroke-width="1" fill="${p.color}" opacity="${p.opacity}"/>`;
  }

  return svg;
}

/**
 * Calculate hexagon vertex points
 */
function hexagonPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    pts.push(`${Math.round(x)},${Math.round(y)}`);
  }
  return pts.join(' ');
}

// =============================================================================
// Concept Screenshot HTML Templates
// =============================================================================

/**
 * Generate HTML for a mock combat scene screenshot (1920x1080)
 */
function getCombatScreenshotHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1920px; height: 1080px; overflow: hidden;
      background: #0a0a0f;
      font-family: monospace;
    }
    /* Game layer */
    .game-layer {
      position: absolute; top: 0; left: 0; width: 1920px; height: 1080px;
      background:
        linear-gradient(0deg, rgba(0,0,0,0.3) 0%, rgba(0,15,30,0.5) 100%),
        repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px);
    }
    /* Grid floor */
    .floor-grid {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) perspective(800px) rotateX(60deg);
      width: 1400px; height: 800px;
      background-image:
        linear-gradient(rgba(0, 255, 136, 0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 255, 136, 0.08) 1px, transparent 1px);
      background-size: 60px 60px;
    }
    /* Wall decorations */
    .wall {
      position: absolute; background: rgba(10,10,20,0.9); border: 1px solid rgba(0,255,136,0.15);
    }
    .wall-top { top: 0; left: 0; width: 1920px; height: 350px; }
    .wall-left { top: 0; left: 0; width: 250px; height: 1080px; }
    .wall-right { top: 0; right: 0; width: 250px; height: 1080px; }
    .wall-bottom { bottom: 0; left: 0; width: 1920px; height: 200px; }

    /* Player sprite (center-left) */
    .player {
      position: absolute; left: 600px; top: 520px;
      width: 64px; height: 64px;
    }
    .player-body {
      width: 48px; height: 48px; margin: 8px;
      background: linear-gradient(135deg, #00d4ff, #006080);
      border: 2px solid #00d4ff;
      border-radius: 4px;
      box-shadow: 0 0 20px rgba(0,212,255,0.5), 0 0 40px rgba(0,212,255,0.2);
    }
    .player-name {
      position: absolute; top: -28px; left: 50%; transform: translateX(-50%);
      color: #00d4ff; font-size: 12px; white-space: nowrap;
      text-shadow: 0 0 8px rgba(0,212,255,0.8);
    }
    .player-hp-bar-bg {
      position: absolute; top: -16px; left: -10px; width: 84px; height: 4px;
      background: rgba(0,0,0,0.6); border: 1px solid rgba(0,212,255,0.3);
    }
    .player-hp-bar {
      height: 100%; width: 65%;
      background: linear-gradient(90deg, #00ff88, #00dd66);
    }
    /* Enemy sprite (right side) */
    .enemy {
      position: absolute; left: 1100px; top: 480px;
      width: 64px; height: 64px;
    }
    .enemy-body {
      width: 48px; height: 48px; margin: 8px;
      background: linear-gradient(135deg, #ff006e, #800030);
      border: 2px solid #ff006e;
      border-radius: 4px;
      box-shadow: 0 0 20px rgba(255,0,110,0.5), 0 0 40px rgba(255,0,110,0.2);
    }
    .enemy-hp-bar-bg {
      position: absolute; top: -16px; left: -10px; width: 84px; height: 4px;
      background: rgba(0,0,0,0.6); border: 1px solid rgba(255,0,110,0.3);
    }
    .enemy-hp-bar {
      height: 100%; width: 40%;
      background: linear-gradient(90deg, #ff006e, #cc0055);
    }
    .enemy-name {
      position: absolute; top: -28px; left: 50%; transform: translateX(-50%);
      color: #ff006e; font-size: 12px; white-space: nowrap;
      text-shadow: 0 0 8px rgba(255,0,110,0.8);
    }

    /* Mining node */
    .mining-node {
      position: absolute; left: 1250px; top: 600px;
      width: 48px; height: 48px;
    }
    .node-core {
      width: 36px; height: 36px; margin: 6px;
      background: rgba(255,170,0,0.3);
      border: 2px solid #ffaa00;
      border-radius: 2px;
      box-shadow: 0 0 25px rgba(255,170,0,0.6);
      animation: nodePulse 2s ease-in-out infinite;
    }
    @keyframes nodePulse {
      0%, 100% { box-shadow: 0 0 25px rgba(255,170,0,0.6); }
      50% { box-shadow: 0 0 40px rgba(255,170,0,0.9); }
    }
    .node-label {
      position: absolute; top: -20px; left: 50%; transform: translateX(-50%);
      color: #ffaa00; font-size: 10px; white-space: nowrap;
    }

    /* Projectile */
    .projectile {
      position: absolute; left: 830px; top: 540px;
      width: 8px; height: 4px;
      background: #00ff88;
      box-shadow: 0 0 10px #00ff88, 0 0 20px rgba(0,255,136,0.5);
      border-radius: 2px;
    }

    /* HUD */
    .hud {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 10;
    }
    .hud-bottom {
      display: flex; justify-content: center; align-items: flex-end;
      padding: 0 40px 20px;
      gap: 30px;
    }
    .hud-panel {
      background: rgba(10,10,20,0.85); border: 1px solid rgba(0,255,136,0.3);
      padding: 12px 18px; border-radius: 2px;
    }
    .hud-label { color: #00d4ff; font-size: 10px; text-transform: uppercase; opacity: 0.7; }
    .hud-value { color: #00ff88; font-size: 22px; font-weight: bold; }

    /* Ability bar */
    .ability-bar {
      display: flex; gap: 8px; justify-content: center; padding: 10px;
    }
    .ability-slot {
      width: 52px; height: 52px;
      background: rgba(18,18,26,0.9); border: 2px solid rgba(0,255,136,0.4);
      border-radius: 2px; display: flex; align-items: center; justify-content: center;
      color: #00ff88; font-size: 20px; font-weight: bold;
      box-shadow: 0 0 8px rgba(0,255,136,0.15);
    }
    .ability-slot.cooldown { border-color: rgba(255,0,110,0.4); color: rgba(255,0,110,0.6); }

    /* Top bar */
    .top-bar {
      position: fixed; top: 0; left: 0; right: 0;
      padding: 12px 24px; display: flex; justify-content: space-between;
      background: linear-gradient(180deg, rgba(10,10,20,0.9), transparent);
    }
    .room-name { color: #00d4ff; font-size: 14px; }
    .token-count { color: #ffaa00; font-size: 16px; font-weight: bold; }
    .timer { color: #00ff88; font-size: 16px; }

    /* Damage number */
    .damage-num {
      position: absolute; left: 630px; top: 480px;
      color: #ff006e; font-size: 24px; font-weight: bold;
      text-shadow: 0 0 10px rgba(255,0,110,0.8);
      opacity: 0.9;
    }
    /* Chat */
    .chat-box {
      position: fixed; left: 16px; bottom: 200px; width: 300px;
      background: rgba(10,10,20,0.7); border: 1px solid rgba(0,255,136,0.15);
      padding: 8px 12px; border-radius: 2px;
    }
    .chat-msg { color: rgba(255,255,255,0.6); font-size: 11px; line-height: 1.6; }
    .chat-msg .player { color: #00d4ff; }
    .chat-msg .system { color: #ffaa00; }

    /* Minimap */
    .minimap {
      position: fixed; right: 16px; bottom: 200px;
      width: 140px; height: 100px;
      background: rgba(10,10,20,0.8); border: 1px solid rgba(0,255,136,0.2);
    }
    .minimap-player {
      position: absolute; width: 4px; height: 4px;
      background: #00d4ff; box-shadow: 0 0 4px #00d4ff;
    }
    .minimap-enemy {
      position: absolute; width: 4px; height: 4px;
      background: #ff006e; box-shadow: 0 0 4px #ff006e;
    }

    /* Crosshair */
    .crosshair {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: 24px; height: 24px; z-index: 5;
    }
    .crosshair::before, .crosshair::after {
      content: ''; position: absolute; background: rgba(0,255,136,0.6);
    }
    .crosshair::before { left: 0; top: 11px; width: 24px; height: 2px; }
    .crosshair::after { left: 11px; top: 0; width: 2px; height: 24px; }
    .crosshair-dot {
      position: absolute; left: 10px; top: 10px;
      width: 4px; height: 4px; border-radius: 50%;
      background: rgba(0,255,136,0.8);
    }
  </style>
</head>
<body>
  <div class="game-layer">
    <div class="wall wall-top"></div>
    <div class="wall wall-left"></div>
    <div class="wall wall-right"></div>
    <div class="wall wall-bottom"></div>
    <div class="floor-grid"></div>

    <!-- Player -->
    <div class="player">
      <div class="player-name">算力猎人_01</div>
      <div class="player-hp-bar-bg"><div class="player-hp-bar"></div></div>
      <div class="player-body"></div>
    </div>

    <!-- Enemy -->
    <div class="enemy">
      <div class="enemy-name">xX_DataGhost_Xx</div>
      <div class="enemy-hp-bar-bg"><div class="enemy-hp-bar"></div></div>
      <div class="enemy-body"></div>
    </div>

    <!-- Mining Node -->
    <div class="mining-node">
      <div class="node-label">TOKEN NODE</div>
      <div class="node-core"></div>
    </div>

    <!-- Projectile -->
    <div class="projectile"></div>

    <!-- Damage -->
    <div class="damage-num">-25</div>
  </div>

  <!-- Crosshair -->
  <div class="crosshair"><div class="crosshair-dot"></div></div>

  <!-- HUD Top -->
  <div class="top-bar">
    <div class="room-name">// ROOM: DATA_CORRIDOR_07</div>
    <div class="token-count">TOKENS: 347</div>
    <div class="timer">03:42</div>
  </div>

  <!-- HUD Bottom -->
  <div class="hud">
    <div class="hud-bottom">
      <div class="hud-panel">
        <div class="hud-label">HP</div>
        <div class="hud-value">65/100</div>
      </div>
      <div class="hud-panel">
        <div class="hud-label">KILLS</div>
        <div class="hud-value">3</div>
      </div>
      <div class="hud-panel">
        <div class="hud-label">PING</div>
        <div class="hud-value">32ms</div>
      </div>
      <div class="ability-bar">
        <div class="ability-slot">J</div>
        <div class="ability-slot cooldown">K</div>
        <div class="ability-slot">_</div>
        <div class="ability-slot">E</div>
      </div>
    </div>
  </div>

  <!-- Chat -->
  <div class="chat-box">
    <div class="chat-msg"><span class="system">[SYSTEM]</span> Room: Data Corridor 07</div>
    <div class="chat-msg"><span class="system">[SYSTEM]</span> Players: 5/8</div>
    <div class="chat-msg"><span class="player">&lt;K4L1&gt;</span> anyone seen the epic node?</div>
    <div class="chat-msg"><span class="player">&lt;NeonGhost&gt;</span> near server rack B</div>
  </div>

  <!-- Minimap -->
  <div class="minimap">
    <div class="minimap-player" style="left:85px;top:55px;"></div>
    <div class="minimap-enemy" style="left:40px;top:30px;"></div>
    <div class="minimap-enemy" style="left:60px;top:70px;"></div>
    <div class="minimap-player" style="left:20px;top:45px;"></div>
  </div>
</body>
</html>`;
}

/**
 * Generate HTML for a mock lobby scene screenshot (1920x1080)
 */
function getLobbyScreenshotHTML() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1920px; height: 1080px; overflow: hidden;
      background: #0a0a0f;
      font-family: monospace;
      color: #fff;
    }

    /* Animated background grid */
    .bg-grid {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background-image:
        linear-gradient(rgba(0, 255, 136, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 255, 136, 0.04) 1px, transparent 1px);
      background-size: 50px 50px;
      background-position: center center;
    }

    /* Scanlines */
    .scanlines {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: repeating-linear-gradient(
        0deg,
        transparent,
        transparent 2px,
        rgba(0,0,0,0.15) 2px,
        rgba(0,0,0,0.15) 4px
      );
      pointer-events: none;
    }

    /* Side decorative bars */
    .side-deco {
      position: fixed; top: 50%; transform: translateY(-50%);
      width: 3px; height: 300px;
      background: linear-gradient(180deg, transparent, #00ff88, #00d4ff, #00ff88, transparent);
      opacity: 0.4;
    }
    .side-deco-left { left: 60px; }
    .side-deco-right { right: 60px; }

    /* Main content container */
    .lobby-container {
      position: relative; z-index: 1;
      display: flex; flex-direction: column; align-items: center;
      padding-top: 80px; height: 100%;
    }

    /* Title section */
    .title-section {
      text-align: center; margin-bottom: 40px;
    }
    .main-title {
      font-size: 52px; font-weight: bold; color: #00ff88;
      text-shadow: 0 0 20px rgba(0,255,136,0.6), 0 0 40px rgba(0,255,136,0.3);
      letter-spacing: 8px; margin-bottom: 8px;
    }
    .subtitle {
      font-size: 20px; color: #00d4ff;
      text-shadow: 0 0 10px rgba(0,212,255,0.4);
      letter-spacing: 12px; opacity: 0.8;
    }
    .version-tag {
      font-size: 11px; color: rgba(255,255,255,0.3);
      margin-top: 12px;
    }

    /* Menu buttons */
    .menu-buttons {
      display: flex; flex-direction: column; gap: 12px;
      width: 360px; margin-bottom: 40px;
    }
    .menu-btn {
      display: flex; align-items: center; gap: 16px;
      padding: 14px 24px;
      background: rgba(18,18,26,0.9);
      border: 1px solid rgba(0,255,136,0.3);
      border-radius: 2px;
      cursor: default;
      transition: all 0.2s;
      text-decoration: none; color: inherit;
    }
    .menu-btn.active {
      border-color: #00ff88;
      box-shadow: 0 0 15px rgba(0,255,136,0.2);
      background: rgba(0,255,136,0.05);
    }
    .menu-btn-icon {
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
      font-size: 20px; color: #00ff88;
    }
    .menu-btn-text { flex: 1; }
    .menu-btn-title { font-size: 16px; color: #fff; margin-bottom: 2px; }
    .menu-btn-desc { font-size: 11px; color: rgba(255,255,255,0.4); }
    .menu-btn-arrow { color: rgba(0,255,136,0.5); font-size: 14px; }

    /* Stats panel */
    .stats-row {
      display: flex; gap: 20px; margin-bottom: 30px;
    }
    .stat-card {
      width: 130px; padding: 12px;
      background: rgba(18,18,26,0.8); border: 1px solid rgba(0,212,255,0.2);
      border-radius: 2px; text-align: center;
    }
    .stat-value {
      font-size: 28px; font-weight: bold; color: #00ff88;
      text-shadow: 0 0 10px rgba(0,255,136,0.4);
    }
    .stat-label {
      font-size: 10px; color: rgba(255,255,255,0.4); text-transform: uppercase;
      margin-top: 4px;
    }

    /* Bottom status bar */
    .status-bar {
      position: fixed; bottom: 0; left: 0; right: 0;
      padding: 8px 24px;
      background: rgba(10,10,20,0.9);
      border-top: 1px solid rgba(0,255,136,0.1);
      display: flex; justify-content: space-between;
      font-size: 11px; color: rgba(255,255,255,0.4);
    }
    .status-item { display: flex; align-items: center; gap: 6px; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: #00ff88; }
    .status-dot.warning { background: #ffaa00; }

    /* Decorative terminal lines */
    .terminal-line {
      position: fixed; font-size: 10px; color: rgba(0,255,136,0.08);
      font-family: monospace;
    }
    .term-1 { top: 40px; left: 80px; }
    .term-2 { top: 120px; right: 100px; }
    .term-3 { bottom: 100px; left: 100px; }
    .term-4 { bottom: 60px; right: 80px; }

    /* Hex decorations */
    .hex-deco { position: fixed; opacity: 0.06; }
    .hex-1 {
      top: 60px; right: 200px; width: 100px; height: 115px;
      background: #00ff88; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    }
    .hex-2 {
      bottom: 120px; left: 180px; width: 70px; height: 81px;
      background: #00d4ff; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    }
    .hex-3 {
      top: 200px; left: 120px; width: 50px; height: 58px;
      background: #ff006e; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
    }
  </style>
</head>
<body>
  <div class="bg-grid"></div>
  <div class="scanlines"></div>

  <div class="side-deco side-deco-left"></div>
  <div class="side-deco side-deco-right"></div>

  <!-- Hex decorations -->
  <div class="hex-deco hex-1"></div>
  <div class="hex-deco hex-2"></div>
  <div class="hex-deco hex-3"></div>

  <!-- Terminal lines -->
  <div class="terminal-line term-1">> initializing lobby protocol... [OK]</div>
  <div class="terminal-line term-2">> connecting to network node NRT-07... [3ms]</div>
  <div class="terminal-line term-3">> active players: 42 | online nodes: 127</div>
  <div class="terminal-line term-4">> weekly season: OVERCLOCK | ends in 3d 14h</div>

  <div class="lobby-container">
    <div class="title-section">
      <div class="main-title">TOKEN WARS</div>
      <div class="subtitle">算 力 征 途</div>
      <div class="version-tag">// BUILD 0.3.0-alpha // PROTOCOL v2.1</div>
    </div>

    <!-- Player Stats -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">847</div>
        <div class="stat-label">AELO Rating</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">3,247</div>
        <div class="stat-label">Total Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">42</div>
        <div class="stat-label">Wins</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">12</div>
        <div class="stat-label">Losses</div>
      </div>
    </div>

    <!-- Menu -->
    <div class="menu-buttons">
      <div class="menu-btn active">
        <div class="menu-btn-icon">&#9654;</div>
        <div class="menu-btn-text">
          <div class="menu-btn-title">PvP 竞技场</div>
          <div class="menu-btn-desc">实时多人对战 · AELO匹配</div>
        </div>
        <div class="menu-btn-arrow">&gt;</div>
      </div>
      <div class="menu-btn">
        <div class="menu-btn-icon">&#9881;</div>
        <div class="menu-btn-text">
          <div class="menu-btn-title">AI 傀儡竞技场</div>
          <div class="menu-btn-desc">异步战斗 · 策略配置 · 回放</div>
        </div>
        <div class="menu-btn-arrow">&gt;</div>
      </div>
      <div class="menu-btn">
        <div class="menu-btn-icon">&#9762;</div>
        <div class="menu-btn-text">
          <div class="menu-btn-title">采掘模式</div>
          <div class="menu-btn-desc">安全采集 · Token获取</div>
        </div>
        <div class="menu-btn-arrow">&gt;</div>
      </div>
      <div class="menu-btn">
        <div class="menu-btn-icon">&#9733;</div>
        <div class="menu-btn-text">
          <div class="menu-btn-title">排行榜</div>
          <div class="menu-btn-desc">AELO排名 · 赛季追踪</div>
        </div>
        <div class="menu-btn-arrow">&gt;</div>
      </div>
      <div class="menu-btn">
        <div class="menu-btn-icon">&#9878;</div>
        <div class="menu-btn-text">
          <div class="menu-btn-title">设置</div>
          <div class="menu-btn-desc">画面 · 音效 · 控制</div>
        </div>
        <div class="menu-btn-arrow">&gt;</div>
      </div>
    </div>
  </div>

  <!-- Status bar -->
  <div class="status-bar">
    <div class="status-item"><span class="status-dot"></span> CONNECTED</div>
    <div class="status-item">NODE: NRT-07</div>
    <div class="status-item">REGION: ASIA-PACIFIC</div>
    <div class="status-item">PING: 24ms</div>
    <div class="status-item">ONLINE: 1,337</div>
    <div class="status-item"><span class="status-dot warning"></span> SEASON: OVERCLOCK</div>
  </div>
</body>
</html>`;
}

// =============================================================================
// Main Export Function
// =============================================================================

async function exportSteamAssets() {
  console.log('[Token Wars] Starting Steam asset export...');
  console.log(`[Token Wars] Output directory: ${OUTPUT_DIR}`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({ headless: 'new' });

  try {
    // --- Capsule Art (SVG-based) ---

    // 1. Library Capsule (616x353)
    console.log('[1/6] Rendering Library Capsule (616x353)...');
    await renderSVGCapsule(browser, 616, 353, false, '01-steam-library-capsule.png');

    // 2. Header Capsule (460x215)
    console.log('[2/6] Rendering Header Capsule (460x215)...');
    await renderSVGCapsule(browser, 460, 215, false, '02-steam-header-capsule.png');

    // 3. Small Capsule (231x87)
    console.log('[3/6] Rendering Small Capsule (231x87)...');
    await renderSVGCapsule(browser, 231, 87, true, '03-steam-small-capsule.png');

    // 4. Main Capsule (616x353)
    console.log('[4/6] Rendering Main Capsule (616x353)...');
    await renderSVGCapsule(browser, 616, 353, false, '04-steam-main-capsule.png');

    // --- Concept Screenshots (HTML-based) ---

    // 5. Combat Screenshot (1920x1080)
    console.log('[5/6] Rendering Combat Screenshot (1920x1080)...');
    await renderHTMLScreenshot(browser, getCombatScreenshotHTML(), 1920, 1080, '05-screenshot-combat.png');

    // 6. Lobby Screenshot (1920x1080)
    console.log('[6/6] Rendering Lobby Screenshot (1920x1080)...');
    await renderHTMLScreenshot(browser, getLobbyScreenshotHTML(), 1920, 1080, '06-screenshot-lobby.png');

    console.log('\n[Token Wars] All assets exported successfully!');
    console.log(`[Token Wars] Files written to: ${OUTPUT_DIR}`);

  } catch (error) {
    console.error('[Token Wars] Export failed:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

/**
 * Render an SVG-based capsule art image
 */
async function renderSVGCapsule(browser, width, height, simplified, filename) {
  const page = await browser.newPage();
  const svg = generateCapsuleSVG(width, height, simplified);

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;">${svg}</body></html>`, {
      waitUntil: 'networkidle0'
    });
    await page.screenshot({
      path: path.join(OUTPUT_DIR, filename),
      type: 'png',
      omitBackground: false
    });
  } finally {
    await page.close();
  }
}

/**
 * Render an HTML-based concept screenshot
 */
async function renderHTMLScreenshot(browser, html, width, height, filename) {
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // Small delay to ensure animations/rendering settles
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.screenshot({
      path: path.join(OUTPUT_DIR, filename),
      type: 'png',
      omitBackground: false
    });
  } finally {
    await page.close();
  }
}

// Run
exportSteamAssets();
