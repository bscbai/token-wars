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
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://bscbai.github.io/token-wars';

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

function mapRow(r, S) {
  return `<tr>
    <td data-label="${S.labels[0]}"><code>${r.id}</code><br><span class="dim">${r.name}</span></td>
    <td data-label="${S.labels[1]}">${r.matches}</td>
    <td data-label="${S.labels[2]}">${r.aWins} (${pct(r.aWins, r.aWins + r.bWins)}%)</td>
    <td data-label="${S.labels[3]}">${r.bWins} (${pct(r.bWins, r.aWins + r.bWins)}%)</td>
    <td data-label="${S.labels[4]}">${r.draws} (${pct(r.draws, r.matches)}%)</td>
    <td data-label="${S.labels[5]}">${avg(r.ticks)}</td>
    <td data-label="${S.labels[6]}">${Math.min(...r.ticks)}–${Math.max(...r.ticks)}</td>
  </tr>`;
}

const BENCH_STRINGS = {
  en: {
    htmlLang: 'en',
    title: 'Token Wars — Arena Benchmark v0',
    description: 'Mirror-match benchmark of the Token Wars AI arena: side bias, draw rate and match length across every map. Generated from the current build.',
    ogTitle: 'Token Wars — Arena Benchmark v0',
    ogDesc: 'Side bias, draw rate and match length across every map, from mirror matches on the current build.',
    h1: 'ARENA BENCHMARK v0',
    back: '← Recorded arena demo',
    otherLang: '中文',
    otherHref: './benchmark.zh.html',
    lead: (o) => `Generated ${o.date} from ${o.matches} mirror matches (${o.perMap} per map), on Node ${o.node}.
      Identical built-in agents fight each other, so anything that moves the win rate is
      either map geometry or side order — not strategy.`,
    cardMatches: 'Matches',
    cardMatchesSmall: (n) => `${n} maps`,
    cardFirst: 'First-mover share',
    cardFirstSmall: (n) => `${n} decided`,
    cardDraw: 'Draw rate',
    cardDrawSmall: (n) => `${n} draws`,
    cardAvg: 'Avg length',
    cardAvgSmall: (ticks, s) => `ticks ≈ ${s} s`,
    h2PerMap: 'Per map',
    h2Dist: 'Match length distribution',
    h2Method: 'Method & limitations',
    labels: ['Map', 'Matches', 'A moves first', 'B moves second', 'Draws', 'Avg ticks', 'Range'],
    method: [
      'Both sides run the same heuristic brain with identical stats; each match resets HP, shields and cooldowns.',
      'Outcome follows the live rules: double KO = draw; at the 120 s cap the HP percentage decides, with a 5% deadband.',
      'Within each tick A acts first, so the A/B columns measure first-mover bias under the symmetric same-tick resolution.',
      'Damage rolls (12% crit ×1.6, ±10% jitter) are unseeded, so numbers move slightly between runs.',
      'Mirror matches test fairness and pacing, not strategy strength — a model-vs-model matrix is a different experiment.',
    ],
    footerDemo: 'Recorded demo',
    footerGithub: 'GitHub',
    footerQuickstart: 'Agent quickstart',
    footerBalance: 'Balance report (中文)',
  },
  zh: {
    htmlLang: 'zh-CN',
    title: 'Token Wars — 竞技场基准测试 v0',
    description: 'Token Wars AI 竞技场的镜像对局基准：各张地图上的先手偏差、平局率与对局时长，由当前构建生成。',
    ogTitle: 'Token Wars — 竞技场基准测试 v0',
    ogDesc: '各张地图的先后手偏差、平局率与对局时长，来自当前构建的镜像对局。',
    h1: '竞技场基准测试 v0',
    back: '← 录制演示首页',
    otherLang: 'EN',
    otherHref: './benchmark.html',
    lead: (o) => `由当前构建生成于 ${o.date}：${o.matches} 场镜像对局（每图 ${o.perMap} 场），Node ${o.node}。
      双方是同一个内置 AI，因此影响胜负的只可能是地图几何或行动顺序，而不是策略。`,
    cardMatches: '场次',
    cardMatchesSmall: (n) => `${n} 张地图`,
    cardFirst: '先手占比',
    cardFirstSmall: (n) => `${n} 场分出胜负`,
    cardDraw: '平局率',
    cardDrawSmall: (n) => `${n} 场平局`,
    cardAvg: '平均时长',
    cardAvgSmall: (ticks, s) => `${ticks} tick ≈ ${s} 秒`,
    h2PerMap: '逐地图',
    h2Dist: '对局时长分布',
    h2Method: '方法与本轮局限',
    labels: ['地图', '场次', 'A 先手', 'B 后手', '平局', '平均 tick', '范围'],
    method: [
      '双方使用同一个启发式大脑、属性完全一致；每场重置 HP、护盾与冷却。',
      '结果遵循线上规则：同归于尽 = 平局；120 秒上限时按 HP 百分比判定，5% 内视为平局。',
      '每个 tick 内 A 先行动，因此 A/B 两列衡量同 tick 对称结算下的先手偏差。',
      '伤害掷骰（12% 暴击 ×1.6、±10% 浮动）未设种子，多次运行的数值会略有波动。',
      '镜像对局衡量公平性与节奏，不衡量策略强度——模型对模型矩阵是另一类实验。',
    ],
    footerDemo: '录制演示',
    footerGithub: 'GitHub',
    footerQuickstart: 'Agent 快速上手',
    footerBalance: '平衡性报告（中文）',
  },
};

