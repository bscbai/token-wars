/**
 * 生成公开的平衡性报告页（demo-site/benchmark.html）
 *
 * 镜像对局（同一个内置 AI 对打）用来回答两个问题：地图/先手是否公平、对局多长。
 * 输出纯静态 HTML，随 demo-site 一起发布到 GitHub Pages，可单独分享。
 *
 * 用法：node scripts/build-benchmark-page.cjs [每图场次=40]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { Store } = require('../server/data/Store');
const Player = require('../server/models/Player');
const { AIAgent } = require('../server/models/AIAgent');
const AIArenaManager = require('../server/game/AIArenaManager');

const PER_MAP = Math.max(5, parseInt(process.argv[2], 10) || 40);
const OUT_DIR = path.join(__dirname, '..', 'demo-site');
const OUT_FILE = path.join(OUT_DIR, 'benchmark.html');

const store = new Store(':memory:', { migrate: false });
const owner = new Player('benchmark-owner');
store.addPlayer(owner);
const mgr = new AIArenaManager({ emit() {}, of() { return {}; } }, store, {});
mgr.tryMatch = () => {};

const maps = Object.values(AIArenaManager.AI_MAPS);

function outcomeOf(a, b) {
  if (!a.alive && !b.alive) return 'draw';
  if (!b.alive) return 'A';
  if (!a.alive) return 'B';
  const pa = a.hp / a.maxHp;
  const pb = b.hp / b.maxHp;
  if (Math.abs(pa - pb) < 0.05) return 'draw';
  return pa > pb ? 'A' : 'B';
}

const rows = [];
const all = { matches: 0, aWins: 0, bWins: 0, draws: 0, ticks: [] };

for (const map of maps) {
  const row = { id: map.id, name: map.name, matches: 0, aWins: 0, bWins: 0, draws: 0, ticks: [] };
  for (let i = 0; i < PER_MAP; i++) {
    const a = new AIAgent(owner.id, [], 'Bench-A');
    const b = new AIAgent(owner.id, [], 'Bench-B');
    mgr.startMatch(a, b, map);
    const entry = mgr.matchHistory[mgr.matchHistory.length - 1];
    const result = outcomeOf(a, b);
    row.matches++; row.ticks.push(entry.totalTicks);
    all.matches++; all.ticks.push(entry.totalTicks);
    if (result === 'A') { row.aWins++; all.aWins++; }
    else if (result === 'B') { row.bWins++; all.bWins++; }
    else { row.draws++; all.draws++; }
  }
  rows.push(row);
}

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const avg = (list) => Math.round(list.reduce((s, n) => s + n, 0) / list.length);
const decided = all.aWins + all.bWins;
const firstMover = pct(all.aWins, decided);

const BUCKETS = [
  { label: '≤ 150', test: (t) => t <= 150 },
  { label: '151–180', test: (t) => t > 150 && t <= 180 },
  { label: '181–210', test: (t) => t > 180 && t <= 210 },
  { label: '211–240', test: (t) => t > 210 && t <= 240 },
  { label: '> 240', test: (t) => t > 240 },
];
const buckets = BUCKETS.map((b) => ({
  label: b.label,
  count: all.ticks.filter(b.test).length,
}));
const bucketMax = Math.max(...buckets.map((b) => b.count), 1);

const date = new Date().toISOString().slice(0, 10);
const nodeVersion = process.version;
const TICK_MS = 50;

function mapRow(r) {
  return `<tr>
    <td><code>${r.id}</code><br><span class="dim">${r.name}</span></td>
    <td>${r.matches}</td>
    <td>${r.aWins} (${pct(r.aWins, r.aWins + r.bWins)}%)</td>
    <td>${r.bWins} (${pct(r.bWins, r.aWins + r.bWins)}%)</td>
    <td>${r.draws} (${pct(r.draws, r.matches)}%)</td>
    <td>${avg(r.ticks)}</td>
    <td>${Math.min(...r.ticks)}–${Math.max(...r.ticks)}</td>
  </tr>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Token Wars — Arena Benchmark v0</title>
<meta name="description" content="Mirror-match benchmark of the Token Wars AI arena: side bias, draw rate and match length across every map. Generated from the current build.">
<meta property="og:type" content="article">
<meta property="og:title" content="Token Wars — Arena Benchmark v0">
<meta property="og:description" content="Side bias, draw rate and match length across every map, from mirror matches on the current build.">
<style>
  :root { --bg:#0a0a1a; --panel:#0f1024; --line:#1d2b3a; --green:#00ff88; --green-dim:#00aa77;
          --blue:#88aaff; --text:#cfe8dd; --muted:#5f7a71; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { min-height:100vh; color:var(--text); font-family:'Courier New',ui-monospace,monospace;
         padding:32px 22px 48px;
         background:
           linear-gradient(rgba(0,255,136,.04) 1px, transparent 1px) 0 0/40px 40px,
           linear-gradient(90deg, rgba(0,255,136,.04) 1px, transparent 1px) 0 0/40px 40px, var(--bg); }
  main { max-width:900px; margin:0 auto; }
  a { color:var(--green-dim); text-decoration:none; }
  a:hover { color:var(--green); }
  .back { font-size:12px; }
  h1 { font-size:24px; letter-spacing:2px; color:var(--green); margin:14px 0 6px; }
  .lead { color:var(--muted); font-size:13px; line-height:1.8; margin-bottom:18px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:20px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .card span { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; }
  .card strong { display:block; font-size:22px; margin-top:6px; }
  .card small { color:var(--muted); font-size:11px; }
  h2 { font-size:13px; letter-spacing:2px; color:var(--blue); text-transform:uppercase; margin:22px 0 10px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  th, td { padding:8px 10px; font-size:12px; text-align:left; border-bottom:1px solid #16222c; }
  th { color:var(--muted); font-size:10px; letter-spacing:1px; text-transform:uppercase; }
  tr:last-child td { border-bottom:0; }
  .dim { color:var(--muted); font-size:11px; }
  .bars { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
  .bar { display:flex; align-items:center; gap:10px; font-size:12px; padding:3px 0; }
  .bar span:first-child { width:72px; color:var(--muted); }
  .bar i { display:block; height:10px; background:var(--green-dim); border-radius:2px; }
  .bar span:last-child { color:var(--text); }
  .note { font-size:12px; color:var(--muted); line-height:1.9; margin-top:10px; }
  ul { list-style:none; }
  li { font-size:12px; color:var(--muted); line-height:1.9; padding-left:14px; position:relative; }
  li::before { content:'·'; position:absolute; left:2px; color:var(--green-dim); }
  footer { margin-top:24px; font-size:12px; color:var(--muted); display:flex; gap:16px; flex-wrap:wrap; }
</style>
</head>
<body>
<main>
  <a class="back" href="./">← Recorded arena demo</a>
  <h1>ARENA BENCHMARK v0</h1>
  <p class="lead">
    Generated ${date} from ${all.matches} mirror matches (${PER_MAP} per map), on Node ${nodeVersion}.
    Identical built-in agents fight each other, so anything that moves the win rate is
    either map geometry or side order — not strategy.
  </p>

  <div class="cards">
    <div class="card"><span>Matches</span><strong>${all.matches}</strong><small>${maps.length} maps</small></div>
    <div class="card"><span>First-mover share</span><strong>${firstMover}%</strong><small>${decided} decided</small></div>
    <div class="card"><span>Draw rate</span><strong>${pct(all.draws, all.matches)}%</strong><small>${all.draws} draws</small></div>
    <div class="card"><span>Avg length</span><strong>${avg(all.ticks)}</strong><small>ticks ≈ ${(avg(all.ticks) * TICK_MS / 1000).toFixed(1)} s</small></div>
  </div>

  <h2>Per map</h2>
  <table>
    <thead><tr><th>Map</th><th>Matches</th><th>A moves first</th><th>B moves second</th><th>Draws</th><th>Avg ticks</th><th>Range</th></tr></thead>
    <tbody>${rows.map(mapRow).join('')}</tbody>
  </table>

  <h2>Match length distribution</h2>
  <div class="bars">
    ${buckets.map((b) => `<div class="bar"><span>${b.label}</span><i style="width:${Math.round((b.count / bucketMax) * 360)}px"></i><span>${b.count}</span></div>`).join('\n    ')}
  </div>

  <h2>Method &amp; limitations</h2>
  <ul>
    <li>Both sides run the same heuristic brain with identical stats; each match resets HP, shields and cooldowns.</li>
    <li>Outcome follows the live rules: double KO = draw; at the 120 s cap the HP percentage decides, with a 5% deadband.</li>
    <li>Within each tick A acts first, so the A/B columns measure first-mover bias under the symmetric same-tick resolution.</li>
    <li>Damage rolls (12% crit ×1.6, ±10% jitter) are unseeded, so numbers move slightly between runs.</li>
    <li>Mirror matches test fairness and pacing, not strategy strength — a model-vs-model matrix is a different experiment.</li>
  </ul>

  <footer>
    <a href="./">Recorded demo</a>
    <a href="https://github.com/bscbai/token-wars">GitHub</a>
    <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">Agent quickstart</a>
    <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/balance-report.md">Balance report (中文)</a>
  </footer>
</main>
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');

console.log(JSON.stringify({
  out: OUT_FILE,
  matches: all.matches,
  firstMoverShare: `${firstMover}%`,
  drawRate: `${pct(all.draws, all.matches)}%`,
  avgTicks: avg(all.ticks),
  bytes: fs.statSync(OUT_FILE).size,
}, null, 2));

store.close();
process.exit(0);
