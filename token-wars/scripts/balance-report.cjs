/**
 * 平衡性报告：镜像对局批量采样
 *
 * 同一套内置 AI（BuiltinBrain）在每张地图上对打 N 场，统计先手/后手胜率、
 * 平局率与对局长度，用来回答「地图是否偏向某一方」「对局是否过长」。
 * 结果用于 docs/balance-report.md；地图或伤害公式改动后重跑即可。
 *
 * 用法：
 *   node scripts/balance-report.cjs          # 每张图 40 场
 *   node scripts/balance-report.cjs 100      # 每张图 100 场
 *
 * 输出：Markdown 表格到 stdout（可直接贴进报告）。
 */

'use strict';

const { Store } = require('../server/data/Store');
const Player = require('../server/models/Player');
const { AIAgent } = require('../server/models/AIAgent');
const AIArenaManager = require('../server/game/AIArenaManager');

const perMap = Math.max(1, parseInt(process.argv[2], 10) || 40);
const maps = Object.values(AIArenaManager.AI_MAPS);

const store = new Store(':memory:', { migrate: false });
const owner = new Player('balance-probe');
store.addPlayer(owner);

const mgr = new AIArenaManager({ emit() {}, of() { return {}; } }, store, {});
// resolveMatch 结束后会 setTimeout 重排双方；报告脚本不需要再开新对局
mgr.tryMatch = () => {};

function outcomeOf(a, b) {
  if (!a.alive && !b.alive) return 'draw';
  if (!b.alive) return 'A';
  if (!a.alive) return 'B';
  const pa = a.hp / a.maxHp;
  const pb = b.hp / b.maxHp;
  if (Math.abs(pa - pb) < 0.05) return 'draw';
  return pa > pb ? 'A' : 'B';
}

const stats = [];
const all = { matches: 0, aWins: 0, bWins: 0, draws: 0, ticks: [] };

for (const map of maps) {
  const row = { id: map.id, name: map.name, matches: 0, aWins: 0, bWins: 0, draws: 0, ticks: [] };
  for (let i = 0; i < perMap; i++) {
    const a = new AIAgent(owner.id, [], 'Probe-A');
    const b = new AIAgent(owner.id, [], 'Probe-B');
    mgr.startMatch(a, b, map); // 内部会重置 HP/位置并同步模拟、结算

    const result = outcomeOf(a, b);
    const ticks = mgr.matchHistory[mgr.matchHistory.length - 1].totalTicks;

    row.matches++;
    row.ticks.push(ticks);
    all.matches++;
    all.ticks.push(ticks);
    if (result === 'A') { row.aWins++; all.aWins++; }
    else if (result === 'B') { row.bWins++; all.bWins++; }
    else { row.draws++; all.draws++; }
  }
  stats.push(row);
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');
const avg = (list) => Math.round(list.reduce((s, n) => s + n, 0) / list.length);

function line(label, r) {
  const decided = r.aWins + r.bWins;
  return `| ${label} | ${r.matches} | ${r.aWins} (${pct(r.aWins, decided)}) | ${r.bWins} (${pct(r.bWins, decided)}) | ${r.draws} (${pct(r.draws, r.matches)}) | ${avg(r.ticks)} | ${Math.min(...r.ticks)} | ${Math.max(...r.ticks)} |`;
}

console.log(`Samples per map: ${perMap} (mirror match: identical agents, A moves first)\n`);
console.log('| Map | Matches | A-first wins | B-second wins | Draws | Avg ticks | Min | Max |');
console.log('|-----|---------|--------------|---------------|-------|-----------|-----|-----|');
for (const row of stats) console.log(line(`${row.name} (\`${row.id}\`)`, row));
console.log(line('**All maps**', all));

const decided = all.aWins + all.bWins;
console.log(`\nFirst-mover win share (decided matches): ${pct(all.aWins, decided)}`);
console.log(`Draw rate: ${pct(all.draws, all.matches)}`);

store.close();
process.exit(0);
