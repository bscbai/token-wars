/**
 * 生成静态演示站（demo-site/index.html）
 *
 * 没有公网服务器时，也给访问者一个可以直接打开看的页面：用内置 AI 跑几场
 * 镜像对局，把回放帧内联进单文件 HTML（画布逐帧播放 + 排行榜快照）。
 * 纯静态，可托管在 GitHub Pages（无后端、无账号）。
 *
 * 用法：node scripts/build-static-demo.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { Store } = require('../server/data/Store');
const Player = require('../server/models/Player');
const { AIAgent } = require('../server/models/AIAgent');
const AIArenaManager = require('../server/game/AIArenaManager');

const OUT_DIR = path.join(__dirname, '..', 'demo-site');
const OUT_FILE = path.join(OUT_DIR, 'index.html');
const OG_IMAGE_SRC = path.join(__dirname, '..', 'client', 'og-image.png');
const PUBLIC_ORIGIN = 'https://bscbai.github.io/token-wars';

const store = new Store(':memory:', { migrate: false });
const owner = new Player('static-demo-owner');
store.addPlayer(owner);
const mgr = new AIArenaManager({ emit() {}, of() { return {}; } }, store, {});
mgr.tryMatch = () => {};

const NAMES = ['TW-Gatekeeper', 'Nova', 'Vector', 'Quanta'];
const agents = NAMES.map((name) => new AIAgent(owner.id, [], name));
const maps = Object.values(AIArenaManager.AI_MAPS);
const matches = [];

// 4 名 agent 循环对战：每场换地图，24 场让排名更有说服力
for (let i = 0; i < 24; i++) {
  const a = agents[i % agents.length];
  const b = agents[(i + 1 + Math.floor(i / agents.length)) % agents.length];
  if (a === b) continue;
  const map = maps[i % maps.length];
  const before = mgr.matchHistory.length;
  mgr.startMatch(a, b, map);
  const entry = mgr.matchHistory[mgr.matchHistory.length - 1];
  if (mgr.matchHistory.length === before) continue;
  let winner = 'draw';
  if (!entry.isDraw && entry.winner && entry.winner !== 'draw') {
    winner = entry.winner === entry.agentA ? 'A' : 'B';
  }
  matches.push({
    a: entry.agentAName,
    b: entry.agentBName,
    winner,
    ticks: entry.totalTicks,
    map: { id: map.id, name: map.name, width: map.width, height: map.height, obstacles: map.obstacles },
    frames: entry.frames || [],
  });
}

const standings = agents
  .map((ag) => ({ name: ag.name, aelo: ag.aelo, wins: ag.wins, losses: ag.losses, draws: ag.draws }))
  .sort((x, y) => y.aelo - x.aelo);

const stats = {
  matches: matches.length,
  draws: matches.filter((m) => m.winner === 'draw').length,
  avgTicks: Math.round(matches.reduce((s, m) => s + m.ticks, 0) / Math.max(1, matches.length)),
  maps: new Set(matches.map((m) => m.map.id)).size,
};

const data = { generatedAt: new Date().toISOString(), standings, matches, stats };

// 回放播放器与样式在 index / 每场分享页之间共用，避免生成物里两份实现漂移
const BASE_CSS = `
  :root { --bg:#0a0a1a; --panel:#0f1024; --line:#1d2b3a; --green:#00ff88; --green-dim:#00aa77;
          --blue:#88aaff; --text:#cfe8dd; --muted:#5f7a71; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { min-height:100vh; color:var(--text); font-family:'Courier New',ui-monospace,monospace;
         padding:28px 22px 40px;
         background:
           linear-gradient(rgba(0,255,136,.04) 1px, transparent 1px) 0 0/40px 40px,
           linear-gradient(90deg, rgba(0,255,136,.04) 1px, transparent 1px) 0 0/40px 40px, var(--bg); }
  header, main, footer, .banner { max-width:1000px; margin:0 auto; }
  h1 { font-size:26px; letter-spacing:3px; color:var(--green); }
  h1::before { content:'▚ '; color:var(--green-dim); }
  #subtitle { color:var(--muted); font-size:13px; margin-top:6px; }
  .banner { margin:16px auto; padding:11px 14px; font-size:12px; color:#ffd479;
            border:1px solid #4a3a1a; background:#1a1508; border-radius:6px; }
  .banner a { color:var(--green); }
  main { display:grid; grid-template-columns: 1fr 320px; gap:18px; margin-top:20px; }
  @media (max-width: 780px) { main { grid-template-columns: 1fr; } }
  section { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
  h2 { font-size:13px; letter-spacing:2px; color:var(--blue); text-transform:uppercase; margin-bottom:12px; }
  .stage { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }
  canvas { background:#06060f; border:1px solid #1b2a24; border-radius:4px; image-rendering:pixelated; }
  .meta { font-size:12px; color:var(--muted); line-height:1.9; min-width:190px; }
  .duel { font-size:14px; color:var(--text); }
  .duel .win { color:#44ff88; font-weight:bold; }
  .hp { color:var(--text); }
  .controls { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
  button { font:inherit; font-size:12px; padding:6px 11px; cursor:pointer; border-radius:4px;
           color:var(--green); background:#12251d; border:1px solid var(--green); }
  button:hover { background:#1b3529; }
  select { font:inherit; font-size:12px; padding:6px 8px; color:var(--text);
           background:#06060f; border:1px solid #1b2a24; border-radius:4px; max-width:100%; }
  .row { display:grid; grid-template-columns:34px 1fr 62px 64px; gap:8px; padding:7px 0;
         border-bottom:1px dashed #16222c; font-size:13px; }
  .row:last-child { border-bottom:0; }
  .row.head { color:var(--muted); font-size:11px; letter-spacing:1px; border-bottom:1px solid var(--line); }
  .row .rank { color:var(--muted); }
  .row .name { color:var(--green); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .num { text-align:right; }
  .row .dim { color:var(--muted); }
  footer { margin-top:22px; font-size:12px; color:var(--muted); display:flex; gap:16px; flex-wrap:wrap; }
  footer a { color:var(--green-dim); text-decoration:none; }
  footer a:hover { color:var(--green); }
  .join { max-width:1000px; margin:18px auto 0; padding:15px 16px 13px;
          background:var(--panel); border:1px solid #16352a; border-radius:8px; }
  .join h2 { color:var(--green); }
  .join p { font-size:12px; color:var(--muted); line-height:1.8; }
  .join a { color:var(--green-dim); text-decoration:none; }
  .join a:hover { color:var(--green); }
  .join pre { margin:10px 0 8px; padding:10px 12px; background:#06060f; border:1px solid #1b2a24;
              border-radius:4px; color:var(--text); font:inherit; font-size:12px; overflow-x:auto; }
  .stats { font-size:11px; color:var(--muted); margin-top:10px; }
  /* Landing hero（index 专用；单场分享页带了样式也不影响） */
  .hero { margin-top:8px; position:relative; }
  .lang-switch { position:absolute; right:0; top:0; font-size:12px; padding:4px 10px;
                 color:var(--green-dim); border:1px solid #1b3a30; border-radius:4px; text-decoration:none; }
  .lang-switch:hover { color:var(--green); border-color:var(--green); }
  .kicker { font-size:11px; letter-spacing:3px; color:var(--green-dim); }
  .hero h1 { font-size:clamp(30px, 6vw, 46px); letter-spacing:4px; margin-top:8px; }
  .hero h1 .caret { color:var(--muted); }
  .tagline { margin-top:10px; font-size:14px; line-height:1.9; color:var(--text); }
  .tagline b { color:var(--green); font-weight:normal; }
  .cta { display:flex; gap:10px; flex-wrap:wrap; margin-top:16px; }
  .btn { display:inline-block; font-size:13px; padding:9px 16px; border-radius:4px; text-decoration:none;
         color:var(--green); border:1px solid var(--green); background:#12251d; }
  .btn:hover { background:#1b3529; }
  .btn.primary { background:var(--green); color:#04110b; font-weight:bold; }
  .btn.primary:hover { background:#5cffb0; }
  .btn.ghost { background:transparent; color:var(--green-dim); border-color:#1b3a30; }
  .hero-stats { margin-top:12px; font-size:11px; color:var(--muted); letter-spacing:1px; }
  main#replay { scroll-margin-top:16px; }
  .note { font-size:12px; color:var(--muted); line-height:1.8; }
  .note a { color:var(--green-dim); text-decoration:none; }
  .note a:hover { color:var(--green); }
  .match-links { margin-top:10px; font-size:11px; color:var(--muted); line-height:2; }
  .match-links a { color:var(--green-dim); text-decoration:none; margin-right:6px; }
  .match-links a:hover { color:var(--green); }
  .gallery { max-width:1000px; margin:18px auto 0; }
  .gallery h2 { color:var(--green); }
  .gallery .note { max-width:760px; }
  .gallery-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:12px; }
  .shot { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .shot img { display:block; width:100%; height:auto; border-bottom:1px solid var(--line); }
  .shot figcaption { font-size:11px; color:var(--muted); line-height:1.7; padding:8px 10px; }
  @media (max-width: 780px) { .gallery-grid { grid-template-columns:1fr; } }
`;

// 单场回放播放器：读取 window.__MATCH__，绘制画布并提供播放/暂停/重播
const PLAYER_JS = `
(function () {
  const d = window.__MATCH__;
  if (!d) return;
  const board = document.getElementById('board');
  const toggle = document.getElementById('toggle');
  const restart = document.getElementById('restart');
  const duelEl = document.getElementById('duel');
  const hpEl = document.getElementById('hp');
  const ctxEl = document.getElementById('context');
  const state = { frame: 0, timer: null, playing: false };

  function draw() {
    const m = d.map, f = d.frames[state.frame];
    if (!f) return;
    const cell = Math.floor(Math.min(320 / m.width, 320 / m.height));
    board.width = m.width * cell;
    board.height = m.height * cell;
    const ctx = board.getContext('2d');
    ctx.fillStyle = '#06060f';
    ctx.fillRect(0, 0, board.width, board.height);
    ctx.strokeStyle = 'rgba(0,255,136,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < m.width; i++) { ctx.moveTo(i * cell + .5, 0); ctx.lineTo(i * cell + .5, board.height); }
    for (let j = 1; j < m.height; j++) { ctx.moveTo(0, j * cell + .5); ctx.lineTo(board.width, j * cell + .5); }
    ctx.stroke();
    ctx.fillStyle = '#17242e';
    for (const [x, y] of m.obstacles) ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
    for (const [p, on, off] of [[f.a, '#00ff88', '#2a5a44'], [f.b, '#ff4466', '#5a2a36']]) {
      ctx.fillStyle = p.alive ? on : off;
      ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2);
    }
    hpEl.textContent = 'HP ' + f.a.hp + ' / ' + f.b.hp + ' · tick ' + f.t + ' · ' + (state.frame + 1) + '/' + d.frames.length;
  }

  function stop() { clearInterval(state.timer); state.timer = null; state.playing = false; toggle.textContent = 'Play'; }

  function play() {
    stop();
    if (state.frame >= d.frames.length - 1) state.frame = 0;
    state.playing = true;
    toggle.textContent = 'Pause';
    state.timer = setInterval(() => {
      if (state.frame >= d.frames.length - 1) { stop(); return; }
      state.frame++;
      draw();
    }, 100);
  }

  const a = document.createElement('span');
  a.className = d.winner === 'A' ? 'win' : '';
  a.textContent = '◆ ' + d.a;
  const vs = document.createElement('span');
  vs.textContent = d.winner === 'draw' ? '  draw  ' : '  vs  ';
  const b = document.createElement('span');
  b.className = d.winner === 'B' ? 'win' : '';
  b.textContent = d.b + ' ◇';
  duelEl.append(a, vs, b);
  ctxEl.textContent = d.ticks + ' ticks · ' + d.map.name + ' · ' + (d.winner === 'draw' ? 'draw' : d.winner + ' wins');

  toggle.addEventListener('click', () => (state.playing ? stop() : play()));
  if (restart) restart.addEventListener('click', () => { state.frame = 0; draw(); play(); });
  draw();
  play();
})();
`;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const matchPageUrl = (i) => `${PUBLIC_ORIGIN}/match-${String(i + 1).padStart(2, '0')}.html`;
const matchTitle = (m) => (m.winner === 'draw'
  ? `${m.a} vs ${m.b} — draw`
  : `${m.a} vs ${m.b} — ${m.winner === 'A' ? m.a : m.b} wins`);
const matchDesc = (m) => `${m.ticks} ticks on ${m.map.name} · recorded AI-agent match from Token Wars, a server-authoritative arena where you bring your own agent.`;

function matchPage(i, m) {
  const title = matchTitle(m);
  const desc = matchDesc(m);
  const json = JSON.stringify(m).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} · Token Wars</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${matchPageUrl(i)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${matchPageUrl(i)}">
<meta property="og:image" content="${PUBLIC_ORIGIN}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${PUBLIC_ORIGIN}/og-image.png">
<link rel="icon" href="./og-image.png" type="image/png">
<style>${BASE_CSS}</style>
</head>
<body>
  <header>
    <h1>AI AGENT ARENA</h1>
    <p id="subtitle">Recorded match — Token Wars</p>
  </header>

  <div class="banner">
    This is a <b>static recording</b> (no server). Live ladder and your own bot run locally
    in ~1 minute: <code>npm install &amp;&amp; npm run demo</code> —
    or <a href="https://github.com/bscbai/token-wars">read the protocol</a>.
  </div>

  <main>
    <section>
      <h2>Match replay</h2>
      <div class="stage">
        <canvas id="board" width="320" height="320"></canvas>
        <div class="meta">
          <div id="duel" class="duel"></div>
          <div id="hp" class="hp"></div>
          <div id="context"></div>
          <div class="controls">
            <button id="toggle" type="button">Play</button>
            <button id="restart" type="button">Restart</button>
          </div>
        </div>
      </div>
    </section>
    <section>
      <h2>Share this match</h2>
      <p class="note">Every recorded match has its own page — paste the URL and it unfurls
      with this match's result and a preview card.</p>
      <p class="note" style="margin-top:10px">
        <a href="./play.html">Play this matchup yourself</a><br>
        <a href="./sandbox.html">Write your own agent (browser sandbox)</a><br>
        <a href="./index.html">All recorded matches</a><br>
        <a href="./benchmark.html">Benchmark v0</a><br>
        <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">5-minute agent quickstart</a><br>
        <a href="https://github.com/bscbai/token-wars">GitHub</a>
      </p>
    </section>
  </main>

  <footer>
    <span>Match ${i + 1} of ${matches.length}</span>
    <span id="generated"></span>
  </footer>

<script>window.__MATCH__ = ${json};</script>
<script src="./replay.js"></script>
<script>document.getElementById('generated').textContent = 'recorded ' + ${JSON.stringify(data.generatedAt.slice(0, 10))};</script>
</body>
</html>
`;
}

const INDEX_STRINGS = {
  en: {
    htmlLang: 'en',
    title: 'Token Wars — AI Arena (recorded demo)',
    description: 'Recorded AI-agent matches from Token Wars: a real-time, server-authoritative arena where you bring your own agent. Static demo — run the game locally for live fights.',
    kicker: 'AI AGENT ARENA · RECORDED DEMO',
    taglineHtml: `Bring your own AI agent to a real-time 1v1 arena.<br>
        <b>Watch</b> recorded fights, <b>play</b> the built-in AI, or
        <b>write</b> a bot — no install.`,
    ctaPlay: '▶ Play vs the AI',
    ctaSandbox: 'Write an agent',
    ctaReplay: 'Watch replays',
    bannerHtml: `<b>Static demo</b> (no server). Live ladder, live board and your own bot run
      locally in ~1 minute:
      <code>git clone https://github.com/bscbai/token-wars &amp;&amp; cd token-wars &amp;&amp; npm install &amp;&amp; npm run demo</code>
      — or <a href="https://github.com/bscbai/token-wars">read the protocol</a>.`,
    h2Replay: 'Match replay',
    h2Standings: 'Standings (after these matches)',
    h2Join: 'Bring your own agent',
    joinIntro: 'Any language. One command registers an account, mints a bot token and joins the queue:',
    joinLinksHtml: `<a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">5-minute agent quickstart</a>
      · <a href="./sandbox.html">try a policy in the browser sandbox</a>
      · <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/bot-protocol.en.md">full protocol</a>
      · <a href="https://github.com/bscbai/token-wars/tree/main/token-wars/examples">sample bots (Node / Python / LLM)</a>`,
    galleryH2: 'More than an arena',
    galleryLead: 'The same build ships the full game: idle mining, PvE dungeons, PvP ladder, world boss and co-processor loadouts. Run it locally or grab a desktop build.',
    shotLobby: 'Lobby — mining, dungeons, PvP, AI arena, shop and inventory.',
    shotMining: 'Idle mining — collect tokens, upgrade the rig.',
    shotDungeons: 'PvE dungeons — solo or 3–5 player waves and bosses.',
    shotLobbyAlt: 'Game lobby',
    shotMiningAlt: 'Idle mining screen',
    shotDungeonsAlt: 'PvE dungeon list',
    galleryDownload: 'Download desktop builds',
    galleryRun: 'Run it locally',
    footerPlay: 'Play vs the AI',
    footerSandbox: 'Write an agent',
    footerProtocol: 'Bot protocol',
    footerBenchmark: 'Benchmark v0',
    otherLang: '中文',
    otherHref: './index.zh.html',
    playHref: './play.html',
    sandboxHref: './sandbox.html',
    benchmarkHref: './benchmark.html',
    play: 'Play',
    pause: 'Pause',
    drawWord: 'draw',
    winsSuffix: ' wins',
    drawPadded: '  draw  ',
    vsPadded: '  vs  ',
    ctxTicks: ' ticks · ',
    statMatches: ' recorded matches · ',
    statMaps: ' maps · avg ',
    statTicks: ' ticks · ',
    statDraws: ' draws',
    heroMatches: ' RECORDED MATCHES · ',
    heroMaps: ' MAPS · AVG ',
    heroTicks: ' TICKS · RECORDED ',
    shareLead: 'Share a single match: ',
    recorded: 'recorded ',
    colAgent: 'Agent',
  },
  zh: {
    htmlLang: 'zh-CN',
    title: 'Token Wars — AI 竞技场（录制演示）',
    description: 'Token Wars 的 AI agent 录制对局：实时、服务端权威的 1v1 竞技场，带你的 agent 来参赛。静态演示——本地运行即可实时对战。',
    kicker: 'AI AGENT 竞技场 · 录制演示',
    taglineHtml: `带你的 AI agent 上实时 1v1 擂台。<br>
        <b>看</b>录制对局、<b>打</b>内置 AI，或者
        <b>写</b>一个 bot——无需安装。`,
    ctaPlay: '▶ 对战内置 AI',
    ctaSandbox: '写个 agent',
    ctaReplay: '看回放',
    bannerHtml: `<b>静态演示</b>（无需服务端）。实时天梯、实时棋盘和你的 bot 可在本地约 1 分钟跑起来：
      <code>git clone https://github.com/bscbai/token-wars &amp;&amp; cd token-wars &amp;&amp; npm install &amp;&amp; npm run demo</code>
      ——或<a href="https://github.com/bscbai/token-wars">阅读协议</a>。`,
    h2Replay: '对局回放',
    h2Standings: '积分榜（这些对局之后）',
    h2Join: '带你的 agent 来参赛',
    joinIntro: '任何语言。一条命令即可注册账号、签发 bot token 并加入队列：',
    joinLinksHtml: `<a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">5 分钟 agent 上手</a>
      · <a href="./sandbox.html?lang=zh">在浏览器沙盒里试策略</a>
      · <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/bot-protocol.md">完整协议（中文）</a>
      · <a href="https://github.com/bscbai/token-wars/tree/main/token-wars/examples">示例 bot（Node / Python / LLM）</a>`,
    galleryH2: '不止是竞技场',
    galleryLead: '同一份构建包含完整游戏：挂机挖矿、PvE 副本、PvP 排位、世界 Boss 与协处理器装配。可在本地运行，或直接下载桌面版。',
    shotLobby: '大厅——挖矿、副本、PvP、AI 竞技场、商店与背包。',
    shotMining: '挂机挖矿——收集 Token、升级矿机。',
    shotDungeons: 'PvE 副本——单人或多人的怪物波次与 Boss。',
    shotLobbyAlt: '游戏大厅',
    shotMiningAlt: '挂机挖矿界面',
    shotDungeonsAlt: 'PvE 副本列表',
    galleryDownload: '下载桌面版',
    galleryRun: '本地运行',
    footerPlay: '对战内置 AI',
    footerSandbox: '写个 agent',
    footerProtocol: 'Bot 协议',
    footerBenchmark: '基准测试 v0',
    otherLang: 'EN',
    otherHref: './index.html',
    playHref: './play.html?lang=zh',
    sandboxHref: './sandbox.html?lang=zh',
    benchmarkHref: './benchmark.zh.html',
    play: '播放',
    pause: '暂停',
    drawWord: '平局',
    winsSuffix: ' 获胜',
    drawPadded: '  平局  ',
    vsPadded: '  vs  ',
    ctxTicks: ' tick · ',
    statMatches: ' 场录制对局 · ',
    statMaps: ' 张地图 · 平均 ',
    statTicks: ' tick · ',
    statDraws: ' 场平局',
    heroMatches: ' 场录制对局 · ',
    heroMaps: ' 张地图 · 平均 ',
    heroTicks: ' tick · 录制于 ',
    shareLead: '单场分享：',
    recorded: '录制于 ',
    colAgent: 'Agent',
  },
};

function indexPage(lang) {
  const S = INDEX_STRINGS[lang];
  return `<!DOCTYPE html>
<html lang="${S.htmlLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${S.title}</title>
<meta name="description" content="${S.description}">
<meta property="og:title" content="${S.title}">
<meta property="og:description" content="${S.description}">
<meta property="og:type" content="website">
<meta property="og:url" content="__PUBLIC_ORIGIN__/${lang === 'en' ? '' : 'index.zh.html'}">
<link rel="alternate" hreflang="en" href="__PUBLIC_ORIGIN__/">
<link rel="alternate" hreflang="zh" href="__PUBLIC_ORIGIN__/index.zh.html">
<meta property="og:image" content="__PUBLIC_ORIGIN__/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${S.title}">
<meta name="twitter:description" content="${S.description}">
<meta name="twitter:image" content="__PUBLIC_ORIGIN__/og-image.png">
<link rel="icon" href="./og-image.png" type="image/png">
<style>${BASE_CSS}</style>
</head>
<body>
  <header class="hero">
    <a class="lang-switch" href="${S.otherHref}" hreflang="${lang === 'en' ? 'zh' : 'en'}">${S.otherLang}</a>
    <div class="hero-copy">
      <div class="kicker">${S.kicker}</div>
      <h1>TOKEN WARS<span class="caret">_</span></h1>
      <p class="tagline">${S.taglineHtml}</p>
      <div class="cta">
        <a class="btn primary" href="${S.playHref}">${S.ctaPlay}</a>
        <a class="btn" href="${S.sandboxHref}">${S.ctaSandbox}</a>
        <a class="btn ghost" href="#replay">${S.ctaReplay}</a>
      </div>
      <div class="hero-stats" id="heroStats"></div>
    </div>
  </header>

  <div class="banner">
    ${S.bannerHtml}
  </div>

  <main id="replay">
    <section>
      <h2>${S.h2Replay}</h2>
      <div class="stage">
        <canvas id="board" width="320" height="320"></canvas>
        <div class="meta">
          <div id="duel" class="duel"></div>
          <div id="hp" class="hp"></div>
          <div id="context"></div>
          <div class="controls">
            <select id="picker"></select>
            <button id="toggle" type="button">${S.play}</button>
          </div>
        </div>
      </div>
    </section>
    <section>
      <h2>${S.h2Standings}</h2>
      <div id="standings"></div>
      <div class="stats" id="stats"></div>
    </section>
  </main>

  <section class="gallery">
    <h2>${S.galleryH2}</h2>
    <p class="note">${S.galleryLead}</p>
    <div class="gallery-grid">
      <figure class="shot">
        <img src="./shot-lobby.png" width="1024" height="683" loading="lazy" alt="${S.shotLobbyAlt}">
        <figcaption>${S.shotLobby}</figcaption>
      </figure>
      <figure class="shot">
        <img src="./shot-mining.png" width="1024" height="683" loading="lazy" alt="${S.shotMiningAlt}">
        <figcaption>${S.shotMining}</figcaption>
      </figure>
      <figure class="shot">
        <img src="./shot-dungeons.png" width="1024" height="683" loading="lazy" alt="${S.shotDungeonsAlt}">
        <figcaption>${S.shotDungeons}</figcaption>
      </figure>
    </div>
    <div class="cta">
      <a class="btn" href="https://github.com/bscbai/token-wars/releases">${S.galleryDownload}</a>
      <a class="btn ghost" href="#join">${S.galleryRun}</a>
    </div>
  </section>

  <section class="join" id="join">
    <h2>${S.h2Join}</h2>
    <p>${S.joinIntro}</p>
    <pre>git clone https://github.com/bscbai/token-wars.git
cd token-wars
npm install
npm run join -- --url &lt;arena-url&gt;</pre>
    <p>${S.joinLinksHtml}</p>
  </section>

  <footer>
    <a href="${S.playHref}">${S.footerPlay}</a>
    <a href="${S.sandboxHref}">${S.footerSandbox}</a>
    <a href="https://github.com/bscbai/token-wars">GitHub</a>
    <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/bot-protocol.en.md">${S.footerProtocol}</a>
    <a href="${S.benchmarkHref}">${S.footerBenchmark}</a>
    <span id="generated"></span>
  </footer>
  <div class="match-links" id="matchLinks"></div>

<script>
const DATA = __DATA__;
const S = ${JSON.stringify(S)};
const board = document.getElementById('board');
const picker = document.getElementById('picker');
const toggle = document.getElementById('toggle');
const duelEl = document.getElementById('duel');
const hpEl = document.getElementById('hp');
const ctxEl = document.getElementById('context');
const state = { idx: 0, frame: 0, timer: null, playing: false, data: DATA.matches[0] };

DATA.matches.forEach((m, i) => {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = m.a + ' vs ' + m.b + ' · ' + m.map.name;
  picker.appendChild(opt);
});

function draw(d) {
  const m = d.map, f = d.frames[state.frame];
  const cell = Math.floor(Math.min(320 / m.width, 320 / m.height));
  board.width = m.width * cell;
  board.height = m.height * cell;
  const ctx = board.getContext('2d');
  ctx.fillStyle = '#06060f';
  ctx.fillRect(0, 0, board.width, board.height);
  ctx.strokeStyle = 'rgba(0,255,136,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < m.width; i++) { ctx.moveTo(i * cell + .5, 0); ctx.lineTo(i * cell + .5, board.height); }
  for (let j = 1; j < m.height; j++) { ctx.moveTo(0, j * cell + .5); ctx.lineTo(board.width, j * cell + .5); }
  ctx.stroke();
  ctx.fillStyle = '#17242e';
  for (const [x, y] of m.obstacles) ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
  for (const [p, on, off] of [[f.a, '#00ff88', '#2a5a44'], [f.b, '#ff4466', '#5a2a36']]) {
    ctx.fillStyle = p.alive ? on : off;
    ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2);
  }
  hpEl.textContent = 'HP ' + f.a.hp + ' / ' + f.b.hp + ' · tick ' + f.t + ' · ' + (state.frame + 1) + '/' + d.frames.length;
}

function renderMeta() {
  const d = state.data;
  duelEl.innerHTML = '';
  const a = document.createElement('span');
  a.className = d.winner === 'A' ? 'win' : '';
  a.textContent = '◆ ' + d.a;
  const vs = document.createElement('span');
  vs.textContent = d.winner === 'draw' ? S.drawPadded : S.vsPadded;
  const b = document.createElement('span');
  b.className = d.winner === 'B' ? 'win' : '';
  b.textContent = d.b + ' ◇';
  duelEl.append(a, vs, b);
  ctxEl.textContent = d.ticks + S.ctxTicks + d.map.name + ' · ' + (d.winner === 'draw' ? S.drawWord : d.winner + S.winsSuffix);
}

function stop() { clearInterval(state.timer); state.timer = null; state.playing = false; toggle.textContent = S.play; }

function play() {
  stop();
  if (state.frame >= state.data.frames.length - 1) state.frame = 0;
  state.playing = true;
  toggle.textContent = S.pause;
  state.timer = setInterval(() => {
    if (state.frame >= state.data.frames.length - 1) { stop(); return; }
    state.frame++;
    draw(state.data);
  }, 100);
}

function select(i) {
  stop();
  state.idx = i;
  state.frame = 0;
  state.data = DATA.matches[i];
  picker.value = String(i);
  renderMeta();
  draw(state.data);
  play();
}

picker.addEventListener('change', () => select(parseInt(picker.value, 10)));
toggle.addEventListener('click', () => (state.playing ? stop() : play()));

const host = document.getElementById('standings');
const head = document.createElement('div');
head.className = 'row head';
['#', S.colAgent, 'AELO', 'W/L'].forEach((label, i) => {
  const s = document.createElement('span');
  s.className = i === 0 ? 'rank' : (i === 1 ? 'name' : 'num');
  s.textContent = label;
  head.appendChild(s);
});
host.appendChild(head);
DATA.standings.forEach((e, i) => {
  const row = document.createElement('div');
  row.className = 'row';
  const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(i + 1);
  const name = document.createElement('span'); name.className = 'name'; name.textContent = (i === 0 ? '◆ ' : '◇ ') + e.name;
  const aelo = document.createElement('span'); aelo.className = 'num'; aelo.textContent = String(e.aelo);
  const rec = document.createElement('span'); rec.className = 'num dim'; rec.textContent = e.wins + '/' + e.losses;
  row.append(rank, name, aelo, rec);
  host.appendChild(row);
});

document.getElementById('generated').textContent = S.recorded + DATA.generatedAt.slice(0, 10);
document.getElementById('stats').textContent =
  DATA.stats.matches + S.statMatches + DATA.stats.maps + S.statMaps +
  DATA.stats.avgTicks + S.statTicks + DATA.stats.draws + S.statDraws;

document.getElementById('heroStats').textContent =
  DATA.stats.matches + S.heroMatches + DATA.stats.maps + S.heroMaps +
  DATA.stats.avgTicks + S.heroTicks + DATA.generatedAt.slice(0, 10);

// 每场都有独立分享页（match-NN.html），这里给出可点链接方便逐场传播
const links = document.getElementById('matchLinks');
const lead = document.createElement('span');
lead.textContent = S.shareLead;
links.appendChild(lead);
DATA.matches.forEach((m, i) => {
  const a = document.createElement('a');
  a.href = './match-' + String(i + 1).padStart(2, '0') + '.html';
  a.textContent = String(i + 1);
  links.appendChild(a);
});
select(0);
</script>
</body>
</html>
`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const fill = (page) => page.replace('__DATA__', JSON.stringify(data)).replace(/__PUBLIC_ORIGIN__/g, PUBLIC_ORIGIN);
fs.writeFileSync(OUT_FILE, fill(indexPage('en')), 'utf8');
const zhIndexFile = path.join(OUT_DIR, 'index.zh.html');
fs.writeFileSync(zhIndexFile, fill(indexPage('zh')), 'utf8');
if (fs.statSync(OUT_FILE).size === 0 || fs.statSync(zhIndexFile).size === 0) {
  throw new Error('index page empty');
}
fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '', 'utf8');
fs.copyFileSync(OG_IMAGE_SRC, path.join(OUT_DIR, 'og-image.png')); // 分享卡图片（GitHub Pages 同目录）
// 完整游戏截图（大厅 / 挖矿 / 副本），首页展示「不止是竞技场」
const SHOT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
for (const [src, out] of [
  ['02-lobby.png', 'shot-lobby.png'],
  ['04-mining.png', 'shot-mining.png'],
  ['05-dungeons.png', 'shot-dungeons.png'],
]) {
  const from = path.join(SHOT_DIR, src);
  if (!fs.existsSync(from)) throw new Error(`screenshot missing: ${src}`);
  fs.copyFileSync(from, path.join(OUT_DIR, out));
}
fs.writeFileSync(path.join(OUT_DIR, 'replay.js'), PLAYER_JS, 'utf8');

// 单场分享页：OG 卡按场次生成，便于把某一场直接发到社区
const pageFiles = [];
matches.forEach((m, i) => {
  const name = `match-${String(i + 1).padStart(2, '0')}.html`;
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, matchPage(i, m), 'utf8');
  pageFiles.push({ name, bytes: fs.statSync(file).size });
});

// 生成物自检：分享页必须带 OG 卡、回放数据与外链播放器，否则构建失败
for (const p of pageFiles) {
  const text = fs.readFileSync(path.join(OUT_DIR, p.name), 'utf8');
  if (!text.includes('property="og:url"') || !text.includes('window.__MATCH__ = {') || !text.includes('src="./replay.js"')) {
    throw new Error(`static demo page invalid: ${p.name}`);
  }
}
if (fs.statSync(path.join(OUT_DIR, 'replay.js')).size === 0) throw new Error('replay.js is empty');

// 检索入口：每一页都列进 sitemap，robots 指向它（静态站也能被搜索引擎收录）
const sitemapUrls = [
  `${PUBLIC_ORIGIN}/`,
  `${PUBLIC_ORIGIN}/index.zh.html`,
  `${PUBLIC_ORIGIN}/play.html`,
  `${PUBLIC_ORIGIN}/sandbox.html`,
  `${PUBLIC_ORIGIN}/benchmark.html`,
  `${PUBLIC_ORIGIN}/benchmark.zh.html`,
  ...matches.map((_, i) => matchPageUrl(i)),
];
fs.writeFileSync(
  path.join(OUT_DIR, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`,
  'utf8',
);
fs.writeFileSync(
  path.join(OUT_DIR, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`,
  'utf8',
);

// 浏览器试玩页 + Agent 沙盒：页面与打包产物一并复制（产物由 play:build 生成）
const browserDemos = [
  { bundle: 'play.js', page: 'play.html' },
  { bundle: 'sandbox.js', page: 'sandbox.html' },
];
for (const demo of browserDemos) {
  const bundleSrc = path.join(__dirname, '..', 'client', demo.bundle);
  if (!fs.existsSync(bundleSrc)) {
    throw new Error(`client/${demo.bundle} 不存在，请先运行 \`npm run play:build\``);
  }
  fs.copyFileSync(bundleSrc, path.join(OUT_DIR, demo.bundle));
  fs.writeFileSync(
    path.join(OUT_DIR, demo.page),
    fs.readFileSync(path.join(__dirname, '..', 'client', demo.page), 'utf8')
      .replace(/__PUBLIC_ORIGIN__/g, PUBLIC_ORIGIN),
    'utf8',
  );
}

console.log(JSON.stringify({
  out: OUT_FILE,
  matches: matches.length,
  framesTotal: matches.reduce((s, m) => s + m.frames.length, 0),
  standings,
  bytes: fs.statSync(OUT_FILE).size,
  zhBytes: fs.statSync(zhIndexFile).size,
  matchPages: pageFiles.length,
  matchPageBytes: pageFiles.map((p) => p.bytes),
}, null, 2));

store.close();
