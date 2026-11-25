/**
 * 每日挑战配置（试玩页 / 沙盒 / 静态站共用）
 *
 * 纯本地规则：按用户本地日期决定「挑战编号 + 竞技场 + 规则变体」，
 * 不需要服务端，也不会隔天失效。地图每天轮换；变体每 5 天换一档，
 * 5 张图 × 5 变体 = 25 天不重复组合。
 */

'use strict';

const DAY_MS = 86400000;
// 编号基准日：2026-01-01 是第 1 期
const EPOCH = Date.UTC(2026, 0, 1);
const MAP_IDS = ['data_mine', 'compute_square', 'cache_maze', 'arena_dome', 'data_torrent'];

// rules 字段与 play 页的 applyDailyRules / agentSimulator 的 rules 选项一致
const MUTATORS = [
  { id: 'blitz', en: 'Blitz 60s', zh: '极速 60 秒', maxMs: 60000 },
  { id: 'glass', en: 'Glass 60 HP', zh: '玻璃 60 血', hp: 60 },
  { id: 'guarded', en: 'Shielded foe', zh: '对手带盾', enemyShield: true },
  { id: 'fierce', en: 'Fierce AI', zh: '狂暴 AI', enemyAtkMult: 1.25 },
  { id: 'fragile', en: 'Fragile: you 60 HP', zh: '脆弱：你只有 60 血', youHp: 60 },
];

function dailyInfo(date = new Date()) {
  const localMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const day = Math.floor((localMidnight - EPOCH) / DAY_MS);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getDate()).padStart(2, '0')}`;
  const mapIndex = ((day % MAP_IDS.length) + MAP_IDS.length) % MAP_IDS.length;
  const mutIndex = ((Math.floor(day / MAP_IDS.length) % MUTATORS.length)
    + MUTATORS.length) % MUTATORS.length;
  return { key, number: day + 1, mapId: MAP_IDS[mapIndex], mutator: MUTATORS[mutIndex] };
}

module.exports = { DAY_MS, EPOCH, MAP_IDS, MUTATORS, dailyInfo };
