/**
 * 示例参赛 bot 的决策函数（纯函数，便于单元测试与替换为 LLM 调用）
 *
 * 与 bot.js 解耦的原因：bot.js 在模块加载时即建立 socket 连接，若测试直接
 * import 会挂上真实连接。这里只保留策略。
 *
 * 策略（可整体替换为一次 LLM 调用）：
 *   1. 敌人在攻击距离（曼哈顿 ≤ 2）→ token_burst 就绪则放技能，否则普攻就绪则攻击
 *   2. 血量低于 35% 且护盾就绪 → shield
 *   3. 其余情况 → 沿 BFS 最短路绕开障碍逼近敌人
 *   4. 看不到敌人 / 无可行路径 → idle
 */

'use strict';

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function walkable(x, y, map) {
  if (!map) return true;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return !map.obstacles.some(([ox, oy]) => ox === x && oy === y);
}

function skillReady(you, id) {
  const s = you.skills.find((k) => k.id === id);
  return !s || s.cooldownRemaining === 0;
}

/** 技能是否可用：必须真的出现在 state.skills 里（缺失 ≠ 就绪，避免发出非法动作） */
function canUse(you, id) {
  return you.skills.some((k) => k.id === id) && skillReady(you, id);
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * BFS 求「第一步」：从 from 走到 to 的最短路上的第一个格子。
 * 敌人所在格视为可达目标（不视作障碍）；无路则返回 null。
 *
 * 地图 ≤ 20×20，单次搜索最坏 400 节点，20Hz 下开销可忽略。
 */
function bfsFirstStep(from, to, map) {
  if (!map) return null;
  const obs = new Set(map.obstacles.map(([x, y]) => `${x},${y}`));
  const key = (p) => `${p.x},${p.y}`;

  const startKey = key(from);
  const prev = new Map([[startKey, null]]);
  const queue = [{ x: from.x, y: from.y }];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.x === to.x && cur.y === to.y) {
      // 回溯到「前驱是起点」的那个节点，即第一步
      let node = cur;
      let parent = prev.get(key(node));
      if (!parent) return null;                       // 起点即终点
      while (prev.get(key(parent)) !== null) {
        node = parent;
        parent = prev.get(key(node));
      }
      return { x: node.x, y: node.y };
    }

    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nk = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (obs.has(nk) && !(nx === to.x && ny === to.y)) continue;
      if (prev.has(nk)) continue;
      prev.set(nk, cur);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/**
 * @param {object} state bot:state 载荷
 * @param {object} map   bot:match_invite 下发的 { width, height, obstacles }
 * @returns {{type:string}} move / attack / shield / idle
 */
function decide(state, map) {
  const { you, enemy } = state;
  if (!enemy || !enemy.visible) return { type: 'idle' };

  // 1) 进入攻击距离：优先吃满 cooldown 的技能（token_burst 1.5×），否则普攻
  if (manhattan(you, enemy) <= 2) {
    if (canUse(you, 'token_burst')) return { type: 'skill', id: 'token_burst' };
    return skillReady(you, 'basic_attack') ? { type: 'attack' } : { type: 'idle' };
  }

  // 2) 低血量开盾（未声明 shield 技能时不发，避免违规）
  if (you.hp / you.maxHp < 0.35 && !you.shieldActive && canUse(you, 'shield')) {
    return { type: 'shield' };
  }

  // 3) 绕障逼近（贪心会被墙卡死，BFS 不会）
  const step = bfsFirstStep(you, enemy, map);
  if (step && walkable(step.x, step.y, map)) {
    return { type: 'move', x: step.x, y: step.y };
  }

  return { type: 'idle' };
}

module.exports = { decide, bfsFirstStep, manhattan };
