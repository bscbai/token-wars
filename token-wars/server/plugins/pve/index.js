/**
 * pve 插件 — 副本战斗（原 server/index.js:84,142 的装配）
 *
 * 消费 ctx.combat 接缝。M2 起订阅 player:join/leave 自行注册/注销。
 * M3 起副本循环由 ctx.every(1 tick) 全局扫描驱动（原 PvEManager
 * 每实例 setInterval(50ms) 等价——1 tick = 50ms = 20Hz）；
 * INPUT_SKILL 的副本上下文解析 M4 迁为 combat:resolve-context 瀑布认领。
 */

'use strict';

const PvEManager = require('../../game/PvEManager');

module.exports = {
  name: 'pve',
  dependsOn: ['persistence', 'combat'],
  provides: ['pve'],

  setup(ctx) {
    const pve = new PvEManager(ctx.io, ctx.get('store'), ctx.get('combat'));
    ctx.service('pve', pve);

    ctx.on('player:join', ({ player, socket }) => {
      pve.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      pve.unregisterSocket(player.id);
    });

    // 节奏声明：每 1 tick（50ms）→ 遍历活跃副本各跑一次 dungeonTick
    // （原 startDungeonLoop 的 setInterval(50) 已移除，state 非 active 自然跳过）
    ctx.every(1, () => {
      for (const dungeon of pve.activeDungeons.values()) {
        if (dungeon.state === 'active') pve.dungeonTick(dungeon);
      }
    });
  },
};