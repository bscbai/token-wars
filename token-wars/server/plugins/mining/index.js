/**
 * mining 插件 — 挂机挖矿（原 server/index.js:82,136,139 的装配）
 *
 * M2 起订阅 player:join/leave 自行注册/注销。M3 起节奏由
 * ctx.every(TICK_RATE) 声明（每 20 tick = 1s），替代 GameEngine 硬编码分支。
 * cfg 预留 offlineCapHours 等覆盖位（M5 embedded profile）。
 */

'use strict';

const MiningManager = require('../../game/MiningManager');
const { TICK_RATE } = require('../../../shared/constants');

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

    // 节奏声明：每 20 tick（1s）→ mining.tick（原 GameEngine.tick % TICK_RATE）
    ctx.every(TICK_RATE, (now) => mining.tick(now));
  },
};
