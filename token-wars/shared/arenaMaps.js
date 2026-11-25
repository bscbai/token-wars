/**
 * AI 竞技场地图（服务端 AIArenaManager 与浏览器试玩页共用）
 *
 * 纯数据，无 Node 依赖：`client/play/main.js` 会把它打进浏览器 bundle，
 * 保证试玩页与线上对局使用完全相同的障碍布局与出生点。
 */

'use strict';

const AI_MAPS = {
  DATA_MINE: {
    id: 'data_mine',
    name: '数据矿洞',
    width: 20,
    height: 20,
    obstacles: [
      [4, 4], [4, 15], [15, 4], [15, 15],
      [7, 7], [7, 12], [12, 7], [12, 12],
      [10, 8], [6, 10], [13, 10],
    ],
    weightMods: { mobility: 0.15, attack: -0.10 },
    spawnA: { x: 1, y: 1 },
    spawnB: { x: 18, y: 18 },
  },
  COMPUTE_SQUARE: {
    id: 'compute_square',
    name: '算力广场',
    width: 20,
    height: 20,
    obstacles: [
      [9, 9], [10, 9], [9, 10], [10, 10], // Center block
    ],
    weightMods: { attack: 0.15, mobility: -0.05 },
    spawnA: { x: 1, y: 10 },
    spawnB: { x: 18, y: 10 },
  },
  CACHE_MAZE: {
    id: 'cache_maze',
    name: '缓存迷宫',
    width: 20,
    height: 20,
    obstacles: [
      [3, 3], [3, 5], [3, 7], [3, 9], [3, 11],
      [16, 3], [16, 5], [16, 7], [16, 9], [16, 11],
      [8, 5], [8, 14], [11, 5], [11, 14],
    ],
    weightMods: { mobility: 0.20, defense: 0.10 },
    spawnA: { x: 1, y: 1 },
    spawnB: { x: 18, y: 18 },
  },
  ARENA_DOME: {
    id: 'arena_dome',
    name: '竞技穹顶',
    width: 20,
    height: 20,
    obstacles: [[5, 5], [14, 5], [5, 14], [14, 14]],
    weightMods: {},
    spawnA: { x: 1, y: 1 },
    spawnB: { x: 18, y: 18 },
  },
  DATA_TORRENT: {
    id: 'data_torrent',
    name: '数据洪流',
    width: 20,
    height: 20,
    obstacles: [[5, 9], [14, 9]],
    weightMods: { mobility: 0.25, economy: -0.10 },
    spawnA: { x: 1, y: 1 },
    spawnB: { x: 18, y: 18 },
  },
};

module.exports = { AI_MAPS };
