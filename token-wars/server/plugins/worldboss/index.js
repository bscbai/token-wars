/**
 * worldboss 插件 — 世界 Boss（原 server/index.js:86,144 的装配）
 *
 * cadence（每 100 tick = 5s）目前由 GameEngine 驱动，M3 迁为 ctx.every。
 * embedded profile（M5）将 disable 本插件。M2 起订阅 player:join/leave
 * 自行注册/注销（原 index.js ×6 手工调用之一）。
 */

'use strict';

const WorldBossManager = require('../../game/WorldBossManager');

module.exports = {
  name: 'worldboss',
  dependsOn: ['persistence', 'combat'],
  provides: ['worldboss'],

  setup(ctx) {
    const worldboss = new WorldBossManager(ctx.io, ctx.get('store'), ctx.get('combat'));
    ctx.service('worldboss', worldboss);

    ctx.on('player:join', ({ player, socket }) => {
      worldboss.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      worldboss.unregisterSocket(player.id);
    });
  },
};
