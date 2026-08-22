/**
 * worldboss 插件 — 世界 Boss（原 server/index.js:86,144 的装配）
 *
 * M2 起订阅 player:join/leave 自行注册/注销。M3 起节奏由
 * ctx.every(TICK_RATE*5) 声明（每 100 tick = 5s），替代 GameEngine 硬编码分支。
 * embedded profile（M5）将 disable 本插件。
 */

'use strict';

const WorldBossManager = require('../../game/WorldBossManager');
const { TICK_RATE } = require('../../../shared/constants');

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

    // 节奏声明：每 100 tick（5s）→ worldboss.tick（原 GameEngine.tick % TICK_RATE*5）
    ctx.every(TICK_RATE * 5, (now) => worldboss.tick(now));
  },
};