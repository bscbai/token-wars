/**
 * 示例 bot 决策测试 —— 重点防「贪心寻路被墙卡死」
 *
 * 背景：原实现只在四邻域中选「曼哈顿距离更小」的一格，遇到障碍绕不开就
 * 永久 idle，对局一直到 120 秒上限才结束。这里用行为测试锁定新实现不会死锁。
 */

const { decide, bfsFirstStep, manhattan } = require('../examples/sample-bot-node/decide');

const ATTACK_READY = [{ id: 'basic_attack', cooldownRemaining: 0 }];

function makeYou(x, y, extra = {}) {
  return { x, y, hp: 100, maxHp: 100, shieldActive: false, skills: ATTACK_READY, ...extra };
}

function makeState(you, enemy) {
  return { you, enemy: { visible: true, ...enemy } };
}

const OPEN_MAP = { width: 10, height: 5, obstacles: [] };
// x=5 竖墙，仅 y=4 留缺口 → 直线逼近会被挡住
const WALL_MAP = {
  width: 10,
  height: 5,
  obstacles: [[5, 0], [5, 1], [5, 2], [5, 3]],
};

describe('sample bot decide', () => {
  it('看不到敌人 → idle', () => {
    expect(decide({ you: makeYou(1, 1), enemy: { visible: false } }, OPEN_MAP)).toEqual({ type: 'idle' });
    expect(decide({ you: makeYou(1, 1), enemy: null }, OPEN_MAP)).toEqual({ type: 'idle' });
  });

  it('进入攻击距离且冷却就绪 → attack', () => {
    const state = makeState(makeYou(2, 2), { x: 3, y: 2 });
    expect(decide(state, OPEN_MAP)).toEqual({ type: 'attack' });
  });

  it('进入攻击距离但冷却中 → idle（不产生非法移动）', () => {
    const state = makeState(
      makeYou(2, 2, { skills: [{ id: 'basic_attack', cooldownRemaining: 3 }] }),
      { x: 3, y: 2 },
    );
    expect(decide(state, OPEN_MAP)).toEqual({ type: 'idle' });
  });

  it('token_burst 就绪时优先放技能（1.5×），冷却中回落普攻', () => {
    const ready = makeYou(2, 2, {
      skills: [{ id: 'basic_attack', cooldownRemaining: 0 }, { id: 'token_burst', cooldownRemaining: 0 }],
    });
    expect(decide(makeState(ready, { x: 3, y: 2 }), OPEN_MAP))
      .toEqual({ type: 'skill', id: 'token_burst' });

    const cooling = makeYou(2, 2, {
      skills: [{ id: 'basic_attack', cooldownRemaining: 0 }, { id: 'token_burst', cooldownRemaining: 900 }],
    });
    expect(decide(makeState(cooling, { x: 3, y: 2 }), OPEN_MAP)).toEqual({ type: 'attack' });
  });

  it('state 未声明 token_burst 时不得发出该技能（缺失 ≠ 就绪）', () => {
    // 只有 basic_attack 的 skills 列表：若误判为「就绪」会被服务端记违规
    expect(decide(makeState(makeYou(2, 2), { x: 3, y: 2 }), OPEN_MAP)).toEqual({ type: 'attack' });
  });

  it('低血量且护盾就绪 → shield', () => {
    const you = makeYou(1, 1, {
      hp: 20,
      skills: [{ id: 'basic_attack', cooldownRemaining: 0 }, { id: 'shield', cooldownRemaining: 0 }],
    });
    expect(decide(makeState(you, { x: 8, y: 4 }), WALL_MAP)).toEqual({ type: 'shield' });
  });

  it('空旷地图：每步缩短 1 格', () => {
    const you = makeYou(2, 2);
    const enemy = { x: 6, y: 2 };
    const action = decide(makeState(you, enemy), OPEN_MAP);
    expect(action).toEqual({ type: 'move', x: 3, y: 2 });
    expect(manhattan({ x: action.x, y: action.y }, enemy)).toBe(manhattan(you, enemy) - 1);
  });

  it('有墙时必须绕行而不是 idle（回归：贪心寻路死锁）', () => {
    const action = decide(makeState(makeYou(2, 2), { x: 8, y: 2 }), WALL_MAP);
    expect(action.type).toBe('move');
    // 第一步不能踩墙，且必须是合法相邻格
    expect(manhattan({ x: action.x, y: action.y }, { x: 2, y: 2 })).toBe(1);
    const blocked = WALL_MAP.obstacles.some(([x, y]) => x === action.x && y === action.y);
    expect(blocked).toBe(false);
  });

  it('双方绕墙逼近：60 tick 内进入攻击距离（无死锁）', () => {
    let a = { x: 2, y: 2 };
    let b = { x: 8, y: 2 };
    let reached = false;

    for (let tick = 0; tick < 60; tick++) {
      if (manhattan(a, b) <= 2) { reached = true; break; }
      const actA = decide(makeState(makeYou(a.x, a.y), { x: b.x, y: b.y }), WALL_MAP);
      const actB = decide(makeState(makeYou(b.x, b.y), { x: a.x, y: a.y }), WALL_MAP);
      if (actA.type === 'move') a = { x: actA.x, y: actA.y };
      if (actB.type === 'move') b = { x: actB.x, y: actB.y };
      // 不能踩墙
      const inWall = (p) => WALL_MAP.obstacles.some(([x, y]) => x === p.x && y === p.y);
      expect(inWall(a)).toBe(false);
      expect(inWall(b)).toBe(false);
    }

    expect(reached).toBe(true);
  });

  it('被完全封死 → idle 且不抛错', () => {
    // (1,1) 四邻全是墙，出口为零
    const cage = { width: 5, height: 5, obstacles: [[0, 1], [2, 1], [1, 0], [1, 2]] };
    const action = decide(makeState(makeYou(1, 1), { x: 4, y: 4 }), cage);
    expect(action).toEqual({ type: 'idle' });
  });

  it('bfsFirstStep：目标不可达返回 null；起点即终点返回 null', () => {
    // x=1 整列是墙（含 y=4），左右完全隔断
    const closed = { width: 5, height: 5, obstacles: [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]] };
    expect(bfsFirstStep({ x: 0, y: 0 }, { x: 4, y: 4 }, closed)).toBeNull();
    expect(bfsFirstStep({ x: 2, y: 2 }, { x: 2, y: 2 }, OPEN_MAP)).toBeNull();
  });
});
