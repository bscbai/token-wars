/**
 * 无渲染批量对局模拟器（浏览器沙盒的「模拟 N 场」与服务端复用）
 *
 * 目的：让 agent 作者不靠肉眼看动画就能评估策略胜率。规则与线上完全一致：
 *   - 协议校验：BotProtocol.validateActionMessage
 *   - 动作执行：agentActionRules.executeAgentAction
 *   - 对手：BuiltinBrain
 *   - 单场 120s / 500ms 决策截止 / 连续 3 次超时或 >10 次非法动作判负
 *
 * 策略是同步函数 (state) => action；异常直接判该场负并记入 errors。
 */

'use strict';

const { AIAgent } = require('../models/AIAgent');
const BuiltinBrain = require('./BuiltinBrain');
const { executeAgentAction } = require('./agentActionRules');
const { validateActionMessage } = require('./BotProtocol');
const { AI_MAPS } = require('../../shared/arenaMaps');
const { AI_ARENA_TIMING } = require('../../shared/constants');

const TICK_MS = AI_ARENA_TIMING.MATCH_TICK_MS;
const MAX_MS = AI_ARENA_TIMING.MATCH_MAX_TIME_MS;
const DEADLINE_MS = 500;
const TIMEOUT_LIMIT = 3;
const VIOLATION_LIMIT = 10;
const PROTOCOL_VERSION = 1;
const DEFAULT_MAP = AI_MAPS.DATA_MINE;

function isWalkableOn(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return !map.obstacles.some(([ox, oy]) => ox === x && oy === y);
}

function buildState(you, enemy, tick, now, elapsed, map, maxMs) {
  return {
    matchId: 'sim',
    tick,
    timeLeftMs: Math.max(0, maxMs - elapsed),
    you: {
      x: you.x, y: you.y, hp: you.hp, maxHp: you.maxHp,
      shield: you.shield, shieldActive: you.shieldActive,
      skills: you.skills.map((s) => ({
        id: s.id,
        cooldownRemaining: Math.max(0, s.cooldown - (now - s.lastUsed)),
      })),
    },
    enemy: { x: enemy.x, y: enemy.y, hp: enemy.hp, maxHp: enemy.maxHp, visible: true },
    tokens: [],
    map: { width: map.width, height: map.height, obstacles: map.obstacles },
  };
}

/**
 * 应用每日挑战 / 自定义规则到模拟双方（与 play 页 applyDailyRules 同语义）。
 * @param {AIAgent} you
 * @param {AIAgent} enemy
 * @param {{ hp?:number, youHp?:number, enemyShield?:boolean, enemyAtkMult?:number }} [rules]
 */
function applySimRules(you, enemy, rules = {}) {
  if (!rules) return;
  if (rules.hp) {
    you.maxHp = rules.hp;
    you.hp = rules.hp;
    enemy.maxHp = rules.hp;
    enemy.hp = rules.hp;
  }
  if (rules.youHp) {
    you.maxHp = rules.youHp;
    you.hp = rules.youHp;
  }
  if (rules.enemyShield) enemy.enableShield(enemy.shieldMax);
  if (rules.enemyAtkMult) enemy.baseAtk = Math.round(enemy.baseAtk * rules.enemyAtkMult);
}

/**
 * 跑一场无渲染对局。
 * @param {(state: object) => object} policy
 * @param {{ map?: object, deadlineMs?: number, maxMs?: number,
 *           rules?: { hp?:number, youHp?:number, enemyShield?:boolean, enemyAtkMult?:number } }} [options]
 * @returns {{ result:'win'|'loss'|'draw', ticks:number, reason:string,
 *             invalid:number, timeouts:number, decisions:number,
 *             error?:string, avgDecisionMs:number, maxDecisionMs:number }}
 */
