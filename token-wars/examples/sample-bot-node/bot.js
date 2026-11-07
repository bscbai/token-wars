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
const { decide } = require('./decide');

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
  const action = decide(state, mapInfo);
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

// 决策逻辑见 ./decide.js（纯函数，可直接替换为一次 LLM 调用）
