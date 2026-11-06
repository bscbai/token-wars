/**
 * LLM 示例 bot 的安全核心测试：
 * parseModelJson（宽容 JSON 抽取）+ sanitizeAction（按服务端规则拒绝非法动作）。
 * 决策网络部分（fetch/超时）由 420ms AbortController 保证，不在此测试。
 */

const { parseModelJson, sanitizeAction } = require('../examples/llm-bot-node/llm-bot.js');

function state(overrides = {}) {
  return {
    tick: 1,
    you: {
      x: 5, y: 5, hp: 100, maxHp: 100, shieldActive: false,
      skills: [
        { id: 'basic_attack', cooldownRemaining: 0 },
        { id: 'dodge_roll', cooldownRemaining: 0 },
        { id: 'shield', cooldownRemaining: 0 },
        { id: 'token_burst', cooldownRemaining: 5000 },
      ],
    },
    enemy: { x: 6, y: 5, hp: 80, maxHp: 100, visible: true },
    ...overrides,
  };
}

describe('parseModelJson', () => {
  it('纯 JSON', () => {
    expect(parseModelJson('{"action":{"type":"idle"}}')).toEqual({ action: { type: 'idle' } });
  });
  it('容忍前后缀文字与思考内容', () => {
    const out = parseModelJson('sure, {"thought":"approach","action":{"type":"move","x":6,"y":5}} done');
    expect(out.action).toEqual({ type: 'move', x: 6, y: 5 });
  });
  it('非法/空输入返回 null', () => {
    expect(parseModelJson('')).toBeNull();
    expect(parseModelJson('no json here')).toBeNull();
    expect(parseModelJson('{bad json}')).toBeNull();
    expect(parseModelJson(null)).toBeNull();
  });
});

describe('sanitizeAction', () => {
  it('idle 始终合法', () => {
    expect(sanitizeAction({ action: { type: 'idle' } }, state())).toEqual({ type: 'idle' });
  });

  it('合法相邻移动放行；越界/非相邻/障碍拒绝', () => {
    expect(sanitizeAction({ action: { type: 'move', x: 6, y: 5 } }, state())).toEqual({ type: 'move', x: 6, y: 5 });
    expect(sanitizeAction({ action: { type: 'move', x: 8, y: 5 } }, state())).toBeNull(); // 非相邻
    expect(sanitizeAction({ action: { type: 'move', x: -1, y: 5 } }, state())).toBeNull(); // 越界
    expect(sanitizeAction({ action: { type: 'move', x: 5.5, y: 5 } }, state())).toBeNull(); // 非整数
  });

  it('攻击要求距离 ≤2 且冷却就绪', () => {
    expect(sanitizeAction({ action: { type: 'attack' } }, state())).toEqual({ type: 'attack' });
    const far = state({ enemy: { x: 20, y: 20, hp: 1, visible: true } });
    expect(sanitizeAction({ action: { type: 'attack' } }, far)).toBeNull();
    const onCooldown = state();
    onCooldown.you.skills[0].cooldownRemaining = 1000;
    expect(sanitizeAction({ action: { type: 'attack' } }, onCooldown)).toBeNull();
  });

  it('敌人不可见时攻击拒绝', () => {
    const s = state({ enemy: { visible: false } });
    expect(sanitizeAction({ action: { type: 'attack' } }, s)).toBeNull();
  });

  it('护盾：未激活且冷却就绪才合法', () => {
    expect(sanitizeAction({ action: { type: 'shield' } }, state())).toEqual({ type: 'shield' });
    const active = state();
    active.you.shieldActive = true;
    expect(sanitizeAction({ action: { type: 'shield' } }, active)).toBeNull();
  });

  it('技能：未知 id 与冷却中拒绝；合法 dodge_roll 放行', () => {
    expect(sanitizeAction({ action: { type: 'skill', id: 'dodge_roll' } }, state())).toEqual({ type: 'skill', id: 'dodge_roll' });
    expect(sanitizeAction({ action: { type: 'skill', id: 'meteor' } }, state())).toBeNull();
    expect(sanitizeAction({ action: { type: 'skill', id: 'token_burst' } }, state())).toBeNull(); // CD 5000
  });

  it('畸形输入一律 null（不抛错）', () => {
    expect(sanitizeAction(null, state())).toBeNull();
    expect(sanitizeAction({}, state())).toBeNull();
    expect(sanitizeAction({ action: 'nope' }, state())).toBeNull();
    expect(sanitizeAction({ action: { type: 'move' } }, state())).toBeNull();
  });
});
