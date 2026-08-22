/**
 * pvp 插件 — 竞技场对战（原 server/index.js:85,143 的装配）
 *
 * 消费 ctx.combat 接缝。M2 起订阅 player:join/leave 自行注册/注销。
 * M3 起竞技场循环由 ctx.every(1 tick) 全局扫描驱动（原 PvPManager
 * 每实例 setInterval(50ms) 等价——1 tick = 50ms = 20Hz）；
 * INPUT_SKILL 的竞技场上下文解析 M4 迁为 combat:resolve-context 瀑布认领。
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

    // 节奏声明：每 1 tick（50ms）→ 遍历活跃竞技场各跑一次 arenaTick
    // （原 startArenaLoop 的 setInterval(50) 已移除，state 非 active 自然跳过）
    ctx.every(1, () => {
      for (const arena of pvp.activeArenas.values()) {
        if (arena.state === 'active') pvp.arenaTick(arena);
      }
    });
  },
};