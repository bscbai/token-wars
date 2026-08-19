/**
 * worldboss 插件 — 世界 Boss（原 server/index.js:86 的装配）
 *
 * cadence（每 100 tick = 5s）目前由 GameEngine 驱动，M3 迁为 ctx.every。
 * embedded profile（M5）将 disable 本插件。
 */

'use strict';

const WorldBossManager = require('../../game/WorldBossManager');

module.exports = {
  name: 'worldboss',
  dependsOn: ['persistence', 'combat'],
  provides: ['worldboss'],

  setup(ctx) {
    ctx.service('worldboss', new WorldBossManager(ctx.io, ctx.get('store'), ctx.get('combat')));
  },
};
