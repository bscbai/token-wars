/**
 * aiarena 插件 — AI 竞技场（原 server/index.js:87,145 的装配）
 *
 * M2 起订阅 player:join/leave 自行注册/注销。M3 起节奏由
 * ctx.every(TICK_RATE*5) 声明（每 100 tick = 5s），替代 GameEngine 硬编码分支。
 * M4 起 11 个 ai_arena:* 事件经 ctx.socket 注册（原 AIArenaManager
 * .registerSocket 内的 guard.on 自注册删除；schemas 原样搬移）。
 * embedded profile（M5）将 disable 本插件。
 */

'use strict';

const AIArenaManager = require('../../game/AIArenaManager');
const { EVENTS } = require('../../../shared/protocol');
const { TICK_RATE } = require('../../../shared/constants');

module.exports = {
  name: 'aiarena',
  dependsOn: ['persistence', 'combat'],
  provides: ['aiarena'],

  setup(ctx) {
    const aiarena = new AIArenaManager(ctx.io, ctx.get('store'), ctx.get('combat'));
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
  },
};