/**
 * BuiltinBrain — 内置 agent 的权重决策逻辑（从 AIArenaManager.simulateMatch 原样提取）
 *
 * 与 ExternalBrain 的差异：内置决策可信，decide 直接执行副作用
 * （useSkill/enableShield/takeDamage/移动），返回动作标签与可选 log 条目；
 * 外部 brain 只做决策，副作用由 ExternalMatchRunner 校验后应用。
 *
 * parity 约束（与外部 agent 的校验规则逐条对齐，改动需同步两侧）：
 *   - 基础攻击受 500ms 冷却约束（冷却中不动手，不再每 tick 出手）
 *   - 护盾衰减统一走 AIAgent.tickShield()
 *   - 逼近优先走 BFS 最短路（绕障），无路时退回主导轴贪心 + 同轴侧移
 * 确定性由 test/bot-protocol.test.js 的对拍与回归测试保障。
 */

'use strict';

const { rollArenaDamage } = require('./arenaDamage');

class BuiltinBrain {
  /**
   * @param {AIAgent} agent  决策方
   * @param {AIAgent} enemy  对手
   * @param {{ now:number, map:object, isWalkable:Function }} ctx
   * @returns {{ action:string, log: object|null }} log 为 match.log 条目（tick/agent 由调用方补）
   */
  decide(agent, enemy, { now, map, isWalkable }) {
    // Apply shield drain（原实现位于决策之前；外部 agent 走同一方法）
    agent.tickShield();

    const attackWeight = agent.getWeight('attack');
    const defenseWeight = agent.getWeight('defense');
    const mobilityWeight = agent.getWeight('mobility');
    const economyWeight = agent.getWeight('economy');

    let actionTaken = 'idle';
    let logEntry = null;
    const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    // BFS 最短路第一步：绕障能力与示例 bot 同级（旧贪心会在墙角/长墙前停滞）。
    // 地图 ≤ 20×20，单次搜索最多 400 节点，同步模拟下开销可忽略。
    const bfsStep = () => {
      if (!map || !map.obstacles || map.width <= 0 || map.height <= 0) return null;
      const key = (x, y) => x * map.width + y;
      const blocked = new Set(map.obstacles.map(([x, y]) => key(x, y)));
      const start = key(agent.x, agent.y);
      const goal = key(enemy.x, enemy.y);
      const prev = new Map([[start, -1]]);
      const queue = [start];
      let head = 0;
      let found = false;
      while (head < queue.length) {
        const cur = queue[head++];
        if (cur === goal) { found = true; break; }
        const cx = Math.floor(cur / map.width);
        const cy = cur % map.width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          const k = key(x, y);
          if (prev.has(k)) continue;
          if (blocked.has(k) && k !== goal) continue; // 敌人所在格视为可达目标
          prev.set(k, cur);
          queue.push(k);
        }
      }
      if (!found) return null;
      // 回溯到「父节点是起点」的那一格，即第一步
      let node = goal;
      while (prev.get(node) !== start) {
        node = prev.get(node);
        if (node === undefined || node === -1) return null;
      }
      return { x: Math.floor(node / map.width), y: node % map.width };
    };

    // 贪心逼近（BFS 无路时的兜底）：先在差距更大的轴上走，被墙挡住再走另一轴。
    // 同轴时（dx 或 dy 为 0）向 +1 侧侧移绕行，避免对齐后死锁。
    const greedyStep = () => {
      const dx = Math.sign(enemy.x - agent.x);
      const dy = Math.sign(enemy.y - agent.y);
      // 同轴时（dx 或 dy 为 0）向 +1 侧侧移绕行：正面被墙挡住时能脱离死锁，
      // 且双方侧移方向一致，不会互相抵消（如算力广场中央方块）。
      const moveX = () => {
        const step = dx !== 0 ? dx : 1;
        if (isWalkable(agent.x + step, agent.y)) { agent.x += step; return 'move_x'; }
        if (dx === 0 && isWalkable(agent.x - 1, agent.y)) { agent.x -= 1; return 'move_x'; }
        return null;
      };
      const moveY = () => {
        const step = dy !== 0 ? dy : 1;
        if (isWalkable(agent.x, agent.y + step)) { agent.y += step; return 'move_y'; }
        if (dy === 0 && isWalkable(agent.x, agent.y - 1)) { agent.y -= 1; return 'move_y'; }
        return null;
      };
      const gapY = Math.abs(enemy.y - agent.y);
      const gapX = Math.abs(enemy.x - agent.x);
      const order = gapY > gapX ? [moveY, moveX] : [moveX, moveY];
      for (const move of order) {
        const label = move();
        if (label) return label;
      }
      return null;
    };
    // 逼近：先 BFS（绕障最短路），无路可走再退回贪心
    const stepToward = () => {
      const step = bfsStep();
      if (step) {
        const dx = step.x - agent.x;
        agent.x = step.x;
        agent.y = step.y;
        return dx !== 0 ? 'move_x' : 'move_y';
      }
      return greedyStep();
    };
    const pushLog = (action) => {
      logEntry = {
        action,
        hp: agent.hp, enemyHp: enemy.hp,
        x: agent.x, y: agent.y,
        enemyX: enemy.x, enemyY: enemy.y,
      };
    };

