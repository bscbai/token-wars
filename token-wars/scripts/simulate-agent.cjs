/**
 * 在命令行批量评估一个 agent 策略（与沙盒 Simulate 50 同一套规则）
 *
 * 用法：
 *   npm run simulate -- examples/sample-bot-node/decide.js
 *   npm run simulate -- ./my-agent.js --matches 100 --map data_mine
 *   npm run simulate -- ./my-agent.js --matches 20 --json
 *
 * 策略文件需导出 decide(state[, map])：
 *   module.exports = { decide }
 *   module.exports = decide
 * 返回动作对象（move / attack / skill / shield / idle），与线上 bot 协议一致。
 *
 * 规则：server/game/agentSimulator.js（复用协议校验、动作执行、内置 AI）；
 * 计分：胜率、平均 tick、非法动作、超时、决策耗时。
 */

'use strict';

const path = require('node:path');
const {
  simulateMatches, simulateMatchesBetween, DEFAULT_MAP,
} = require('../server/game/agentSimulator');
const { AI_MAPS } = require('../shared/arenaMaps');

function usage() {
  console.log(`Usage: node scripts/simulate-agent.cjs <policy.js> [options]

Options:
  --opponent <file>  pit two decide(state) policies against each other
  --matches <n>      matches to play (default 50, max 200)
  --map <id>         ${Object.keys(AI_MAPS).map((k) => AI_MAPS[k].id).join(' | ')}
  --deadline <ms>    per-decision deadline (default 500)
  --json             print the raw summary as JSON

The policy files must export decide(state[, map]) — e.g. examples/sample-bot-node/decide.js`);
}

function parseArgs(argv) {
  const args = { file: null, opponent: null, matches: 50, map: null, deadline: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--matches') args.matches = parseInt(argv[++i], 10);
    else if (a === '--map') args.map = argv[++i];
    else if (a === '--deadline') args.deadline = parseInt(argv[++i], 10);
    else if (a === '--opponent') args.opponent = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-') && !args.file) args.file = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isFinite(args.matches) || args.matches < 1) throw new Error('--matches must be a positive integer');
  if (args.deadline !== null && (!Number.isFinite(args.deadline) || args.deadline < 1)) {
    throw new Error('--deadline must be a positive integer');
  }
  return args;
}

function loadPolicy(file) {
  const resolved = path.resolve(file);
  let mod;
  try {
    mod = require(resolved);
  } catch (err) {
    throw new Error(`Cannot load ${resolved}: ${err.message}`);
  }
  const fn = typeof mod === 'function' ? mod
    : (mod && typeof mod.decide === 'function' ? mod.decide : null)
      || (mod && typeof mod.default === 'function' ? mod.default : null);
  if (!fn) throw new Error('Policy file must export a decide(state[, map]) function');
  // 示例策略的签名是 decide(state, map)；把 state.map 作为第二参传入对两者都安全
  return (state) => fn(state, state.map);
}

function findMap(id) {
  if (!id) return DEFAULT_MAP;
  const hit = Object.values(AI_MAPS).find((m) => m.id === id);
  if (!hit) throw new Error(`Unknown map "${id}". Available: ${Object.values(AI_MAPS).map((m) => m.id).join(', ')}`);
  return hit;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    usage();
    process.exit(2);
  }
  if (args.help || !args.file) {
    usage();
    process.exit(args.file ? 0 : 2);
  }

  let policy;
  let opponent = null;
  let map;
  try {
    policy = loadPolicy(args.file);
    if (args.opponent) opponent = loadPolicy(args.opponent);
    map = findMap(args.map);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (opponent) {
    const out = simulateMatchesBetween(policy, opponent, {
      count: args.matches,
      map,
      ...(args.deadline ? { deadlineMs: args.deadline } : {}),
    });
    if (args.json) {
      console.log(JSON.stringify({ file: args.file, opponent: args.opponent, map: map.id, ...out }, null, 2));
      return;
    }
    console.log(`A:      ${args.file}`);
    console.log(`B:      ${args.opponent}`);
    console.log(`Map:    ${map.name} (${map.id}) · ${out.matches} matches`);
    console.log(`Result: A ${out.aWins}W / B ${out.bWins}W / ${out.draws}D  (${out.winRateA}% / ${out.winRateB}%)`);
    console.log(`Parity: A invalid ${out.aInvalid} / timeouts ${out.aTimeouts} / errors ${out.aErrors}`
      + ` · B invalid ${out.bInvalid} / timeouts ${out.bTimeouts} / errors ${out.bErrors}`);
    console.log(`Length: avg ${out.avgTicks} ticks · wall ${out.wallMs}ms`);
    return;
  }

  const out = simulateMatches(policy, {
    count: args.matches,
    map,
    ...(args.deadline ? { deadlineMs: args.deadline } : {}),
  });

  if (args.json) {
    console.log(JSON.stringify({ file: args.file, map: map.id, ...out }, null, 2));
    return;
  }

  console.log(`Agent:  ${args.file}`);
  console.log(`Map:    ${map.name} (${map.id}) · ${out.matches} matches`);
  console.log(`Result: ${out.wins}W / ${out.losses}L / ${out.draws}D  (${out.winRate}% win)`);
  console.log(`Length: avg ${out.avgTicks} ticks`);
  console.log(`Parity: invalid ${out.invalid} · timeouts ${out.timeouts} · errors ${out.errors}`);
  console.log(`Timing: decision avg ${out.avgDecisionMs}ms / max ${out.maxDecisionMs}ms · wall ${out.wallMs}ms`);
}

main();
