/**
 * 无渲染批量模拟器（沙盒「模拟 N 场」与服务端共用）
 *
 * 关注点：规则复用（协议/动作/内置 AI）、计数汇总、异常与超时兜底。
 */

const {
  simulateMatch, simulateMatches, simulateDuel, simulateMatchesBetween, applySimRules,
} = require('../server/game/agentSimulator');
const sample = require('../examples/sample-bot-node/decide');

const idle = () => ({ type: 'idle' });
const invalid = () => ({ type: 'teleport' });

describe('simulateMatch', () => {
  it('idle 策略会被内置 AI 打死，判负且 tick > 0', () => {
    const out = simulateMatch(idle);
    expect(out.result).toBe('loss');
    expect(out.ticks).toBeGreaterThan(0);
    expect(out.decisions).toBeGreaterThan(0);
    expect(out.invalid).toBe(0);
  });

  it('非法动作累计后再判负', () => {
    const out = simulateMatch(invalid);
    expect(out.result).toBe('loss');
    expect(out.reason).toMatch(/invalid actions/);
    expect(out.invalid).toBeGreaterThan(10);
  });

  it('策略抛错 = 该场判负并记录错误', () => {
    const out = simulateMatch(() => { throw new Error('boom'); });
    expect(out.result).toBe('loss');
    expect(out.error).toBe('boom');
    expect(out.ticks).toBe(1);
  });

  it('决策超时累计三次判负', () => {
    const slow = () => {
      const end = performance.now() + 20;
      while (performance.now() < end) { /* spin */ }
      return { type: 'idle' };
    };
    const out = simulateMatch(slow, { deadlineMs: 5 });
    expect(out.result).toBe('loss');
    expect(out.reason).toMatch(/timeouts/);
    expect(out.timeouts).toBeGreaterThanOrEqual(3);
  });
});

describe('每日挑战规则（applySimRules / rules 选项）', () => {
  const mk = () => ({
    maxHp: 100, hp: 100, shield: 0, shieldActive: false, shieldMax: 20, baseAtk: 10,
    enableShield(amount) { this.shieldActive = true; this.shield = amount; },
  });

  it('hp 同时改双方，youHp 只改玩家', () => {
    const you = mk();
    const enemy = mk();
    applySimRules(you, enemy, { hp: 60 });
    expect([you.hp, you.maxHp, enemy.hp, enemy.maxHp]).toEqual([60, 60, 60, 60]);

    const you2 = mk();
    const enemy2 = mk();
    applySimRules(you2, enemy2, { youHp: 60 });
    expect([you2.hp, you2.maxHp, enemy2.hp, enemy2.maxHp]).toEqual([60, 60, 100, 100]);
  });

  it('enemyShield 让对手开盾，enemyAtkMult 提升攻击', () => {
    const you = mk();
    const enemy = mk();
    applySimRules(you, enemy, { enemyShield: true, enemyAtkMult: 1.25 });
    expect(enemy.shieldActive).toBe(true);
    expect(enemy.shield).toBe(20);
    expect(enemy.baseAtk).toBe(13);
    expect(you.shieldActive).toBe(false);
  });

  it('规则里的 maxMs 限制对局时长，state.timeLeftMs 同步', () => {
    let firstLeft;
    const spy = (state) => {
      if (firstLeft === undefined) firstLeft = state.timeLeftMs;
      return { type: 'idle' };
    };
    const out = simulateMatch(spy, { rules: { maxMs: 1000 } });
    expect(out.result).toBe('draw');
    expect(out.reason).toMatch(/^1 s match limit/);
    expect(out.ticks).toBe(20); // 1000ms / 50ms
    expect(firstLeft).toBe(950); // 首个 tick 已过 50ms
  });

  it('批量结果回显 maxMs 与 rules', () => {
    const out = simulateMatches(idle, { count: 2, rules: { maxMs: 1000, hp: 60 } });
    expect(out.maxMs).toBe(1000);
    expect(out.rules).toEqual({ maxMs: 1000, hp: 60 });
    expect(out.avgTicks).toBe(20);
  });
});

describe('simulateDuel', () => {
  const play = (state) => sample.decide(state, state.map);

  it('会走位/攻击的一侧击败只会 idle 的一侧（两种朝向）', () => {
    const aIdle = simulateDuel(idle, play);
    expect(aIdle.winner).toBe('B');
    expect(aIdle.ticks).toBeGreaterThan(0);

    const bIdle = simulateDuel(play, idle);
    expect(bIdle.winner).toBe('A');
  });

  it('双方都 idle 时 120 秒判平局', () => {
    const out = simulateDuel(idle, idle);
    expect(out.winner).toBe('draw');
    expect(out.reason).toMatch(/120 s/);
  });

  it('抛错一侧判负并记录错误', () => {
    const out = simulateDuel(() => { throw new Error('boom'); }, play);
    expect(out.winner).toBe('B');
    expect(out.a.error).toBe('boom');
  });

  it('非法动作过多的一侧判负', () => {
    const out = simulateDuel(invalid, play);
    expect(out.winner).toBe('B');
    expect(out.a.invalid).toBeGreaterThan(10);
  });

  it('recordFrames 记录逐 tick 快照，默认不记录（批量模拟零开销）', () => {
    const withFrames = simulateDuel(play, idle, { recordFrames: true });
    expect(Array.isArray(withFrames.frames)).toBe(true);
    expect(withFrames.frames.length).toBeGreaterThan(0);
    expect(withFrames.frames.length).toBeLessThanOrEqual(withFrames.ticks);
    const f = withFrames.frames[0];
    expect(f.t).toBe(1);
    expect(typeof f.a.x).toBe('number');
    expect(typeof f.a.y).toBe('number');
    expect(typeof f.a.hp).toBe('number');
    expect(typeof f.b.alive).toBe('boolean');

    const plain = simulateDuel(play, idle);
    expect(plain.frames).toBeUndefined();
  });
});

describe('simulateMatchesBetween', () => {
  it('汇总双方胜负与违规计数', () => {
    const out = simulateMatchesBetween(idle, invalid, { count: 2 });
    expect(out.matches).toBe(2);
    expect(out.aWins + out.bWins + out.draws).toBe(2);
    expect(out.bInvalid).toBeGreaterThan(10);
    expect(out.winRateA + out.winRateB).toBeLessThanOrEqual(100);
  });
});

describe('simulateMatches', () => {
  it('汇总场次、胜负与胜率', () => {
    const out = simulateMatches(idle, { count: 3 });
    expect(out.matches).toBe(3);
    expect(out.wins + out.losses + out.draws).toBe(3);
    expect(out.losses).toBe(3);
    expect(out.winRate).toBe(0);
    expect(out.avgTicks).toBeGreaterThan(0);
    expect(out.wallMs).toBeGreaterThanOrEqual(0);
  });

  it('抛错策略计入 errors', () => {
    const out = simulateMatches(() => { throw new Error('nope'); }, { count: 2 });
    expect(out.errors).toBe(2);
    expect(out.losses).toBe(2);
  });

  it('场次数量有上限（避免误触卡死页面）', () => {
    const out = simulateMatches(idle, { count: 9999 });
    // 上限 200，但验证开销：直接用上限断言会跑 200 场，这里只验证被裁剪后仍合法
    expect(out.matches).toBe(200);
  }, 60000);
});
