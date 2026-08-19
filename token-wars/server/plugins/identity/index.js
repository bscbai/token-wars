/**
 * identity 插件 — 账号与会话（原 server/index.js:57,74 的装配）
 *
 * 提供 ctx.auth（verifySession）；挂载 /api/auth 路由与 Socket.IO
 * 握手认证中间件（io.use 的顺序语义不变：仍在任何连接建立之前）。
 * M2 起将在此发出 player:join / player:leave。
 */

'use strict';

const { makeAuth } = require('../../routes/auth');
const { makeSocketAuth } = require('../../middleware/socketAuth');

module.exports = {
  name: 'identity',
  dependsOn: ['persistence'],
  provides: ['auth'],

  setup(ctx) {
    const store = ctx.get('store');
    const { router, verifySession } = makeAuth({ store });

    ctx.route('/api/auth', router);
    ctx.service('auth', verifySession);
    ctx.io.use(makeSocketAuth({ verifySession }));
    // 注：io.use 中间件不可逆（socket.io 无移除 API），unload 不回滚这一项
  },
};
