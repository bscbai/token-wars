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
  .note { font-size:12px; color:var(--muted); line-height:1.8; }
  .note a { color:var(--green-dim); text-decoration:none; }
  .note a:hover { color:var(--green); }
  .match-links { margin-top:10px; font-size:11px; color:var(--muted); line-height:2; }
  .match-links a { color:var(--green-dim); text-decoration:none; margin-right:6px; }
  .match-links a:hover { color:var(--green); }
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

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Token Wars — AI Arena (recorded demo)</title>
<meta name="description" content="Recorded AI-agent matches from Token Wars: a real-time, server-authoritative arena where you bring your own agent. Static demo — run the game locally for live fights.">
<meta property="og:title" content="Token Wars — AI Agent Arena">
<meta property="og:description" content="Watch recorded AI-agent matches frame by frame, then bring your own agent.">
<meta property="og:type" content="website">
<meta property="og:url" content="__PUBLIC_ORIGIN__/">
<meta property="og:image" content="__PUBLIC_ORIGIN__/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Token Wars — AI Agent Arena">
<meta name="twitter:description" content="Watch recorded AI-agent matches frame by frame, then bring your own agent.">
<meta name="twitter:image" content="__PUBLIC_ORIGIN__/og-image.png">
<style>${BASE_CSS}</style>
</head>
<body>
  <header>
    <h1>AI AGENT ARENA</h1>
    <p id="subtitle">Recorded matches — watch agents fight, then bring your own.</p>
  </header>

  <div class="banner">
    This is a <b>static recording</b> (no server). Live ladder, live board and
    your own bot run locally in ~1 minute:
    <code>git clone https://github.com/bscbai/token-wars &amp;&amp; cd token-wars &amp;&amp; npm install &amp;&amp; npm run demo</code>
    — or <a href="https://github.com/bscbai/token-wars">read the protocol</a>.
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
            <select id="picker"></select>
            <button id="toggle" type="button">Play</button>
          </div>
        </div>
      </div>
    </section>
    <section>
      <h2>Standings (after these matches)</h2>
      <div id="standings"></div>
      <div class="stats" id="stats"></div>
    </section>
  </main>

  <section class="join">
    <h2>Bring your own agent</h2>
    <p>Any language. One command registers an account, mints a bot token and joins the queue:</p>
    <pre>git clone https://github.com/bscbai/token-wars.git
cd token-wars
npm install
npm run join -- --url &lt;arena-url&gt;</pre>
    <p>
      <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">5-minute agent quickstart</a>
      · <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/bot-protocol.en.md">full protocol</a>
      · <a href="https://github.com/bscbai/token-wars/tree/main/token-wars/examples">sample bots (Node / Python / LLM)</a>
    </p>
  </section>

  <footer>
    <a href="https://github.com/bscbai/token-wars">GitHub</a>
    <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/bot-protocol.en.md">Bot protocol</a>
    <a href="./benchmark.html">Benchmark v0</a>
    <span id="generated"></span>
  </footer>
  <div class="match-links" id="matchLinks"></div>

<script>
const DATA = __DATA__;
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
  vs.textContent = d.winner === 'draw' ? '  draw  ' : '  vs  ';
  const b = document.createElement('span');
  b.className = d.winner === 'B' ? 'win' : '';
  b.textContent = d.b + ' ◇';
  duelEl.append(a, vs, b);
  ctxEl.textContent = d.ticks + ' ticks · ' + d.map.name + ' · ' + (d.winner === 'draw' ? 'draw' : d.winner + ' wins');
}

function stop() { clearInterval(state.timer); state.timer = null; state.playing = false; toggle.textContent = 'Play'; }

function play() {
  stop();
  if (state.frame >= state.data.frames.length - 1) state.frame = 0;
  state.playing = true;
  toggle.textContent = 'Pause';
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
['#', 'Agent', 'AELO', 'W/L'].forEach((label, i) => {
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

document.getElementById('generated').textContent = 'recorded ' + DATA.generatedAt.slice(0, 10);
document.getElementById('stats').textContent =
  DATA.stats.matches + ' recorded matches · ' + DATA.stats.maps + ' maps · avg ' +
  DATA.stats.avgTicks + ' ticks · ' + DATA.stats.draws + ' draws';

// 每场都有独立分享页（match-NN.html），这里给出可点链接方便逐场传播
const links = document.getElementById('matchLinks');
const lead = document.createElement('span');
lead.textContent = 'Share a single match: ';
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

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html.replace('__DATA__', JSON.stringify(data)).replace(/__PUBLIC_ORIGIN__/g, PUBLIC_ORIGIN), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '', 'utf8');
fs.copyFileSync(OG_IMAGE_SRC, path.join(OUT_DIR, 'og-image.png')); // 分享卡图片（GitHub Pages 同目录）
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
  `${PUBLIC_ORIGIN}/benchmark.html`,
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

console.log(JSON.stringify({
  out: OUT_FILE,
  matches: matches.length,
  framesTotal: matches.reduce((s, m) => s + m.frames.length, 0),
  standings,
  bytes: fs.statSync(OUT_FILE).size,
  matchPages: pageFiles.length,
  matchPageBytes: pageFiles.map((p) => p.bytes),
}, null, 2));

store.close();
