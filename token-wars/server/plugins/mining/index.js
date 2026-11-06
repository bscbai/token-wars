/**
 * mining 插件 — 挂机挖矿（原 server/index.js:82,136,139 的装配）
 *
 * M2 起订阅 player:join/leave 自行注册/注销。M3 起节奏由
 * ctx.every(TICK_RATE) 声明。M4 起 MINING_COLLECT/MINING_UPGRADE
 * 监听经 ctx.socket 注册（原 MiningManager.registerSocket 内的自注册删除）。
 * cfg 预留 offlineCapHours 等覆盖位（M5 embedded profile）。
 */

'use strict';

const MiningManager = require('../../game/MiningManager');
const { EVENTS } = require('../../../shared/protocol');
const { TICK_RATE } = require('../../../shared/constants');

module.exports = {
  name: 'mining',
  dependsOn: ['persistence'],
  provides: ['mining'],

  setup(ctx) {
    const mining = new MiningManager(ctx.io, ctx.get('store'));
    ctx.service('mining', mining);

    // 离线收益先于 socket 注册（原 index.js:136→139 顺序）
    ctx.on('player:join', ({ player, socket }) => {
      mining.calculateOfflineMining(player);
      mining.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      mining.unregisterSocket(player.id);
    });

    // 玩家级路由（原 MiningManager.registerSocket 的 guard.on 迁移）
    ctx.socket(EVENTS.MINING_COLLECT, null, (_p, { player }) => {
      mining.collect(player.id);
    }, 'economy');
    ctx.socket(EVENTS.MINING_UPGRADE, null, (_p, { player }) => {
      mining.upgrade(player.id);
    }, 'economy');

    // 节奏声明：每 20 tick（1s）→ mining.tick（原 GameEngine.tick % TICK_RATE）
    ctx.every(TICK_RATE, (now) => mining.tick(now));
  },
};