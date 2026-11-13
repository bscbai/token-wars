/**
 * 竞技场伤害掷骰（内置 brain 与外部 agent 共用同一实现）
 *
 * 为什么需要随机：竞技场每 tick 双方各行动一次。若伤害完全确定，两个同构
 * brain 会永远在同一 tick 打空对方血量 —— 加「同 tick 反击」后是恒定平局，
 * 去掉反击又变成恒定由先手方获胜。两种都让胜负与策略无关。
 *
 * 因此引入 12% 暴击（×1.6）与 ±10% 浮动：双方规则完全相同、期望相同，
 * 但命中次数不再严格对称，镜像对局也能分出胜负。
 */

'use strict';

const { calcDamage } = require('../../shared/constants');

const AI_DAMAGE_VARIANCE = 0.1;
const AI_CRIT_CHANCE = 0.12;
const AI_CRIT_MULT = 1.6;

/**
 * @param {number} atk 攻击方 atk
 * @param {number} multiplier 技能倍率（普攻 1.0，token_burst 1.5）
 * @param {number} def 防御方 def
 * @param {() => number} [rng] 便于测试注入
 * @returns {number} 至少 1 点伤害
 */
function rollArenaDamage(atk, multiplier, def, rng = Math.random) {
  const crit = rng() < AI_CRIT_CHANCE;
  const base = calcDamage(atk, multiplier * (crit ? AI_CRIT_MULT : 1), def);
  const jitter = 1 - AI_DAMAGE_VARIANCE + rng() * AI_DAMAGE_VARIANCE * 2;
  return Math.max(1, Math.round(base * jitter));
}

module.exports = { rollArenaDamage, AI_DAMAGE_VARIANCE, AI_CRIT_CHANCE, AI_CRIT_MULT };
