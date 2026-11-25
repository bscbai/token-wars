/**
 * 外部 agent 动作规则（服务端与浏览器沙盒共用）
 *
 * 这套规则一旦两侧不一致，沙盒里能过的动作在线上会吃违规，
 * 所以逐条锁住：移动相邻/可通行、攻击距离与冷却、护盾状态、技能白名单。
 */

const { executeAgentAction } = require('../server/game/agentActionRules');
const { AIAgent } = require('../server/models/AIAgent');

const MAP = { width: 20, height: 20, obstacles: [[2, 1], [5, 5]] };

function pair() {
  const agent = new AIAgent('p1', [], 'P1');
  const enemy = new AIAgent('p2', [], 'P2');
  agent.x = 1; agent.y = 1;
  enemy.x = 3; enemy.y = 1; // dist 2
  return { agent, enemy };
}

// 技能 lastUsed 初始为 0，now 必须远大于各冷却（对局里就是 Date.now()）
const T0 = 1_000_000_000_000;
const run = (agent, enemy, action, now = T0) => executeAgentAction(agent, enemy, action, { now, map: MAP });

describe('executeAgentAction — 移动', () => {
  it('相邻且可通行才生效', () => {
    const { agent, enemy } = pair();
    expect(run(agent, enemy, { type: 'move', x: 1, y: 2 }).label).toBe('move');
    expect([agent.x, agent.y]).toEqual([1, 2]);
  });

  it('非相邻 / 障碍 / 越界均为无效动作', () => {
    const { agent, enemy } = pair();
    expect(run(agent, enemy, { type: 'move', x: 3, y: 3 })).toMatchObject({ label: 'idle(invalid_move)', invalid: true });
    expect(run(agent, enemy, { type: 'move', x: 2, y: 1 })).toMatchObject({ label: 'idle(invalid_move)', invalid: true });
    const edge = new AIAgent('p3', [], 'P3');
    edge.x = 0; edge.y = 0;
    expect(run(edge, enemy, { type: 'move', x: -1, y: 0 }).invalid).toBe(true);
  });
});

describe('executeAgentAction — 攻击与技能', () => {
  it('普攻需要距离 ≤2 且冷却就绪', () => {
    const { agent, enemy } = pair();
    const out = run(agent, enemy, { type: 'attack' }, T0);
    expect(out.label).toMatch(/^attack\(\d+\)$/);
    expect(enemy.hp).toBeLessThan(100);
    expect(run(agent, enemy, { type: 'attack' }, T0 + 100)).toMatchObject({ label: 'idle(cooldown)', invalid: true });
  });

  it('距离过远时攻击无效', () => {
    const { agent, enemy } = pair();
    enemy.x = 10; enemy.y = 10;
    expect(run(agent, enemy, { type: 'attack' })).toMatchObject({ label: 'idle(out_of_range)', invalid: true });
  });

  it('token_burst 走 1.5× 并进入冷却', () => {
    const { agent, enemy } = pair();
    const out = run(agent, enemy, { type: 'skill', id: 'token_burst' });
    expect(out.label).toMatch(/^token_burst\(\d+\)$/);
    expect(run(agent, enemy, { type: 'skill', id: 'token_burst' }, T0 + 100).label).toBe('idle(cooldown)');
  });

  it('dodge_roll 向敌方冲刺 3 格', () => {
    const { agent, enemy } = pair();
    const out = run(agent, enemy, { type: 'skill', id: 'dodge_roll' });
    expect(out.label).toBe('dash');
    expect(agent.x).toBe(4); // 1 + 3
    expect(agent.y).toBe(1);
  });

  it('未知技能 id 无效', () => {
    const { agent, enemy } = pair();
    expect(run(agent, enemy, { type: 'skill', id: 'teleport' })).toMatchObject({ label: 'idle(invalid_skill)', invalid: true });
  });
});

describe('executeAgentAction — 护盾与非法动作', () => {
  it('护盾激活与冷却状态都拒绝重复开启', () => {
    const { agent, enemy } = pair();
    expect(run(agent, enemy, { type: 'shield' }).label).toBe('shield');
    expect(agent.shieldActive).toBe(true);
    expect(run(agent, enemy, { type: 'shield' }, T0 + 100)).toMatchObject({ label: 'idle(shield_active)', invalid: true });

    const fresh = pair();
    fresh.agent.enableShield(5);
    expect(run(fresh.agent, fresh.enemy, { type: 'shield' }).invalid).toBe(true);
  });

  it('护盾冷却未结束时无效', () => {
    const { agent, enemy } = pair();
    expect(run(agent, enemy, { type: 'shield' }, T0).label).toBe('shield');
    agent.shieldActive = false;
    expect(run(agent, enemy, { type: 'shield' }, T0 + 200)).toMatchObject({ label: 'idle(cooldown)', invalid: true });
  });

  it('未知动作类型返回 idle(invalid_action)', () => {
    const { agent, enemy } = pair();
    expect(run(agent, enemy, { type: 'teleport' })).toMatchObject({ label: 'idle(invalid_action)', invalid: true });
    expect(run(agent, enemy, null)).toMatchObject({ label: 'idle(invalid_action)', invalid: true });
  });
});
