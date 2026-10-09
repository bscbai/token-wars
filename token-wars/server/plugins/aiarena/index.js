/**
 * aiarena 插件 — AI 竞技场（原 server/index.js:87,145 的装配）
 *
 * M2 起订阅 player:join/leave 自行注册/注销。M3 起节奏由
 * ctx.every(TICK_RATE*5) 声明（每 100 tick = 5s），替代 GameEngine 硬编码分支。
 * M4 起 11 个 ai_arena:* 事件经 ctx.socket 注册（原 AIArenaManager
 * .registerSocket 内的 guard.on 自注册删除；schemas 原样搬移）。
 * 阶段 1（agent-access-protocol）起持有外部 agent 接入面：
 *   - POST /api/bot/token 签发/重置 botToken（踢旧连接）
 *   - GET  /api/bot/protocol 公开协议 schema
 *   - /bot 命名空间：botToken 握手 → ExternalBrain → registerExternalAgent
 * embedded profile（M5）将 disable 本插件。
 */

'use strict';

const AIArenaManager = require('../../game/AIArenaManager');
const ExternalBrain = require('../../game/ExternalBrain');
const { makeBotRouter } = require('../../routes/bot');
const guard = require('../../middleware/eventGuard');
const { EVENTS } = require('../../../shared/protocol');
const { BOT_NAMESPACE, TICK_RATE } = require('../../../shared/constants');

