/**
 * pvp 插件 — 竞技场对战（原 server/index.js:85 的装配）
 *
 * 消费 ctx.combat 接缝；自有竞技场循环 M3 并入 Scheduler。
 */

'use strict';

const PvPManager = require('../../game/PvPManager');

module.exports = {
  name: 'pvp',
  dependsOn: ['persistence', 'combat'],
  provides: ['pvp'],

  setup(ctx) {
    ctx.service('pvp', new PvPManager(ctx.io, ctx.get('store'), ctx.get('combat')));
  },
};
