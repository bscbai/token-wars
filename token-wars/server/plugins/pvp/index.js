/**
 * pvp 插件 — 竞技场对战（原 server/index.js:85,143 的装配）
 *
 * 消费 ctx.combat 接缝。M2 起订阅 player:join/leave 自行注册/注销。
 * M3 起竞技场循环由 ctx.every(1 tick) 全局扫描驱动（原 PvPManager
 * 每实例 setInterval(50ms) 等价——1 tick = 50ms = 20Hz）。
 * M4 起 PVP_QUEUE/PVP_DEQUEUE 经 ctx.socket 注册（原 PvPManager
 * .registerSocket 内的 guard.on 自注册删除），并在 combat:resolve-context
 * 瀑布挂认领器：玩家在活跃竞技场 → 填充 entities/mapData 并短路
 * （pve 未认领时兜底，M0 ③ 锁定的顺序语义）。
 */

'use strict';

const PvPManager = require('../../game/PvPManager');
const { EVENTS } = require('../../../shared/protocol');

module.exports = {
  name: 'pvp',
  dependsOn: ['persistence', 'combat'],
  provides: ['pvp'],

  setup(ctx) {
    const store = ctx.get('store');
    const pvp = new PvPManager(ctx.io, store, ctx.get('combat'));
    ctx.service('pvp', pvp);

    ctx.on('player:join', ({ player, socket }) => {
      pvp.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      pvp.unregisterSocket(player.id);
    });

    // 玩家级路由（原 PvPManager.registerSocket 的 guard.on 迁移）
    const queueSchema = { mode: { type: 'enum', enum: ['1v1', '3v3'], required: true } };
    ctx.socket(EVENTS.PVP_QUEUE, queueSchema, ({ mode }, { player }) => {
      pvp.joinQueue(player.id, mode);
    }, 'economy');
    ctx.socket(EVENTS.PVP_DEQUEUE, null, (_p, { player }) => {
      pvp.leaveQueue(player.id);
    }, 'economy');

    // 瀑布认领器：玩家在活跃竞技场 → entities = 双方全部玩家，mapData = 竞技场地图
    ctx.waterfall('combat:resolve-context', (data, next) => {
      const arenaId = pvp.playerArenas.get(data.player.id);
      if (!arenaId) return next();
      const arena = pvp.activeArenas.get(arenaId);
      if (!arena) return next();
      const allPlayers = new Map();
      for (const team of arena.teams) {
        for (const pid of team) {
          const p = store.getPlayerById(pid);
          if (p) allPlayers.set(pid, p);
        }
      }
      data.entities = allPlayers;
      data.mapData = arena.mapData;
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