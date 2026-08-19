/**
 * aiarena 插件 — AI 竞技场（原 server/index.js:87 的装配）
 *
 * cadence（每 100 tick = 5s）目前由 GameEngine 驱动，M3 迁为 ctx.every。
 * embedded profile（M5）将 disable 本插件。
 */

'use strict';

const AIArenaManager = require('../../game/AIArenaManager');

module.exports = {
  name: 'aiarena',
  dependsOn: ['persistence', 'combat'],
  provides: ['aiarena'],

  setup(ctx) {
    ctx.service('aiarena', new AIArenaManager(ctx.io, ctx.get('store'), ctx.get('combat')));
  },
};