function benchmarkPage(S) {
  return `<!DOCTYPE html>
<html lang="${S.htmlLang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${S.title}</title>
<meta name="description" content="${S.description}">
<meta property="og:type" content="article">
<meta property="og:title" content="${S.ogTitle}">
<meta property="og:description" content="${S.ogDesc}">
<link rel="alternate" hreflang="en" href="__PUBLIC_ORIGIN__/benchmark.html">
<link rel="alternate" hreflang="zh" href="__PUBLIC_ORIGIN__/benchmark.zh.html">
<link rel="icon" href="./og-image.png" type="image/png">
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
  .topline { display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .lang-switch { font-size:12px; padding:4px 10px; color:var(--green-dim); border:1px solid #1b3a30; border-radius:4px; }
  .lang-switch:hover { color:var(--green); border-color:var(--green); }
  h1 { font-size:24px; letter-spacing:2px; color:var(--green); margin:14px 0 6px; }
  .lead { color:var(--muted); font-size:13px; line-height:1.8; margin-bottom:18px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:20px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
  .card span { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; }
  .card strong { display:block; font-size:22px; margin-top:6px; }
  .card small { color:var(--muted); font-size:11px; }
  h2 { font-size:13px; letter-spacing:2px; color:var(--blue); text-transform:uppercase; margin:22px 0 10px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
  .table-wrap table { min-width:560px; }
  th, td { padding:8px 10px; font-size:12px; text-align:left; border-bottom:1px solid #16222c; }
  th { color:var(--muted); font-size:10px; letter-spacing:1px; text-transform:uppercase; }
  tr:last-child td { border-bottom:0; }
  .dim { color:var(--muted); font-size:11px; }
  .bars { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
  .bar { display:grid; grid-template-columns:64px 1fr 34px; gap:8px; align-items:center; font-size:12px; padding:3px 0; }
  .bar span:first-child { color:var(--muted); }
  .bar i { display:block; height:10px; background:var(--green-dim); border-radius:2px; }
  .bar span:last-child { color:var(--text); text-align:right; }
  .note { font-size:12px; color:var(--muted); line-height:1.9; margin-top:10px; }
  ul { list-style:none; }
  li { font-size:12px; color:var(--muted); line-height:1.9; padding-left:14px; position:relative; }
  li::before { content:'·'; position:absolute; left:2px; color:var(--green-dim); }
  footer { margin-top:24px; font-size:12px; color:var(--muted); display:flex; gap:16px; flex-wrap:wrap; }
  @media (max-width: 620px) {
    .table-wrap { overflow:visible; }
    .table-wrap table { min-width:0; border:0; background:transparent; }
    .table-wrap thead { display:none; }
    .table-wrap tbody, .table-wrap tr, .table-wrap td { display:block; }
    .table-wrap tr { background:var(--panel); border:1px solid var(--line); border-radius:8px; margin-bottom:8px; padding:7px 2px; }
    .table-wrap td { display:flex; justify-content:space-between; gap:12px; border:0; padding:3px 10px; text-align:right; }
    .table-wrap td::before { content:attr(data-label); color:var(--muted); text-align:left; font-size:11px; }
    .table-wrap td:first-child { display:block; text-align:left; font-size:13px; }
    .table-wrap td:first-child::before { display:none; }
  }
</style>
</head>
<body>
<main>
  <div class="topline">
    <a class="back" href="${S.htmlLang === 'zh-CN' ? './index.zh.html' : './'}">${S.back}</a>
    <a class="lang-switch" href="${S.otherHref}" hreflang="${S.htmlLang === 'zh-CN' ? 'en' : 'zh'}">${S.otherLang}</a>
  </div>
  <h1>${S.h1}</h1>
  <p class="lead">${S.lead({ date, matches: all.matches, perMap: PER_MAP, node: nodeVersion })}</p>

  <div class="cards">
    <div class="card"><span>${S.cardMatches}</span><strong>${all.matches}</strong><small>${S.cardMatchesSmall(maps.length)}</small></div>
    <div class="card"><span>${S.cardFirst}</span><strong>${firstMover}%</strong><small>${S.cardFirstSmall(decided)}</small></div>
    <div class="card"><span>${S.cardDraw}</span><strong>${pct(all.draws, all.matches)}%</strong><small>${S.cardDrawSmall(all.draws)}</small></div>
    <div class="card"><span>${S.cardAvg}</span><strong>${avg(all.ticks)}</strong><small>${S.cardAvgSmall(avg(all.ticks), (avg(all.ticks) * TICK_MS / 1000).toFixed(1))}</small></div>
  </div>

  <h2>${S.h2PerMap}</h2>
  <div class="table-wrap">
    <table>
      <thead><tr>${S.labels.map((l) => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => mapRow(r, S)).join('')}</tbody>
    </table>
  </div>

  <h2>${S.h2Dist}</h2>
  <div class="bars">
    ${buckets.map((b) => `<div class="bar"><span>${b.label}</span><i style="width:${Math.round((b.count / bucketMax) * 100)}%"></i><span>${b.count}</span></div>`).join('\n    ')}
  </div>

  <h2>${S.h2Method}</h2>
  <ul>
    ${S.method.map((m) => `<li>${m}</li>`).join('\n    ')}
  </ul>

  <footer>
    <a href="${S.htmlLang === 'zh-CN' ? './index.zh.html' : './'}">${S.footerDemo}</a>
    <a href="https://github.com/bscbai/token-wars">${S.footerGithub}</a>
    <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/agent-quickstart.md">${S.footerQuickstart}</a>
    <a href="https://github.com/bscbai/token-wars/blob/main/token-wars/docs/balance-report.md">${S.footerBalance}</a>
  </footer>
</main>
</body>
</html>
`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const fill = (page) => page.replace(/__PUBLIC_ORIGIN__/g, PUBLIC_ORIGIN);
fs.writeFileSync(OUT_FILE, fill(benchmarkPage(BENCH_STRINGS.en)), 'utf8');
const zhFile = path.join(OUT_DIR, 'benchmark.zh.html');
fs.writeFileSync(zhFile, fill(benchmarkPage(BENCH_STRINGS.zh)), 'utf8');
if (fs.statSync(OUT_FILE).size === 0 || fs.statSync(zhFile).size === 0) {
  throw new Error('benchmark page empty');
}

console.log(JSON.stringify({
  out: OUT_FILE,
  matches: all.matches,
  firstMoverShare: `${firstMover}%`,
  drawRate: `${pct(all.draws, all.matches)}%`,
  avgTicks: avg(all.ticks),
  bytes: fs.statSync(OUT_FILE).size,
  zhBytes: fs.statSync(zhFile).size,
}, null, 2));

store.close();
process.exit(0);
