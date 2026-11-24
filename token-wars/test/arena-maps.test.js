/**
 * 竞技场地图不变量
 *
 * 地图定义经 AIArenaManager.AI_MAPS 导出给平衡性脚本（npm run balance）复用；
 * 这里锁住「出生点必须可站立」，避免加图时把 spawn 写进障碍里导致对局卡死。
 */

const AIArenaManager = require('../server/game/AIArenaManager');

const maps = Object.values(AIArenaManager.AI_MAPS || {});

describe('AI 竞技场地图', () => {
  it('导出全部地图且字段完整', () => {
    expect(maps.length).toBe(5);
    for (const map of maps) {
      expect(map.id).toBeTruthy();
      expect(map.name).toBeTruthy();
      expect(map.width).toBeGreaterThan(0);
      expect(map.height).toBeGreaterThan(0);
      expect(Array.isArray(map.obstacles)).toBe(true);
      expect(map.spawnA).toBeTruthy();
      expect(map.spawnB).toBeTruthy();
    }
  });

  it('两个出生点都不在障碍上，且在场地内', () => {
    for (const map of maps) {
      const blocked = (p) =>
        p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height ||
        map.obstacles.some(([x, y]) => x === p.x && y === p.y);
      expect(blocked(map.spawnA)).toBe(false);
      expect(blocked(map.spawnB)).toBe(false);
      expect(map.spawnA).not.toEqual(map.spawnB);
    }
  });
});
