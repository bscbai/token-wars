/**
 * ExternalMatchRunner — 含外部 agent 的对局执行器（阶段 1 核心）
 *
 * 与 simulateMatch（同步瞬时模拟）并行的双轨之一：
 * 逐 tick 序列化 state → 推送外部 brain → 截止时间内等 action →
 * 服务端校验（冷却/距离/通行性/预算）→ 应用 → 记 trace → 终局判定。
 * 终局后回调 aiarena.resolveMatch 复用全部既有赛后处理
 * （AELO/历史/奖励/重新排队）。
 *
 * parity 规则（openspec/changes/agent-access-protocol/design.md §D4）：
 * - 延迟：服务端计时（action 到达 − state 发送），P50/P99 随 match_end 返回
 * - token：agent 自报 tokensUsed，单场预算内有效，超限动作按 idle 拒绝
 * - 截止：单次决策 DECISION_DEADLINE_MS；超时按 idle 计，连续 DECISION_TIMEOUT_LIMIT 次判负
 * - 违规：单场非法/越界动作 > VIOLATION_LIMIT 判负；对局中断连立即判负
 *
 * 时序说明：为保留「A 先手且 A 可击杀 B」的既有语义，双方按 A→B 顺序
 * 串行决策（各自带截止时间）；最坏单 tick 耗时 2×截止时间，由超时机制削平。
 */

'use strict';

const { EVENTS, BOT_PROTOCOL, AI_ARENA_TIMING, calcDamage } = require('../../shared/constants');
const {
  validateActionMessage, serializeInvite, serializeState, serializeMatchEnd,
} = require('./BotProtocol');

const AI_MATCH_TICK_MS = AI_ARENA_TIMING.MATCH_TICK_MS;
const AI_MATCH_MAX_TIME_MS = AI_ARENA_TIMING.MATCH_MAX_TIME_MS;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const _freshStats = () => ({
  latencies: [], tokensUsed: 0, timeouts: 0, consecutiveTimeouts: 0,
  violations: 0, decisions: 0,
});

const _percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Math.round(sorted[idx]);
};

class ExternalMatchRunner {
  /**
   * @param {AIArenaManager} aiarena
   * @param {{ match:object, agentA:object, agentB:object, map:object,
   *           brains: { A: object, B: object } }} params
   * @param {{ tickIntervalMs?:number, maxTimeMs?:number,
   *           decisionDeadlineMs?:number, tokenBudget?:number }} [options]
   */
  constructor(aiarena, { match, agentA, agentB, map, brains }, options = {}) {
    this.aiarena = aiarena;
    this.match = match;
    this.agentA = agentA;
    this.agentB = agentB;
    this.map = map;
    this.brains = brains; // { A, B }：BuiltinBrain 或 ExternalBrain
    this.tickIntervalMs = options.tickIntervalMs ?? AI_MATCH_TICK_MS;
    this.maxTimeMs = options.maxTimeMs ?? AI_MATCH_MAX_TIME_MS;
    this.decisionDeadlineMs = options.decisionDeadlineMs ?? BOT_PROTOCOL.DECISION_DEADLINE_MS;
    this.tokenBudget = options.tokenBudget ?? BOT_PROTOCOL.TOKEN_BUDGET_DEFAULT;
    this.stats = { A: _freshStats(), B: _freshStats() };
    this.match.trace = this.match.trace || []; // 决策 trace（遥测留痕）
  }

  // --- 入口：邀请阶段 + 模拟 + 收尾 ---

  /**
   * @returns {Promise<{ started: boolean, declinedBy?: 'A'|'B' }>}
   * started=false 时对局未开始（decline/超时未应答），由调用方执行冷却策略。
   */
  async start() {
    const invite = await this._invitePhase();
    if (!invite.started) return invite;
    await this._simulate();
    this._finish();
    return { started: true };
  }

