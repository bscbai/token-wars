/**
 * full profile — 全量组合（= 重构前的完整启动，M1 的默认 profile）
 *
 * 插件顺序沿用 server/index.js 重构前的装配顺序（拓扑排序会按 dependsOn
 * 再校验一遍，此处的顺序是同依赖层级内的稳定 tie-breaker）。
 */

'use strict';

module.exports = {
  name: 'full',
  plugins: [
    'persistence',
    'identity',
    'world-player',
    'combat',
    'mining',
    'pve',
    'pvp',
    'worldboss',
    'aiarena',
    'economy-shop',
  ],
};
