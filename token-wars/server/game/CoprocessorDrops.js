/**
 * CoprocessorDrops — 协处理器碎片掉落共享助手（GDD §3.4）
 *
 * 无状态模块函数：rate 判定 → 入库（Player.addFragment）→ markDirty →
 * 向玩家 socket 发 COPROCESSOR_FRAGMENT。PvE 通关 / PvP 连胜宝箱 /
 * 商店礼包三个接线点共用，避免各自重复 roll+广播逻辑。
 *
 * 随机源统一 Math.random()（服务端权威，与 rollRarity 一致）；
 * 测试用 vi.spyOn(Math, 'random') 锁定。
 */

'use strict';

const { COPROCESSOR_IDS, COPROCESSOR_FRAGMENT_SOURCES, EVENTS } = require('../../shared/constants');

// Uniform random pick across the 16-codex.
function rollCoprocessorId() {
  return COPROCESSOR_IDS[Math.floor(Math.random() * COPROCESSOR_IDS.length)];
}

// Rolls one fragment for `player` from a configured source (e.g. 'SOLO_BOSS').
// Returns { coprocessorId, count, total, source } on a successful drop, or
// null when the roll fails or the source has no numeric rate (world boss /
// daily task are declared but not wired).
function rollFragmentGrant(player, source, { store, socket } = {}) {
  const config = COPROCESSOR_FRAGMENT_SOURCES[source];
  if (!config || typeof config.rate !== 'number') return null;
  if (Math.random() >= config.rate) return null;

  const coprocessorId = rollCoprocessorId();
  const result = { ...player.addFragment(coprocessorId, 1), source };

  if (store) store.markDirty(player);
  if (socket) socket.emit(EVENTS.COPROCESSOR_FRAGMENT, result);

  return result;
}

module.exports = { rollCoprocessorId, rollFragmentGrant };
