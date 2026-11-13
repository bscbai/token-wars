/**
 * arenaDamage 测试 — 竞技场伤害掷骰
 *
 * 覆盖：确定性 rng 下的区间边界 / 暴击分支 / 至少 1 点伤害，
 * 以及内置与外部两条路径共用同一实现（避免只有一侧有暴击）。
 */

const { rollArenaDamage, AI_DAMAGE_VARIANCE, AI_CRIT_MULT } = require('../server/game/arenaDamage');
const { calcDamage } = require('../shared/constants');

// rng 依次返回给定值；用完后循环最后一个
const seq = (values) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

describe('rollArenaDamage', () => {
  it('普通命中：等于基础伤害 × 浮动（下界/中值/上界）', () => {
    const atk = 20;
    const def = 5;
    const base = calcDamage(atk, 1.0, def);

    // 不暴击（rng=0.5 ≥ 暴击阈值）→ 浮动分别取 0 / 0.5 / 1
    const low = rollArenaDamage(atk, 1.0, def, seq([0.5, 0]));
    const mid = rollArenaDamage(atk, 1.0, def, seq([0.5, 0.5]));
    const high = rollArenaDamage(atk, 1.0, def, seq([0.5, 1]));

    expect(mid).toBe(base);
    expect(low).toBe(Math.round(base * (1 - AI_DAMAGE_VARIANCE)));
    expect(high).toBe(Math.round(base * (1 + AI_DAMAGE_VARIANCE)));
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('暴击：同一浮动下伤害按倍率放大', () => {
    const atk = 20;
    const def = 5;
    const plain = rollArenaDamage(atk, 1.0, def, seq([0.9, 0.5]));
    const crit = rollArenaDamage(atk, 1.0, def, seq([0.0, 0.5])); // 0 < 暴击率
    expect(crit).toBeGreaterThan(plain);
    expect(crit).toBe(Math.round(calcDamage(atk, AI_CRIT_MULT, def)));
  });

  it('始终至少 1 点伤害（高防御不产生 0/负数）', () => {
    expect(rollArenaDamage(1, 1.0, 999, seq([0.5, 0]))).toBe(1);
  });

  it('内置 brain 与外部 runner 两条路径都走该实现', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', 'server', 'game');
    for (const file of ['BuiltinBrain.js', 'ExternalMatchRunner.js']) {
      const src = fs.readFileSync(path.join(root, file), 'utf8');
      expect(src).toContain('rollArenaDamage');
      expect(src).not.toMatch(/calcDamage\(/);
    }
  });
});
