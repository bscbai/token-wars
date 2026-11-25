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

function buildState(you, enemy, tick, now, elapsed, map) {
  return {
    matchId: 'sim',
    tick,
    timeLeftMs: Math.max(0, MAX_MS - elapsed),
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
 * 跑一场无渲染对局。
 * @param {(state: object) => object} policy
 * @param {{ map?: object, deadlineMs?: number, maxMs?: number }} [options]
 * @returns {{ result:'win'|'loss'|'draw', ticks:number, reason:string,
 *             invalid:number, timeouts:number, decisions:number,
 *             error?:string, avgDecisionMs:number, maxDecisionMs:number }}
 */
function simulateMatch(policy, options = {}) {
  const map = options.map || DEFAULT_MAP;
  const deadlineMs = options.deadlineMs || DEADLINE_MS;
  const maxMs = options.maxMs || MAX_MS;
  const brain = new BuiltinBrain();

  const you = new AIAgent('sim-player', [], 'Policy');
  you.x = map.spawnA.x;
  you.y = map.spawnA.y;
  const enemy = new AIAgent('sim-house', [], 'Gatekeeper');
  enemy.x = map.spawnB.x;
  enemy.y = map.spawnB.y;

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
      const state = buildState(you, enemy, tick, now, elapsed, map);
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

  return result || finish('draw', '120 s match limit');
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

module.exports = { simulateMatch, simulateMatches, DEFAULT_MAP };
