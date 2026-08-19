/**
 * mining 插件 — 挂机挖矿（原 server/index.js:82,136,139 的装配）
 *
 * M2 起订阅 player:join/leave 自行注册/注销（原 index.js ×6 手工调用之一）。
 * cadence（每 20 tick）目前仍由 GameEngine 驱动，M3 迁移为
 * ctx.every 声明。cfg 预留 offlineCapHours 等覆盖位（M5 embedded profile）。
 */

'use strict';

const MiningManager = require('../../game/MiningManager');

module.exports = {
  name: 'mining',
  dependsOn: ['persistence'],
  provides: ['mining'],

  setup(ctx) {
    const mining = new MiningManager(ctx.io, ctx.get('store'));
    ctx.service('mining', mining);

    // 离线收益先于 socket 注册（原 index.js:136→139 顺序）
    ctx.on('player:join', ({ player, socket }) => {
      mining.calculateOfflineMining(player);
      mining.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      mining.unregisterSocket(player.id);
    });
  },
};
