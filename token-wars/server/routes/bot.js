/**
 * bot 路由 — 外部 agent 接入（阶段 1）的 REST 面
 *
 *   POST /api/bot/token    签发/重置 botToken（JWT 保护；重置时踢旧连接）
 *   GET  /api/bot/protocol 公开协议 schema（参赛方接入文档，无需认证）
 *
 * botToken 是 /bot 命名空间的握手凭证（对应玩家 JWT 会话的机器身份），
 * 持久化于 player.botToken（见 models/Player.js）。
 */

const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { BOT_PROTOCOL, AI_ARENA_TIMING } = require('../../shared/constants');
const { ACTION_TYPES, BOT_SKILL_IDS, ERROR_CODES } = require('../game/BotProtocol');

function makeBotRouter({ store, verifySession, kickBotConnections }) {
  const router = express.Router();

  // Bearer JWT 提取（与 player 路由同款）
  function authPlayer(req) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    return verifySession(token);
  }

  // POST /api/bot/token — 签发/重置 botToken
  router.post('/token', (req, res) => {
    const player = authPlayer(req);
    if (!player) return res.status(401).json({ error: 'Invalid session' });

    const isReset = !!player.botToken;
    player.botToken = crypto.randomBytes(24).toString('hex');

    // 重置 = 旧 token 立即作废：踢掉该玩家全部 /bot 连接
    if (isReset && typeof kickBotConnections === 'function') {
      kickBotConnections(player.id);
    }

    // 事务点：token 丢失等于参赛方无法接入，必须即时落盘
    store.persist(player);
    logger.info({ playerId: player.id, reset: isReset }, '[Bot] botToken issued');

    res.json({ botToken: player.botToken, reset: isReset });
  });

  // GET /api/bot/protocol — 协议 schema（公开；参赛方据此实现客户端）
  router.get('/protocol', (_req, res) => {
    res.json({
      protocolVersion: BOT_PROTOCOL.VERSION,
      namespace: '/bot',
      handshake: { auth: { botToken: '<POST /api/bot/token 签发>' } },
      flow: [
        'S bot:match_invite → B bot:match_accept | bot:match_decline',
        'S bot:state(20Hz) ↔ B bot:action',
        'S bot:match_end',
      ],
      events: {
        serverToBot: ['bot:match_invite', 'bot:state', 'bot:match_end', 'bot:error'],
        botToServer: ['bot:match_accept', 'bot:match_decline', 'bot:action'],
      },
      actionTypes: ACTION_TYPES,
      skillIds: BOT_SKILL_IDS,
      errorCodes: ERROR_CODES,
      parity: {
        decisionDeadlineMs: BOT_PROTOCOL.DECISION_DEADLINE_MS,
        decisionTimeoutLimit: BOT_PROTOCOL.DECISION_TIMEOUT_LIMIT,
        tokenBudgetDefault: BOT_PROTOCOL.TOKEN_BUDGET_DEFAULT,
        matchAcceptTimeoutMs: BOT_PROTOCOL.MATCH_ACCEPT_TIMEOUT_MS,
        declineCooldownMs: BOT_PROTOCOL.DECLINE_COOLDOWN_MS,
        violationLimit: BOT_PROTOCOL.VIOLATION_LIMIT,
      },
      timing: {
        stateHz: Math.round(1000 / AI_ARENA_TIMING.MATCH_TICK_MS),
        matchMaxTimeMs: AI_ARENA_TIMING.MATCH_MAX_TIME_MS,
      },
    });
  });

  return router;
}

module.exports = { makeBotRouter };
