/**
 * LLM 示例 bot 的纯函数与失败路径
 *
 * 这是文档里主推的「把 decide() 换成一次 LLM 调用」的成品形态，
 * 一旦解析/校验/超时兜底坏了，外部作者会白吃违规计数。
 */

const {
  sanitizeAction, parseModelJson, decide, buildUserContent, setMapInfo,
} = require('../examples/llm-bot-node/llm-bot');

const MAP = {
  width: 20,
  height: 20,
  obstacles: [[2, 1]],
  spawnA: { x: 1, y: 1 },
  spawnB: { x: 18, y: 18 },
};

function state(overrides = {}) {
  return {
    matchId: 'm-1',
    tick: 3,
    timeLeftMs: 100000,
    you: {
      x: 1, y: 1, hp: 100, maxHp: 100, shield: 0, shieldActive: false,
      skills: [
        { id: 'basic_attack', cooldownRemaining: 0 },
        { id: 'shield', cooldownRemaining: 0 },
        { id: 'token_burst', cooldownRemaining: 0 },
        { id: 'dodge_roll', cooldownRemaining: 500 },
      ],
    },
    enemy: { x: 3, y: 1, hp: 100, maxHp: 100, visible: true },
    ...overrides,
  };
}

describe('parseModelJson', () => {
  it('容忍前后文字，抽出第一个完整 JSON 对象', () => {
    expect(parseModelJson('sure: {"action":{"type":"idle"}} ok')).toEqual({ action: { type: 'idle' } });
  });

  it('空串/纯文本返回 null', () => {
    expect(parseModelJson('')).toBe(null);
    expect(parseModelJson('no json here')).toBe(null);
    expect(parseModelJson('{broken')).toBe(null);
  });
});

describe('sanitizeAction', () => {
  beforeEach(() => setMapInfo(MAP));
  afterEach(() => setMapInfo(null));

  it('idle 恒定合法', () => {
    expect(sanitizeAction({ action: { type: 'idle' } }, state())).toEqual({ type: 'idle' });
  });

  it('move 只接受相邻且可通行的格子', () => {
    const s = state();
    expect(sanitizeAction({ action: { type: 'move', x: 1, y: 2 } }, s)).toEqual({ type: 'move', x: 1, y: 2 });
    expect(sanitizeAction({ action: { type: 'move', x: 2, y: 1 } }, s)).toBe(null); // 障碍
    expect(sanitizeAction({ action: { type: 'move', x: 5, y: 5 } }, s)).toBe(null); // 不相邻
    expect(sanitizeAction({ action: { type: 'move', x: 1.5, y: 2 } }, s)).toBe(null); // 非整数
    const edge = state();
    edge.you = { ...edge.you, x: 0, y: 0 };
    expect(sanitizeAction({ action: { type: 'move', x: -1, y: 0 } }, edge)).toBe(null); // 越界
  });

  it('attack 需要距离 ≤2 且基础攻击就绪', () => {
    expect(sanitizeAction({ action: { type: 'attack' } }, state())).toEqual({ type: 'attack' });
    const far = state({ enemy: { x: 10, y: 10, hp: 100, maxHp: 100, visible: true } });
    expect(sanitizeAction({ action: { type: 'attack' } }, far)).toBe(null);
    const cooling = state();
    cooling.you.skills[0].cooldownRemaining = 300;
    expect(sanitizeAction({ action: { type: 'attack' } }, cooling)).toBe(null);
  });

  it('skill 只接受白名单且冷却就绪', () => {
    expect(sanitizeAction({ action: { type: 'skill', id: 'token_burst' } }, state()))
      .toEqual({ type: 'skill', id: 'token_burst' });
    expect(sanitizeAction({ action: { type: 'skill', id: 'dodge_roll' } }, state())).toBe(null); // 冷却中
    expect(sanitizeAction({ action: { type: 'skill', id: 'basic_attack' } }, state())).toBe(null); // 非 skill 白名单
  });

  it('shield 仅在未激活时合法', () => {
    expect(sanitizeAction({ action: { type: 'shield' } }, state())).toEqual({ type: 'shield' });
    const active = state();
    active.you.shieldActive = true;
    expect(sanitizeAction({ action: { type: 'shield' } }, active)).toBe(null);
  });

  it('未知类型/缺字段返回 null', () => {
    expect(sanitizeAction({ action: { type: 'teleport' } }, state())).toBe(null);
    expect(sanitizeAction({}, state())).toBe(null);
    expect(sanitizeAction(null, state())).toBe(null);
  });
});

describe('buildUserContent', () => {
  it('下发地图几何与障碍（否则模型会撞墙）', () => {
    const content = JSON.parse(buildUserContent(state(), MAP));
    expect(content.map).toEqual({ width: 20, height: 20, obstacles: [[2, 1]] });
    expect(content.you.x).toBe(1);
    expect(content.enemy.visible).toBe(true);
  });

  it('无地图时 map 为 null', () => {
    expect(JSON.parse(buildUserContent(state(), null)).map).toBe(null);
  });
});

describe('decide 失败路径（全部回退 idle，不抛错）', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    setMapInfo(null);
  });

  function mockFetch(impl) {
    global.fetch = vi.fn(impl);
  }

  it('成功时返回模型动作并上报 token 用量', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"action":{"type":"attack"}}' } }],
        usage: { total_tokens: 321 },
      }),
    }));
    const out = await decide(state());
    expect(out).toEqual({ action: { type: 'attack' }, tokensUsed: 321 });
  });

  it('模型给出非法动作时回退 idle，但仍上报 token', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"action":{"type":"move","x":9,"y":9}}' } }],
        usage: { total_tokens: 120 },
      }),
    }));
    const out = await decide(state());
    expect(out).toEqual({ action: { type: 'idle' }, tokensUsed: 120 });
  });

  it('HTTP 错误回退 idle 且 token 计 0', async () => {
    mockFetch(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    const out = await decide(state());
    expect(out).toEqual({ action: { type: 'idle' }, tokensUsed: 0 });
  });

  it('网络异常回退 idle', async () => {
    mockFetch(async () => { throw new Error('ECONNRESET'); });
    const out = await decide(state());
    expect(out).toEqual({ action: { type: 'idle' }, tokensUsed: 0 });
  });

  it('420ms 超时中止请求并回退 idle', async () => {
    mockFetch((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const out = await decide(state());
    expect(out).toEqual({ action: { type: 'idle' }, tokensUsed: 0 });
  });
});
