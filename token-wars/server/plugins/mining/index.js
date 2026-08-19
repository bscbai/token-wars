/**
 * mining 插件 — 挂机挖矿（原 server/index.js:82 的装配）
 *
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
    ctx.service('mining', new MiningManager(ctx.io, ctx.get('store')));
  },
};
