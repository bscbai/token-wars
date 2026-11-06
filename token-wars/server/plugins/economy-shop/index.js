/**
 * economy-shop 插件 — 商城经济（原 server/index.js:60 的装配）
 *
 * 挂载 /api/shop 路由。M2 起商城相关 socket 事件迁入本插件。
 */

'use strict';

const { makeShopRouter } = require('../../routes/shop');

module.exports = {
  name: 'economy-shop',
  dependsOn: ['persistence', 'identity'],
  provides: [],

  setup(ctx) {
    const router = makeShopRouter({
      store: ctx.get('store'),
      verifySession: ctx.get('auth'),
    });
    ctx.route('/api/shop', router);
  },
};