function simulateMatch(policy, options = {}) {
  const map = options.map || DEFAULT_MAP;
  const deadlineMs = options.deadlineMs || DEADLINE_MS;
  const maxMs = options.maxMs || (options.rules && options.rules.maxMs) || MAX_MS;
  const brain = new BuiltinBrain();

  const you = new AIAgent('sim-player', [], 'Policy');
  you.x = map.spawnA.x;
  you.y = map.spawnA.y;
  const enemy = new AIAgent('sim-house', [], 'Gatekeeper');
  enemy.x = map.spawnB.x;
  enemy.y = map.spawnB.y;
  applySimRules(you, enemy, options.rules);

  const isWalkable = (x, y) => isWalkableOn(map, x, y);
  const stats = { invalid: 0, timeouts: 0, consecutiveTimeouts: 0, decisions: 0, totalMs: 0, maxMs: 0 };

  const finish = (result, reason, extra = {}) => ({
    result,
    reason,
    ticks: tick,
    invalid: stats.invalid,
    timeouts: stats.timeouts,
    decisions: stats.decisions,
    avgDecisionMs: stats.decisions ? Math.round((stats.totalMs / stats.decisions) * 100) / 100 : 0,
    maxDecisionMs: Math.round(stats.maxMs * 100) / 100,
    ...extra,
  });

  let tick = 0;
  let elapsed = 0;
  let result = null;

  while (elapsed < maxMs && !result) {
    tick++;
    elapsed = tick * TICK_MS;
    const now = 1_000_000 + elapsed;
    const canAct = [you.alive, enemy.alive];

    if (canAct[0]) {
      you.tickShield();
      const state = buildState(you, enemy, tick, now, elapsed, map, maxMs);
      const started = performance.now();
      let action;
      try {
        action = policy(structuredClone(state));
      } catch (err) {
        result = finish('loss', 'decide() threw', { error: err.message });
        break;
      }
      const decidedIn = performance.now() - started;
      stats.decisions++;
      stats.totalMs += decidedIn;
      stats.maxMs = Math.max(stats.maxMs, decidedIn);

      if (decidedIn > deadlineMs) {
        stats.timeouts++;
        stats.consecutiveTimeouts++;
      } else {
        stats.consecutiveTimeouts = 0;
        const msg = {
          protocolVersion: PROTOCOL_VERSION,
          matchId: 'sim',
          tick,
          action,
          tokensUsed: 0,
        };
        const validation = validateActionMessage(msg, { width: map.width, height: map.height });
        if (!validation.valid) {
          stats.invalid++;
        } else {
          const applied = executeAgentAction(you, enemy, validation.action, { now, map, isWalkable });
          if (applied.invalid) stats.invalid++;
        }
      }
    }

    if (canAct[1] && !result) {
      brain.decide(enemy, you, { now, map, isWalkable });
    }

    if (stats.consecutiveTimeouts >= TIMEOUT_LIMIT) result = finish('loss', '3 consecutive decision timeouts');
    else if (stats.invalid > VIOLATION_LIMIT) result = finish('loss', 'more than 10 invalid actions');
    else if (!you.alive || !enemy.alive) {
      result = finish(you.alive ? 'win' : (enemy.alive ? 'loss' : 'draw'), 'hp reached 0');
    }
  }

  return result || finish('draw', `${Math.round(maxMs / 1000)} s match limit`);
}

/**
 * 批量模拟（默认 50 场），返回胜率与耗时统计。
 * @param {(state: object) => object} policy
 * @param {{ count?: number, map?: object, deadlineMs?: number, maxMs?: number }} [options]
 */
function simulateMatches(policy, options = {}) {
  const count = Math.max(1, Math.min(200, options.count || 50));
  const started = performance.now();
  const summary = {
    matches: count, wins: 0, losses: 0, draws: 0, invalid: 0, timeouts: 0, errors: 0,
    totalTicks: 0, avgTicks: 0, avgDecisionMs: 0, maxDecisionMs: 0, wallMs: 0, winRate: 0,
    maxMs: options.maxMs || (options.rules && options.rules.maxMs) || MAX_MS,
    rules: options.rules ? { ...options.rules } : null,
  };
  let decisionTotal = 0;
  let decisionCount = 0;

  for (let i = 0; i < count; i++) {
    const one = simulateMatch(policy, options);
    if (one.result === 'win') summary.wins++;
    else if (one.result === 'loss') summary.losses++;
    else summary.draws++;
    summary.invalid += one.invalid;
    summary.timeouts += one.timeouts;
    if (one.error) summary.errors++;
    summary.totalTicks += one.ticks;
    decisionTotal += one.avgDecisionMs * one.decisions;
    decisionCount += one.decisions;
    summary.maxDecisionMs = Math.max(summary.maxDecisionMs, one.maxDecisionMs);
  }

  summary.avgTicks = Math.round(summary.totalTicks / count);
  summary.avgDecisionMs = decisionCount ? Math.round((decisionTotal / decisionCount) * 100) / 100 : 0;
  summary.winRate = Math.round((summary.wins / count) * 100);
  summary.wallMs = Math.round(performance.now() - started);
  return summary;
}

// --- 两个外部策略对打（CLI --opponent / 未来沙盒对战） ------------------------

function freshSideStats() {
  return { invalid: 0, timeouts: 0, consecutiveTimeouts: 0, decisions: 0, totalMs: 0, maxMs: 0, error: null };
}

function sideSummary(stats) {
  return {
    invalid: stats.invalid,
    timeouts: stats.timeouts,
    decisions: stats.decisions,
    avgDecisionMs: stats.decisions ? Math.round((stats.totalMs / stats.decisions) * 100) / 100 : 0,
    maxDecisionMs: Math.round(stats.maxMs * 100) / 100,
    error: stats.error || undefined,
  };
}

/**
 * 两个 decide(state) 策略互打一场（无内置 AI），规则与线上一致。
 * @returns {{ winner:'A'|'B'|'draw', ticks:number, reason:string,
 *             a:object, b:object }}
 */
