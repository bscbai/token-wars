/**
 * pvp 插件 — 竞技场对战（原 server/index.js:85,143 的装配）
 *
 * 消费 ctx.combat 接缝；自有竞技场循环 M3 并入 Scheduler。
 * M2 起订阅 player:join/leave 自行注册/注销（原 index.js ×6 手工调用之一）。
 */

'use strict';

const PvPManager = require('../../game/PvPManager');

module.exports = {
  name: 'pvp',
  dependsOn: ['persistence', 'combat'],
  provides: ['pvp'],

  setup(ctx) {
    const pvp = new PvPManager(ctx.io, ctx.get('store'), ctx.get('combat'));
    ctx.service('pvp', pvp);

    ctx.on('player:join', ({ player, socket }) => {
      pvp.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      pvp.unregisterSocket(player.id);
    });
  },
};
