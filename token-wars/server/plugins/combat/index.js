/**
 * combat 插件 — 战斗系统即服务接缝（原 server/index.js:83,140 的装配）
 *
 * ctx.combat 是全服唯一的 CombatSystem 实例；pve/pvp/worldboss/aiarena
 * 均为它的消费者。未来可经 profile overrides 替换实现（测试假战斗、
 * 节日规则），这正是"服务接缝"的意义所在。
 * M2 起订阅 player:join/leave 自行注册/注销（原 index.js ×6 手工调用之一）。
 */

'use strict';

const CombatSystem = require('../../game/CombatSystem');
const CoprocessorSystem = require('../../game/CoprocessorSystem');

module.exports = {
  name: 'combat',
  dependsOn: ['persistence'],
  provides: ['combat', 'coprocessor'],

  setup(ctx) {
    const store = ctx.get('store');
    const combat = new CombatSystem(ctx.io, store);
    const coprocessor = new CoprocessorSystem(ctx.io, store, combat);
    // Back-reference so PvE/PvP managers can read coprocessor-side state
    // (slow debuffs, portals) without taking a separate constructor dep.
    combat.coprocessor = coprocessor;
    ctx.service('combat', combat);
    ctx.service('coprocessor', coprocessor);

    ctx.on('player:join', ({ player, socket }) => {
      combat.registerSocket(player.id, socket);
    });
    ctx.on('player:leave', ({ player }) => {
      combat.unregisterSocket(player.id);
    });

    // 玩家维护节奏（原 GameEngine.tick % 10 分支，M3 迁移时遗漏，
    // combat-triangle 补回）：buff 清理、护盾到期/流失、基础弹药恢复。
    // 10 tick = 500ms；内部按墙钟节流到 1/s 的流失精度。
    ctx.every(10, (now) => {
      for (const [, player] of store.players) {
        if (player.alive) combat.tickPlayer(player, now);
      }
    });
  },
};
