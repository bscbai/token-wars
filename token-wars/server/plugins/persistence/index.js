/**
 * persistence 插件 — 玩家数据持久化（原 server/index.js:49,297-298 的装配）
 *
 * 提供 ctx.store（Store 单例）。load() 与 startAutoSave(60000) 的时机
 * 从旧 index.js 的"连接处理器注册之后"提前到挂载阶段——两者都在
 * server.listen 之前完成，行为等价（首次 auto-save 周期同为 60s）。
 */

'use strict';

const { getStore } = require('../../data/Store');

module.exports = {
  name: 'persistence',
  dependsOn: [],
  provides: ['store'],

  setup(ctx) {
    const store = getStore();
    store.load();
    store.startAutoSave(60000);
    ctx.service('store', store);
    // 注：store.close() 由宿主 shutdown 流程统一负责（与现状一致）
  },
};
