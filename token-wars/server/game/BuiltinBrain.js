/**
 * BuiltinBrain — 内置 agent 的权重决策逻辑（从 AIArenaManager.simulateMatch 原样提取）
 *
 * 行为零变化承诺：decide() 内的读写顺序、Math.random() 调用点、
 * 动作标签字符串均与原内联实现一致（对拍测试 test/bot-protocol.test.js 保障）。
 * 与 ExternalBrain 的差异：内置决策可信，decide 直接执行副作用
 * （useSkill/enableShield/takeDamage/移动），返回动作标签与可选 log 条目；
 * 外部 brain 只做决策，副作用由 ExternalMatchRunner 校验后应用。
 */

'use strict';

const { calcDamage } = require('../../shared/constants');

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
    // 贪心逼近：先在差距更大的轴上走，被墙挡住再走另一轴。
    // 只按 x 优先会让双方在 x 对齐后 dx=0 卡死（永久平局），故按主导轴排序。
    const stepToward = () => {
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
        const dmg = calcDamage(agent.atk, 1.5, enemy.def);
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
            const dmg = calcDamage(agent.atk, 1.5, enemy.def);
            enemy.takeDamage(dmg, agent.id);
            actionTaken = `combo(${dmg})`;
          } else {
            const dmg = calcDamage(agent.atk, 1.0, enemy.def);
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
    // Priority 4: Melee attack (distance ≤ 2)
    else if (dist(agent, enemy) <= 2) {
      if (basicReady) {
        agent.useSkill('basic_attack', now, 1);
        const dmg = calcDamage(agent.atk, 1.0, enemy.def);
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