  async _invitePhase() {
    for (const side of ['A', 'B']) {
      const brain = this.brains[side];
      if (!brain.isExternal) continue;
      brain.beginMatch(this.match.id); // brain 跨对局复用：锁定当前 matchId
      const agent = side === 'A' ? this.agentA : this.agentB;
      const other = side === 'A' ? this.agentB : this.agentA;
      const spawn = side === 'A' ? this.map.spawnA : this.map.spawnB;
      brain.emit(EVENTS.BOT_MATCH_INVITE, serializeInvite({
        matchId: this.match.id,
        role: side,
        map: { width: this.map.width, height: this.map.height, obstacles: this.map.obstacles },
        spawn,
        opponent: { name: other.name, external: !!other.brain?.isExternal },
        decisionDeadlineMs: this.decisionDeadlineMs,
        tokenBudget: this.tokenBudget,
      }));
      const answer = await this._withDeadline(brain.waitAccept(), BOT_PROTOCOL.MATCH_ACCEPT_TIMEOUT_MS);
      if (answer !== 'accept') {
        return { started: false, declinedBy: side };
      }
    }
    return { started: true };
  }

  // --- 模拟主循环 ---

  async _simulate() {
    const start = Date.now();
    let tick = 0;
    while (Date.now() - start < this.maxTimeMs && this.agentA.alive && this.agentB.alive) {
      tick++;
      const now = Date.now();
      const timeLeftMs = Math.max(0, this.maxTimeMs - (now - start));
      // A→B 串行：保留「A 先手可击杀 B」的既有语义
      if (this.agentA.alive) await this._takeTurn('A', this.agentA, this.agentB, tick, now, timeLeftMs);
      if (this.agentB.alive) await this._takeTurn('B', this.agentB, this.agentA, tick, now, timeLeftMs);
      this._checkForfeits();
      if (!this.agentA.alive || !this.agentB.alive) break;
      await sleep(this.tickIntervalMs);
    }
    this.match.totalTicks = tick;
    this.match.totalTimeMs = Date.now() - start;
  }

  async _takeTurn(side, agent, enemy, tick, now, timeLeftMs) {
    const brain = this.brains[side];
    const stats = this.stats[side];

    if (brain.isExternal) {
      const state = this._buildState(agent, enemy, tick, timeLeftMs);
      const result = await this._withDeadline(brain.decide(state), this.decisionDeadlineMs);

      if (result && result.__timeout) {
        stats.timeouts++;
        stats.consecutiveTimeouts++;
        this._recordTrace(side, tick, 'idle(timeout)', 0, 0, false);
        return;
      }
      if (!result || result.disconnected) {
        this._forfeit(side, 'disconnect');
        return;
      }
      stats.consecutiveTimeouts = 0;
      this._applyExternalAction(side, agent, enemy, result, tick, now);
    } else {
      // 内置 brain：decide 直接执行副作用（与原 simulateMatch 一致）
      const r = brain.decide(agent, enemy, { now, map: this.map, isWalkable: (x, y) => this._isWalkable(x, y) });
      if (r.log) this.match.log.push({ tick, agent: agent.id, ...r.log });
    }
  }

  _buildState(agent, enemy, tick, timeLeftMs) {
    const now = Date.now();
    return serializeState({
      matchId: this.match.id,
      tick,
      serverTime: now,
      you: {
        x: agent.x, y: agent.y,
        hp: agent.hp, maxHp: agent.maxHp,
        shield: agent.shield, shieldActive: agent.shieldActive,
        skills: agent.skills.map((s) => ({
          id: s.id,
          cooldownRemaining: Math.max(0, s.cooldown - (now - s.lastUsed)),
        })),
      },
      enemy: { x: enemy.x, y: enemy.y, hp: enemy.hp, maxHp: enemy.maxHp, visible: true },
      tokens: [], // 阶段 1 竞技场无 token 掉落，保留字段供后续扩展
      timeLeftMs,
    });
  }

  // --- 外部动作：校验 + 服务端应用 ---

