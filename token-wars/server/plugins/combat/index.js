/**
 * combat 插件 — 战斗系统即服务接缝（原 server/index.js:83 的装配）
 *
 * ctx.combat 是全服唯一的 CombatSystem 实例；pve/pvp/worldboss/aiarena
 * 均为它的消费者。未来可经 profile overrides 替换实现（测试假战斗、
 * 节日规则），这正是"服务接缝"的意义所在。
 */

'use strict';

const CombatSystem = require('../../game/CombatSystem');

module.exports = {
  name: 'combat',
  dependsOn: ['persistence'],
  provides: ['combat'],

  setup(ctx) {
    ctx.service('combat', new CombatSystem(ctx.io, ctx.get('store')));
  },
};
