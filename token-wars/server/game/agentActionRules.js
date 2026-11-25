/**
 * 外部 agent 动作的权威执行规则（服务端对局与浏览器沙盒共用）
 *
 * 从 ExternalMatchRunner._executeAction 提取：冷却 / 距离 / 通行性 / 护盾状态
 * 的判定与副作用都在这一个函数里，避免「线上规则」和「试玩沙盒」各写一份。
 * 调用方负责先做协议层校验（字段类型/坐标范围），这里只做游戏规则校验。
 */

'use strict';

const { rollArenaDamage } = require('./arenaDamage');

/**
 * @param {object} agent 行动方（AIAgent）
 * @param {object} enemy 对手（AIAgent）
 * @param {{ type:string, x?:number, y?:number, id?:string }} action
 * @param {{ now:number, map:{width:number,height:number,obstacles:number[][]}, isWalkable:Function }} ctx
 * @returns {{ label:string, log?:object, invalid?:boolean }}
 */
function executeAgentAction(agent, enemy, action, { now, map, isWalkable }) {
  const walkable = isWalkable || ((x, y) => {
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) return false;
    return !map.obstacles.some(([ox, oy]) => ox === x && oy === y);
  });
  const dist = Math.abs(agent.x - enemy.x) + Math.abs(agent.y - enemy.y);
  const log = (label) => ({
    label,
    log: {
      action: label,
      hp: agent.hp, enemyHp: enemy.hp,
      x: agent.x, y: agent.y,
      enemyX: enemy.x, enemyY: enemy.y,
    },
  });

  switch (action && action.type) {
    case 'idle':
      return { label: 'idle' };

    case 'move': {
      const d = Math.abs(action.x - agent.x) + Math.abs(action.y - agent.y);
      if (d !== 1 || !walkable(action.x, action.y)) return { label: 'idle(invalid_move)', invalid: true };
      agent.x = action.x;
      agent.y = action.y;
      return { label: 'move' };
    }

    case 'attack':
    case 'skill': {
      const skillId = action.type === 'attack' ? 'basic_attack' : action.id;
      if (skillId === 'basic_attack' || action.type === 'attack') {
        if (dist > 2) return { label: 'idle(out_of_range)', invalid: true };
        if (agent.skillOnCooldown('basic_attack', now)) return { label: 'idle(cooldown)', invalid: true };
        agent.useSkill('basic_attack', now, 1);
        const dmg = rollArenaDamage(agent.atk, 1.0, enemy.def);
        enemy.takeDamage(dmg, agent.id);
        return log(`attack(${dmg})`);
      }
      if (skillId === 'token_burst') {
        if (dist > 2) return { label: 'idle(out_of_range)', invalid: true };
        if (agent.skillOnCooldown('token_burst', now)) return { label: 'idle(cooldown)', invalid: true };
        agent.useSkill('token_burst', now, 3);
        const dmg = rollArenaDamage(agent.atk, 1.5, enemy.def);
        enemy.takeDamage(dmg, agent.id);
        return log(`token_burst(${dmg})`);
      }
      if (skillId === 'dodge_roll') {
        if (agent.skillOnCooldown('dodge_roll', now)) return { label: 'idle(cooldown)', invalid: true };
        agent.useSkill('dodge_roll', now, 0);
        const dx = Math.sign(enemy.x - agent.x);
        const dy = Math.sign(enemy.y - agent.y);
        const range = 3 + (agent.getSpecialEffect('dodgeRangeBonus') || 0);
        const nx = Math.max(0, Math.min(map.width - 1, agent.x + dx * range));
        const ny = Math.max(0, Math.min(map.height - 1, agent.y + dy * range));
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

module.exports = { executeAgentAction };
