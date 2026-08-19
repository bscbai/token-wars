/**
 * aiarena 插件 — AI 竞技场（原 server/index.js:87,145 的装配）
 *
 * cadence（每 100 tick = 5s）目前由 GameEngine 驱动，M3 迁为 ctx.every。
 * embedded profile（M5）将 disable 本插件。M2 起订阅 player:join/leave
 * 自行注册/注销（原 index.js ×6 手工调用之一）。
 */

'use strict';

const AIArenaManager = require('../../game/AIArenaManager');

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
  },
};
