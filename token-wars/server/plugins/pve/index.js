/**
 * pve 插件 — 副本战斗（原 server/index.js:84 的装配）
 *
 * 消费 ctx.combat 接缝。自有副本循环暂由 PvEManager 内部驱动（现状），
 * M3 并入 Scheduler；INPUT_SKILL 的副本上下文解析 M4 迁为
 * combat:resolve-context 瀑布认领。
 */

'use strict';

const PvEManager = require('../../game/PvEManager');

module.exports = {
  name: 'pve',
  dependsOn: ['persistence', 'combat'],
  provides: ['pve'],

  setup(ctx) {
    ctx.service('pve', new PvEManager(ctx.io, ctx.get('store'), ctx.get('combat')));
  },
};
