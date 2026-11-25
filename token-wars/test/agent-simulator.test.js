/**
 * 无渲染批量模拟器（沙盒「模拟 N 场」与服务端共用）
 *
 * 关注点：规则复用（协议/动作/内置 AI）、计数汇总、异常与超时兜底。
 */

const {
  simulateMatch, simulateMatches, simulateDuel, simulateMatchesBetween,
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