  _applyExternalAction(side, agent, enemy, { msg, latencyMs }, tick, now) {
    const stats = this.stats[side];
    stats.latencies.push(latencyMs);
    stats.decisions++;
    const tokensUsed = Number.isInteger(msg.tokensUsed) && msg.tokensUsed >= 0 ? msg.tokensUsed : 0;
    stats.tokensUsed += tokensUsed;

    // 预算超限：拒绝并按 idle 处理（parity 限制，不计违规）
    if (stats.tokensUsed > this.tokenBudget) {
      this._recordTrace(side, tick, 'idle(budget)', latencyMs, tokensUsed, false);
      return;
    }

    const validation = validateActionMessage(msg, { width: this.map.width, height: this.map.height });
    if (!validation.valid) {
      stats.violations++;
      this._recordTrace(side, tick, `idle(${validation.code})`, latencyMs, tokensUsed, false);
      return;
    }

    const applied = this._executeAction(agent, enemy, validation.action, now);
    if (applied.invalid) stats.violations++;
    this._recordTrace(side, tick, applied.label, latencyMs, tokensUsed, !applied.invalid);
    if (applied.log) this.match.log.push({ tick, agent: agent.id, ...applied.log });
  }

  /**
   * 服务端权威执行：冷却/距离/通行性校验规则与内置 agent 完全一致。
   * @returns {{ label:string, log?:object, invalid?:boolean }}
   */
  _executeAction(agent, enemy, action, now) {
    const dist = Math.abs(agent.x - enemy.x) + Math.abs(agent.y - enemy.y);
    const walkable = (x, y) => this._isWalkable(x, y);
    const log = (label) => ({
      label,
      log: {
        action: label,
        hp: agent.hp, enemyHp: enemy.hp,
        x: agent.x, y: agent.y,
        enemyX: enemy.x, enemyY: enemy.y,
      },
    });

    switch (action.type) {
      case 'idle':
        return { label: 'idle' };

      case 'move': {
        const d = Math.abs(action.x - agent.x) + Math.abs(action.y - agent.y);
        if (d !== 1 || !walkable(action.x, action.y)) return { label: 'idle(invalid_move)', invalid: true };
        agent.x = action.x; agent.y = action.y;
        return { label: 'move' };
      }

      case 'attack':
      case 'skill': {
        const skillId = action.type === 'attack' ? 'basic_attack' : action.id;
        if (skillId === 'basic_attack' || action.type === 'attack') {
          if (dist > 2) return { label: 'idle(out_of_range)', invalid: true };
          if (agent.skillOnCooldown('basic_attack', now)) return { label: 'idle(cooldown)', invalid: true };
          agent.useSkill('basic_attack', now, 1);
          const dmg = calcDamage(agent.atk, 1.0, enemy.def);
          enemy.takeDamage(dmg, agent.id);
          return log(`attack(${dmg})`);
        }
        if (skillId === 'token_burst') {
          if (dist > 2) return { label: 'idle(out_of_range)', invalid: true };
          if (agent.skillOnCooldown('token_burst', now)) return { label: 'idle(cooldown)', invalid: true };
          agent.useSkill('token_burst', now, 3);
          const dmg = calcDamage(agent.atk, 1.5, enemy.def);
          enemy.takeDamage(dmg, agent.id);
          return log(`token_burst(${dmg})`);
        }
        if (skillId === 'dodge_roll') {
          if (agent.skillOnCooldown('dodge_roll', now)) return { label: 'idle(cooldown)', invalid: true };
          agent.useSkill('dodge_roll', now, 0);
          const dx = Math.sign(enemy.x - agent.x);
          const dy = Math.sign(enemy.y - agent.y);
          const range = 3 + (agent.getSpecialEffect('dodgeRangeBonus') || 0);
          let nx = Math.max(0, Math.min(this.map.width - 1, agent.x + dx * range));
          let ny = Math.max(0, Math.min(this.map.height - 1, agent.y + dy * range));
          if (walkable(nx, ny)) { agent.x = nx; agent.y = ny; }
          return { label: 'dash' };
        }
        if (skillId === 'shield') {
          if (agent.shieldActive) return { label: 'idle(shield_active)', invalid: true };
          if (agent.skillOnCooldown('shield', now)) return { label: 'idle(cooldown)', invalid: true };
          agent.enableShield(agent.shieldMax);
          agent.useSkill('shield', now);
          return { label: 'shield' };
        }
        return { label: 'idle(invalid_skill)', invalid: true };
      }

      case 'shield': {
        if (agent.shieldActive) return { label: 'idle(shield_active)', invalid: true };
        if (agent.skillOnCooldown('shield', now)) return { label: 'idle(cooldown)', invalid: true };
        agent.enableShield(agent.shieldMax);
        agent.useSkill('shield', now);
        return { label: 'shield' };
      }

      default:
        return { label: 'idle(invalid_action)', invalid: true };
    }
  }