function simulateDuel(policyA, policyB, options = {}) {
  const map = options.map || DEFAULT_MAP;
  const deadlineMs = options.deadlineMs || DEADLINE_MS;
  const maxMs = options.maxMs || MAX_MS;

  const agentA = new AIAgent('sim-duel-a', [], 'A');
  agentA.x = map.spawnA.x;
  agentA.y = map.spawnA.y;
  const agentB = new AIAgent('sim-duel-b', [], 'B');
  agentB.x = map.spawnB.x;
  agentB.y = map.spawnB.y;

  const isWalkable = (x, y) => isWalkableOn(map, x, y);
  const sa = freshSideStats();
  const sb = freshSideStats();
  let tick = 0;
  let elapsed = 0;
  let finished = null;

  const act = (policy, me, foe, stats, side) => {
    me.tickShield();
    const state = buildState(me, foe, tick, 1_000_000 + elapsed, elapsed, map);
    const started = performance.now();
    let action;
    try {
      action = policy(structuredClone(state));
    } catch (err) {
      stats.error = err.message;
      finished = { winner: side === 'A' ? 'B' : 'A', reason: `${side} decide() threw` };
      return;
    }
    const decidedIn = performance.now() - started;
    stats.decisions++;
    stats.totalMs += decidedIn;
    stats.maxMs = Math.max(stats.maxMs, decidedIn);

    if (decidedIn > deadlineMs) {
      stats.timeouts++;
      stats.consecutiveTimeouts++;
      return;
    }
    stats.consecutiveTimeouts = 0;
    const validation = validateActionMessage(
      { protocolVersion: PROTOCOL_VERSION, matchId: 'duel', tick, action, tokensUsed: 0 },
      { width: map.width, height: map.height },
    );
    if (!validation.valid) {
      stats.invalid++;
      return;
    }
    const applied = executeAgentAction(me, foe, validation.action, { now: 1_000_000 + elapsed, map, isWalkable });
    if (applied.invalid) stats.invalid++;
  };

  while (elapsed < maxMs && !finished) {
    tick++;
    elapsed = tick * TICK_MS;
    const canAct = [agentA.alive, agentB.alive];

    if (canAct[0]) act(policyA, agentA, agentB, sa, 'A');
    if (canAct[1] && !finished) act(policyB, agentB, agentA, sb, 'B');

    if (!finished) {
      if (sa.consecutiveTimeouts >= TIMEOUT_LIMIT) finished = { winner: 'B', reason: 'A had 3 consecutive timeouts' };
      else if (sb.consecutiveTimeouts >= TIMEOUT_LIMIT) finished = { winner: 'A', reason: 'B had 3 consecutive timeouts' };
      else if (sa.invalid > VIOLATION_LIMIT) finished = { winner: 'B', reason: 'A sent more than 10 invalid actions' };
      else if (sb.invalid > VIOLATION_LIMIT) finished = { winner: 'A', reason: 'B sent more than 10 invalid actions' };
      else if (!agentA.alive && !agentB.alive) finished = { winner: 'draw', reason: 'both died on the same tick' };
      else if (!agentA.alive) finished = { winner: 'B', reason: 'A hp reached 0' };
      else if (!agentB.alive) finished = { winner: 'A', reason: 'B hp reached 0' };
    }
  }

  return {
    winner: finished ? finished.winner : 'draw',
    reason: finished ? finished.reason : '120 s match limit',
    ticks: tick,
    a: sideSummary(sa),
    b: sideSummary(sb),
  };
}

/**
 * 批量两个策略互打。
 * @returns {{ matches:number, aWins:number, bWins:number, draws:number,
 *             avgTicks:number, aInvalid:number, bInvalid:number,
 *             aTimeouts:number, bTimeouts:number, aErrors:number, bErrors:number,
 *             winRateA:number, winRateB:number, wallMs:number }}
 */
function simulateMatchesBetween(policyA, policyB, options = {}) {
  const count = Math.max(1, Math.min(200, options.count || 50));
  const started = performance.now();
  const out = {
    matches: count, aWins: 0, bWins: 0, draws: 0, totalTicks: 0, avgTicks: 0,
    aInvalid: 0, bInvalid: 0, aTimeouts: 0, bTimeouts: 0, aErrors: 0, bErrors: 0,
    winRateA: 0, winRateB: 0, wallMs: 0,
  };

  for (let i = 0; i < count; i++) {
    const one = simulateDuel(policyA, policyB, options);
    if (one.winner === 'A') out.aWins++;
    else if (one.winner === 'B') out.bWins++;
    else out.draws++;
    out.totalTicks += one.ticks;
    out.aInvalid += one.a.invalid;
    out.bInvalid += one.b.invalid;
    out.aTimeouts += one.a.timeouts;
    out.bTimeouts += one.b.timeouts;
    if (one.a.error) out.aErrors++;
    if (one.b.error) out.bErrors++;
  }

  out.avgTicks = Math.round(out.totalTicks / count);
  out.winRateA = Math.round((out.aWins / count) * 100);
  out.winRateB = Math.round((out.bWins / count) * 100);
  out.wallMs = Math.round(performance.now() - started);
  delete out.totalTicks;
  return out;
}

module.exports = {
  simulateMatch, simulateMatches, simulateDuel, simulateMatchesBetween,
  applySimRules, DEFAULT_MAP,
};