    // 基础攻击同样受 500ms 冷却约束——外部 agent 的服务端校验会拒绝冷却中的
    // attack，内置若每 tick 都能出手就等于 10 倍 DPS，parity 名存实亡。
    const basicReady = !agent.skillOnCooldown('basic_attack', now);

    // Priority 1: Retreat + Shield (HP < 20% && high defense)
    if (agent.hp / agent.maxHp < 0.20 && defenseWeight > 50) {
      if (!agent.shieldActive && !agent.skillOnCooldown('shield', now)) {
        agent.enableShield(agent.shieldMax);
        agent.useSkill('shield', now);
        actionTaken = 'shield_retreat';
      }
      // Move away from enemy
      const dx = Math.sign(agent.x - enemy.x);
      const dy = Math.sign(agent.y - enemy.y);
      const nx = agent.x + dx, ny = agent.y + dy;
      if (isWalkable(nx, ny)) { agent.x = nx; agent.y = ny; actionTaken = 'retreat'; }
    }
    // Priority 2: Berserker combo (★★★ behavior)
    else if (agent.hasSpecialActive('berserker') && dist(agent, enemy) <= 2) {
      if (basicReady) {
        agent.useSkill('basic_attack', now, 1);
        if (!agent.skillOnCooldown('token_burst', now)) {
          agent.useSkill('token_burst', now, 3);
        }
        const dmg = rollArenaDamage(agent.atk, 1.5, enemy.def);
        enemy.takeDamage(dmg, agent.id);
        actionTaken = `berserker_combo(${dmg})`;
        pushLog(actionTaken);
      }
    }
    // Priority 3: Low HP combo (enemy < 30% && high attack)
    else if (enemy.hp / enemy.maxHp < 0.30 && attackWeight > 50) {
      if (dist(agent, enemy) <= 2) {
        if (basicReady) {
          agent.useSkill('basic_attack', now, 1);
          if (!agent.skillOnCooldown('token_burst', now)) {
            agent.useSkill('token_burst', now, 3);
            const dmg = rollArenaDamage(agent.atk, 1.5, enemy.def);
            enemy.takeDamage(dmg, agent.id);
            actionTaken = `combo(${dmg})`;
          } else {
            const dmg = rollArenaDamage(agent.atk, 1.0, enemy.def);
            enemy.takeDamage(dmg, agent.id);
            actionTaken = `attack(${dmg})`;
          }
        }
      } else {
        // Chase（与 P6 同样的主导轴优先，避免单轴对齐后卡死）
        const label = stepToward();
        if (label) actionTaken = label === 'move_x' ? 'chase_x' : 'chase_y';
      }
      pushLog(actionTaken);
    }
    // Priority 4: Melee attack (distance ≤ 2) — 技能就绪优先吃 1.5×，与示例 bot 同一策略
    else if (dist(agent, enemy) <= 2) {
      if (!agent.skillOnCooldown('token_burst', now)) {
        agent.useSkill('token_burst', now, 3);
        const dmg = rollArenaDamage(agent.atk, 1.5, enemy.def);
        enemy.takeDamage(dmg, agent.id);
        actionTaken = `token_burst(${dmg})`;
        pushLog(actionTaken);
      } else if (basicReady) {
        agent.useSkill('basic_attack', now, 1);
        const dmg = rollArenaDamage(agent.atk, 1.0, enemy.def);
        enemy.takeDamage(dmg, agent.id);
        actionTaken = `attack(${dmg})`;
        pushLog(actionTaken);
      }
    }
    // Priority 5: Close gap (high mobility)
    else if (dist(agent, enemy) > 2 && mobilityWeight > 50) {
      if (!agent.skillOnCooldown('dodge_roll', now)) {
        agent.useSkill('dodge_roll', now, 0);
        const dx = Math.sign(enemy.x - agent.x);
        const dy = Math.sign(enemy.y - agent.y);
        const range = 3 + (agent.getSpecialEffect('dodgeRangeBonus') || 0);
        let nx = agent.x + dx * range;
        let ny = agent.y + dy * range;
        nx = Math.max(0, Math.min(map.width - 1, nx));
        ny = Math.max(0, Math.min(map.height - 1, ny));
        if (isWalkable(nx, ny)) { agent.x = nx; agent.y = ny; }
        actionTaken = 'dash';
      }
    }
    // Priority 6: Move toward enemy
    else if (dist(agent, enemy) > 2) {
      const label = stepToward();
      if (label) actionTaken = label;
    }
    // Priority 7: Collect dropped token (high economy)
    else if (economyWeight > 50 && Math.random() < 0.3) {
      actionTaken = 'patrol';
    }
    // Priority 8: Patrol
    else {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
      if (isWalkable(agent.x + dx, agent.y + dy)) { agent.x += dx; agent.y += dy; }
      actionTaken = 'patrol';
    }

    return { action: actionTaken, log: logEntry };
  }
}

module.exports = BuiltinBrain;
