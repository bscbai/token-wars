/**
 * worldboss 插件 — 世界 Boss（原 server/index.js:86,144 的装配）
 *
 * M2 起订阅 player:join/leave 自行注册/注销。M3 起节奏由
 * ctx.every(TICK_RATE*5) 声明（每 100 tick = 5s），替代 GameEngine 硬编码分支。
 * M4 起 WORLD_BOSS_JOIN 经 ctx.socket 注册（原 WorldBossManager
 * .registerSocket 内的 guard.on 自注册删除），并在 combat:resolve-context
 * 瀑布挂认领器：Boss 战进行中且玩家为参战者 → entities = 参战者+Boss
 * （战斗发生在大厅地图，mapData 不覆盖）。pve/pvp 未认领时才轮到本插件。
 * embedded profile（M5）将 disable 本插件。
 */

'use strict';

const WorldBossManager = require('../../game/WorldBossManager');
const { EVENTS } = require('../../../shared/protocol');
const { TICK_RATE } = require('../../../shared/constants');

module.exports = {
  name: 'worldboss',
  dependsOn: ['persistence', 'combat'],
  provides: ['worldboss'],

  setup(ctx) {
    const worldboss = new WorldBossManager(ctx.io, ctx.get('store'), ctx.get('combat'));
    ctx.service('worldboss', worldboss);

    ctx.on('player:join', ({ player, socket }) => {
      worldboss.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      worldboss.unregisterSocket(player.id);
    });

    // 玩家级路由（原 WorldBossManager.registerSocket 的 guard.on 迁移）
    ctx.socket(EVENTS.WORLD_BOSS_JOIN, null, (_p, { player }) => {
      worldboss.joinBoss(player.id);
    }, 'economy');

    // 瀑布认领器：Boss 战活跃且玩家参战 → entities = 参战者 + Boss
    ctx.waterfall('combat:resolve-context', (data, next) => {
      if (worldboss.state !== 'active' || !worldboss.boss) return next();
      if (!worldboss.participants.has(data.player.id)) return next();
      const entities = new Map(worldboss.participants);
      entities.set(worldboss.boss.id, worldboss.boss);
      data.entities = entities;
      // Boss 战发生在大厅地图：不覆盖 mapData（保持 null → 大厅）
    });

    // 节奏声明：每 100 tick（5s）→ worldboss.tick（原 GameEngine.tick % TICK_RATE*5）
    ctx.every(TICK_RATE * 5, (now) => worldboss.tick(now));
  },
};