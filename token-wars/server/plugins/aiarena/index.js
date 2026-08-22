/**
 * aiarena 插件 — AI 竞技场（原 server/index.js:87,145 的装配）
 *
 * M2 起订阅 player:join/leave 自行注册/注销。M3 起节奏由
 * ctx.every(TICK_RATE*5) 声明（每 100 tick = 5s），替代 GameEngine 硬编码分支。
 * embedded profile（M5）将 disable 本插件。
 */

'use strict';

const AIArenaManager = require('../../game/AIArenaManager');
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

    // 节奏声明：每 100 tick（5s）→ aiarena.tick（原 GameEngine.tick % TICK_RATE*5）
    ctx.every(TICK_RATE * 5, (now) => aiarena.tick(now));
  },
};