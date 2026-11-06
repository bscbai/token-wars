/**
 * pve 插件 — 副本战斗（原 server/index.js:84,142 的装配）
 *
 * 消费 ctx.combat 接缝。M2 起订阅 player:join/leave 自行注册/注销。
 * M3 起副本循环由 ctx.every(1 tick) 全局扫描驱动（原 PvEManager
 * 每实例 setInterval(50ms) 等价——1 tick = 50ms = 20Hz）。
 * M4 起 DUNGEON_JOIN 经 ctx.socket 注册（原 PvEManager.registerSocket
 * 内的 guard.on 自注册删除），并在 combat:resolve-context 瀑布挂认领器：
 * 玩家在活跃副本 → 填充 entities/mapData 并短路；副本 id 残留但实例
 * 已失效 → next() 穿透给后续认领者（M0 ③ 锁定的顺序语义）。
 */

'use strict';

const PvEManager = require('../../game/PvEManager');
const { EVENTS } = require('../../../shared/protocol');

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

    // 玩家级路由（原 PvEManager.registerSocket 的 guard.on 迁移）
    const dungeonJoinSchema = { dungeonId: { type: 'string', maxLength: 100, required: true } };
    ctx.socket(EVENTS.DUNGEON_JOIN, dungeonJoinSchema, ({ dungeonId }, { player }) => {
      pve.joinDungeon(player.id, dungeonId);
    }, 'economy');

    // 瀑布认领器：玩家在活跃副本 → entities = 副本玩家+怪物，mapData = 副本地图
    ctx.waterfall('combat:resolve-context', (data, next) => {
      const dungeonId = pve.playerDungeons.get(data.player.id);
      if (!dungeonId) return next();
      const dungeon = pve.activeDungeons.get(dungeonId);
      if (!dungeon) return next();
      data.entities = new Map([...dungeon.players, ...dungeon.monsters]);
      data.mapData = dungeon.mapData;
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