module.exports = {
  name: 'aiarena',
  dependsOn: ['persistence', 'combat'],
  provides: ['aiarena'],

  setup(ctx) {
    const store = ctx.get('store');
    const aiarena = new AIArenaManager(ctx.io, store, ctx.get('combat'));
    ctx.service('aiarena', aiarena);

    ctx.on('player:join', ({ player, socket }) => {
      aiarena.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      aiarena.unregisterSocket(player.id);
    });

    // 玩家级路由（原 AIArenaManager.registerSocket 的 guard.on 迁移，schema 原样）
    const deploySchema   = { tokenDisk: { type: 'any', required: true } };
    const agentIdSchema  = { agentId: { type: 'string', maxLength: 100, required: true } };
    const behaviorSchema = { agentId: { type: 'string', maxLength: 100, required: true }, behaviorId: { type: 'string', maxLength: 50, required: true } };
    const nameSchema     = { agentId: { type: 'string', maxLength: 100, required: true }, name: { type: 'string', maxLength: 64, required: true } };
    const replaySchema   = { matchId: { type: 'string', maxLength: 200, required: true } };

    ctx.socket(EVENTS.AI_ARENA_DEPLOY,        deploySchema,   ({ tokenDisk }, { player }) => aiarena.deployAgent(player.id, tokenDisk), 'economy');
    ctx.socket(EVENTS.AI_ARENA_RECALL,         agentIdSchema,  ({ agentId }, { player }) => aiarena.recallAgent(player.id, agentId), 'economy');
    ctx.socket(EVENTS.AI_ARENA_TRAIN,          agentIdSchema,  ({ agentId }, { player }) => aiarena.startTrainingMatch(player.id, agentId), 'economy');
    ctx.socket(EVENTS.AI_ARENA_SET_BEHAVIOR,   behaviorSchema, ({ agentId, behaviorId }, { player }) => aiarena.setAgentBehavior(player.id, agentId, behaviorId), 'economy');
    ctx.socket(EVENTS.AI_ARENA_NAME_AGENT,     nameSchema,     ({ agentId, name }, { player }) => aiarena.nameAgent(player.id, agentId, name), 'economy');
    ctx.socket(EVENTS.AI_ARENA_MATCH_HISTORY,  agentIdSchema,  ({ agentId }, { player }) => aiarena.sendMatchHistory(player.id, agentId), 'query');
    ctx.socket(EVENTS.AI_ARENA_GET_AGENTS,     null,           (_p, { player }) => aiarena.sendAgentList(player.id), 'query');
    ctx.socket(EVENTS.AI_ARENA_GET_REPLAY,     replaySchema,   ({ matchId }, { player }) => aiarena.sendReplay(player.id, matchId), 'query');
    ctx.socket(EVENTS.AI_ARENA_LEADERBOARD,    null,           (_p, { player }) => aiarena.sendLeaderboard(player.id), 'query');
    ctx.socket(EVENTS.AI_ARENA_TOURNAMENT,     null,           (_p, { player }) => aiarena.sendTournamentState(player.id), 'query');
    ctx.socket(EVENTS.AI_ARENA_SEASON_INFO,    null,           (_p, { player }) => aiarena.sendSeasonInfo(player.id), 'query');

    // 节奏声明：每 100 tick（5s）→ aiarena.tick（原 GameEngine.tick % TICK_RATE*5）
    ctx.every(TICK_RATE * 5, (now) => aiarena.tick(now));

    // --- 外部 agent 接入（阶段 1：/bot 命名空间 + bot REST） ----------------
    const botSockets = new Map(); // playerId -> Set<socket>（token 重置时踢旧）

    function kickBotConnections(playerId) {
      const sockets = botSockets.get(playerId);
      if (!sockets) return;
      for (const socket of sockets) socket.disconnect(true);
    }

    ctx.route('/api/bot', makeBotRouter({ store, verifySession: ctx.get('auth'), kickBotConnections }));

    const botNs = ctx.io.of(BOT_NAMESPACE);

    // 握手：botToken（socketAuth 对 /bot 放行后由此处认证——见 middleware/socketAuth.js）
    botNs.use((socket, next) => {
      const botToken = socket.handshake.auth && socket.handshake.auth.botToken;
      if (!botToken) {
        return next(new Error('Bot token required'));
      }
      const player = store.getPlayerByBotToken(botToken);
      if (!player) {
        return next(new Error('Invalid bot token'));
      }
      socket.data.player = player;
      socket.data.playerId = player.id;
      next();
    });

    botNs.on('connection', (socket) => {
      const playerId = socket.data.playerId;

      // 会话顶替：同玩家旧 bot 连接全部踢掉（与 world-player 注册流同语义）
      const existing = botSockets.get(playerId);
      if (existing) {
        for (const old of existing) {
          if (old !== socket) old.disconnect(true);
        }
      }
      if (!botSockets.has(playerId)) botSockets.set(playerId, new Set());
      botSockets.get(playerId).add(socket);

      const brain = new ExternalBrain({ socket });
      const agent = aiarena.registerExternalAgent(playerId, brain);
      if (agent) brain.agentId = agent.id;

      // 入站路由（INV1：网络处理器在插件层经 guard.on 绑定，'bot' 类限流
      // 100/s；schema 不在此层预校验——非法动作须透传给 runner 计违规）
      const offs = [
        guard.on(socket, EVENTS.BOT_ACTION, null, (msg) => brain.receiveAction(msg), 'bot'),
        guard.on(socket, EVENTS.BOT_MATCH_ACCEPT, null, () => brain.receiveAccept('accept'), 'bot'),
        guard.on(socket, EVENTS.BOT_MATCH_DECLINE, null, () => brain.receiveAccept('decline'), 'bot'),
      ];

      socket.on('disconnect', () => {
        for (const off of offs) off();
        brain.receiveDisconnect();
        guard.rateLimiter.cleanup(socket.id); // /bot 不在宿主连接循环内，自行清理

        const set = botSockets.get(playerId);
        if (set) {
          set.delete(socket);
          if (set.size === 0) botSockets.delete(playerId);
        }
        // 仅当该 socket 的 brain 仍是当前活跃 brain 时才离队——
        // 重连替换 brain 后，旧 socket 的迟到 disconnect 不应踢掉新 agent
        const current = aiarena.getExternalAgent(playerId);
        if (current && current.brain === brain) {
          aiarena.recallExternalAgent(playerId);
        }
      });
    });
  },
};