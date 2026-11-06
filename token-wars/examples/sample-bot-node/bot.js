/**
 * Token Wars — 示例参赛 bot（Node.js）
 *
 * 连接 /bot 命名空间 → 自动接受邀请 → 每 tick 返回一个动作。
 * 策略极简（可替换 decide() 为 LLM 调用）：
 *   1. 敌人在攻击距离（曼哈顿 ≤ 2）→ attack
 *   2. 血量低于 35% 且护盾就绪 → shield
 *   3. 否则向敌人移动一格（绕开障碍/越界）
 *   4. 看不到敌人 → idle
 *
 * 用法：
 *   BOT_URL=http://localhost:3000 BOT_TOKEN=<botToken> node bot.js
 *
 * botToken 获取：
 *   curl -X POST <server>/api/auth/register -H 'Content-Type: application/json' \
 *        -d '{"username":"you","password":"pw"}'        # → sessionToken
 *   curl -X POST <server>/api/bot/token \
 *        -H 'Authorization: Bearer <sessionToken>'       # → botToken
 */

'use strict';

const { io } = require('socket.io-client');

const URL = process.env.BOT_URL || 'http://localhost:3000';
const TOKEN = process.env.BOT_TOKEN;
const PROTOCOL_VERSION = 1;

if (!TOKEN) {
  console.error('Missing BOT_TOKEN env var. See README.md in this folder.');
  process.exit(1);
}

/** 最近一场邀请中的地图（state 不含地图，obstacles 来自 invite） */
let mapInfo = null;

const socket = io(`${URL}/bot`, {
  auth: { botToken: TOKEN },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log(`[bot] connected as ${socket.id}; waiting for match invite...`);
});

socket.on('connect_error', (err) => {
  console.error(`[bot] connection failed: ${err.message}`);
});

// --- 邀请：5 秒内必须 accept，否则按 decline 处理 ---
socket.on('bot:match_invite', (invite) => {
  mapInfo = invite.map;
  console.log(
    `[bot] invited to ${invite.matchId} as ${invite.role} on ` +
    `${invite.map.width}x${invite.map.height} ` +
    `(deadline=${invite.decisionDeadlineMs}ms, budget=${invite.tokenBudget})`
  );
  socket.emit('bot:match_accept', { protocolVersion: PROTOCOL_VERSION, matchId: invite.matchId });
});

// --- 20Hz 决策循环：每个 state 恰好回一个 action ---
socket.on('bot:state', (state) => {
  const action = decide(state);
  socket.emit('bot:action', {
    protocolVersion: PROTOCOL_VERSION,
    matchId: state.matchId,
    tick: state.tick,
    action,
    tokensUsed: 0, // 自报本决策 token 消耗（LLM 场景填实际用量），省略按 0 计
  });
});

socket.on('bot:match_end', (msg) => {
  console.log(`[bot] match ${msg.matchId} -> ${msg.result}`, msg.stats);
});

socket.on('bot:error', (msg) => {
  console.warn('[bot] server error:', msg);
});

socket.on('disconnect', (reason) => {
  console.log(`[bot] disconnected: ${reason}`);
});

// --- 决策逻辑 ---------------------------------------------------------------

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function walkable(x, y) {
  if (!mapInfo) return true;
  if (x < 0 || y < 0 || x >= mapInfo.width || y >= mapInfo.height) return false;
  return !mapInfo.obstacles.some(([ox, oy]) => ox === x && oy === y);
}

function skillReady(you, id) {
  const s = you.skills.find((k) => k.id === id);
  return !s || s.cooldownRemaining === 0;
}

/**
 * @param {object} state bot:state 载荷
 * @returns {{type:string}} 合法动作之一：move/attack/shield/idle
 */
function decide(state) {
  const { you, enemy } = state;
  if (!enemy || !enemy.visible) return { type: 'idle' };

  // 1) 近身：攻击（服务端要求距离 ≤ 2 且冷却就绪）
  if (manhattan(you, enemy) <= 2 && skillReady(you, 'basic_attack')) {
    return { type: 'attack' };
  }

  // 2) 低血量：开盾（未激活且冷却就绪）
  if (you.hp / you.maxHp < 0.35 && !you.shieldActive && skillReady(you, 'shield')) {
    return { type: 'shield' };
  }

  // 3) 逼近：从四邻域选可通行且距敌最近的一格
  const neighbors = [
    { x: you.x + 1, y: you.y },
    { x: you.x - 1, y: you.y },
    { x: you.x, y: you.y + 1 },
    { x: you.x, y: you.y - 1 },
  ].filter((p) => walkable(p.x, p.y));

  let best = null;
  for (const p of neighbors) {
    if (!best || manhattan(p, enemy) < manhattan(best, enemy)) best = p;
  }
  if (best && manhattan(best, enemy) < manhattan(you, enemy)) {
    return { type: 'move', x: best.x, y: best.y };
  }

  return { type: 'idle' };
}

module.exports = { decide }; // 导出便于单元测试/替换大脑
