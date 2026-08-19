/**
 * world-player 插件 — 在线世界与玩家档案（原 server/index.js:59 的装配）
 *
 * M1：仅挂载 /api/player 路由。在线注册表三 Map（connectedPlayers/
 * socketToPlayerId/playerToSocket）与 registerPlayer 流程仍在 index.js，
 * M2 将随 player:join/leave 事件化迁入本插件。
 */

'use strict';

const { makePlayerRouter } = require('../../routes/player');

module.exports = {
  name: 'world-player',
  dependsOn: ['persistence', 'identity'],
  provides: [],

  setup(ctx) {
    const router = makePlayerRouter({
      store: ctx.get('store'),
      verifySession: ctx.get('auth'),
    });
    ctx.route('/api/player', router);
  },
};