  _isWalkable(x, y) {
    if (x < 0 || x >= this.map.width || y < 0 || y >= this.map.height) return false;
    return !this.map.obstacles.some(([ox, oy]) => ox === x && oy === y);
  }

  // --- 判负与 trace ---

  _checkForfeits() {
    for (const side of ['A', 'B']) {
      const stats = this.stats[side];
      const brain = this.brains[side];
      if (brain.isExternal && brain.disconnected) { this._forfeit(side, 'disconnect'); continue; }
      if (stats.consecutiveTimeouts >= BOT_PROTOCOL.DECISION_TIMEOUT_LIMIT) { this._forfeit(side, 'timeout'); continue; }
      if (stats.violations > BOT_PROTOCOL.VIOLATION_LIMIT) { this._forfeit(side, 'violation'); continue; }
    }
  }

  _forfeit(side, reason) {
    const agent = side === 'A' ? this.agentA : this.agentB;
    if (!agent.alive) return;
    agent.alive = false;
    agent.hp = 0;
    this._recordTrace(side, this.match.totalTicks || 0, `forfeit(${reason})`, 0, 0, false);
    console.log(`[AI Arena] External match ${this.match.id}: side ${side} forfeit (${reason})`);
  }

  _recordTrace(side, tick, action, latencyMs, tokensUsed, serverValid) {
    this.match.trace.push({
      tick, side, action, latencyMs, tokensUsed, serverValid, at: Date.now(),
    });
  }

  // --- 收尾：stats 汇总 + bot:match_end + 复用 resolveMatch ---

  _finish() {
    const summary = {};
    for (const side of ['A', 'B']) {
      const s = this.stats[side];
      const sorted = [...s.latencies].sort((a, b) => a - b);
      summary[side] = {
        latencyP50Ms: _percentile(sorted, 0.5),
        latencyP99Ms: _percentile(sorted, 0.99),
        tokensUsed: s.tokensUsed,
        timeouts: s.timeouts,
        violations: s.violations,
        decisions: s.decisions,
      };
    }
    this.match.stats = summary;

    // 通知外部 bot（result 由调用方 resolveMatch 后回填，此处先发进程内结果）
    for (const side of ['A', 'B']) {
      const brain = this.brains[side];
      if (!brain.isExternal) continue;
      const agent = side === 'A' ? this.agentA : this.agentB;
      const enemy = side === 'A' ? this.agentB : this.agentA;
      const result = !agent.alive ? 'loss' : (!enemy.alive ? 'win' : 'draw');
      brain.emit(EVENTS.BOT_MATCH_END, serializeMatchEnd({
        matchId: this.match.id, result, stats: summary[side],
      }));
      brain.destroy();
    }

    this.aiarena.resolveMatch(this.match, this.agentA, this.agentB, this.map);
  }

  // --- 工具 ---

  async _withDeadline(promise, ms) {
    let timer;
    const timeoutP = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), ms);
    });
    try {
      return await Promise.race([promise, timeoutP]);
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = ExternalMatchRunner;
