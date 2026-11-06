/**
 * bot-protocol 测试 — 外部 agent 接入协议（阶段 1，openspec/changes/agent-access-protocol）
 *
 * 覆盖：
 *   ① BotProtocol schema 校验与序列化（纯函数）
 *   ② ExternalBrain 通道语义（跨对局/迟到 tick 忽略、accept/decline、断连作废、latency）
 *   ③ ExternalMatchRunner 场景（正常击杀/超时 idle/连续超时判负/超预算/违规判负/断连判负/decline）
 *   ④ BuiltinBrain 对拍（同种子确定性——保障提取重构行为零变化）
 *   ⑤ AIArenaManager 外部 agent 生命周期 + Store botToken 反查
 *   ⑥ /api/bot 路由（签发/重置踢旧/协议 schema）+ socketAuth /bot 放行 + eventGuard bot 限流类
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { DatabaseSync } = require('node:sqlite');

const { AIAgent } = require('../server/models/AIAgent');
const Player = require('../server/models/Player');
const BotProtocol = require('../server/game/BotProtocol');
const BuiltinBrain = require('../server/game/BuiltinBrain');
const ExternalBrain = require('../server/game/ExternalBrain');
const ExternalMatchRunner = require('../server/game/ExternalMatchRunner');
const AIArenaManager = require('../server/game/AIArenaManager');
const { makeBotRouter } = require('../server/routes/bot');
const { makeAuth } = require('../server/routes/auth');
const { makeSocketAuth } = require('../server/middleware/socketAuth');
const { Store } = require('../server/data/Store');
const guard = require('../server/middleware/eventGuard');
const { EVENTS, BOT_PROTOCOL } = require('../shared/constants');

const V = BOT_PROTOCOL.VERSION;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEST_MAP = {
  id: 'test_map', name: '测试图', width: 20, height: 20,
  obstacles: [], spawnA: { x: 1, y: 1 }, spawnB: { x: 18, y: 18 },
};

// 双方出生点被封死的地图：P6 靠近时 x/y 均不可走 → 动作停留 idle
// （P7/P8 在 else-if 链中不可达，不会落入巡逻）。用于验证 P6 失败路径
// 与 BuiltinBrain 的种子无关性。
const BOXED_MAP = {
  id: 'boxed_map', name: '封锁图', width: 20, height: 20,
  obstacles: [
    [0, 1], [2, 1], [1, 0], [1, 2], // 封死 A(1,1)
    [19, 18], [17, 18], [18, 17], [18, 19], // 封死 B(18,18)
  ],
  spawnA: { x: 1, y: 1 }, spawnB: { x: 18, y: 18 },
};

// 确定性 PRNG（BuiltinBrain 对拍用）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-bot-'));
  return { dir, dbPath: path.join(dir, 'b.db') };
}

function readFromDisk(dbPath, id) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT data FROM players WHERE id = ?').get(id);
    return row ? JSON.parse(row.data) : null;
  } finally {
    db.close();
  }
}

// --- ② ExternalBrain 通道语义 -------------------------------------------------

describe('ExternalBrain 通道语义', () => {
  function makeBrain() {
    const emitted = [];
    const socket = { id: 'mock-sock', emit: (event, data) => emitted.push({ event, data }) };
    return { brain: new ExternalBrain({ socket }), emitted, socket };
  }

  it('decide 出站 bot:state 并回带 action 与 latencyMs', async () => {
    const { brain, emitted } = makeBrain();
    brain.beginMatch('m1');
    const p = brain.decide({ matchId: 'm1', tick: 7, you: { x: 1 } });
    const last = emitted[emitted.length - 1];
    expect(last.event).toBe(EVENTS.BOT_STATE);
    expect(last.data.tick).toBe(7);

    brain.receiveAction({ protocolVersion: V, matchId: 'm1', tick: 7, action: { type: 'idle' } });
    const r = await p;
    expect(r.msg.action.type).toBe('idle');
    expect(typeof r.latencyMs).toBe('number');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('跨对局 action 被忽略（matchId 不匹配）', async () => {
    const { brain } = makeBrain();
    brain.beginMatch('m1');
    let settled = 'pending';
    const p = brain.decide({ matchId: 'm1', tick: 1 }).then((r) => { settled = r; });

    brain.receiveAction({ protocolVersion: V, matchId: 'm0', tick: 1, action: { type: 'idle' } });
    await sleep(10);
    expect(settled).toBe('pending'); // 上一场的迟到 action 不应解析本场 tick

    brain.receiveAction({ protocolVersion: V, matchId: 'm1', tick: 1, action: { type: 'idle' } });
    await p;
    expect(settled).not.toBe('pending');
  });

  it('迟到/过期 tick 的 action 被忽略', async () => {
    const { brain } = makeBrain();
    brain.beginMatch('m1');
    let settled = 'pending';
    const p = brain.decide({ matchId: 'm1', tick: 5 }).then((r) => { settled = r; });

    brain.receiveAction({ protocolVersion: V, matchId: 'm1', tick: 4, action: { type: 'idle' } });
    await sleep(10);
    expect(settled).toBe('pending');

    brain.receiveAction({ protocolVersion: V, matchId: 'm1', tick: 5, action: { type: 'idle' } });
    await p;
    expect(settled).not.toBe('pending');
  });

  it('accept/decline 解析 waitAccept', async () => {
    const { brain } = makeBrain();
    const p = brain.waitAccept();
    brain.receiveAccept('decline');
    expect(await p).toBe('decline');
  });

  it('断连作废等待中的决策（runner 据此判负）', async () => {
    const { brain } = makeBrain();
    brain.beginMatch('m1');
    const p = brain.decide({ matchId: 'm1', tick: 1 });
    brain.receiveDisconnect();
    expect(await p).toEqual({ disconnected: true });
    expect(brain.disconnected).toBe(true);
    // 断连后 decide 直接返回 disconnected
    expect(await brain.decide({ matchId: 'm1', tick: 2 })).toEqual({ disconnected: true });
  });

  it('destroy 只清对局内状态，不影响跨对局复用', async () => {
    const { brain, emitted } = makeBrain();
    brain.beginMatch('m1');
    const p = brain.decide({ matchId: 'm1', tick: 1 });
    brain.destroy(); // 模拟 runner 终局调用
    brain.receiveAction({ protocolVersion: V, matchId: 'm1', tick: 1, action: { type: 'idle' } });
    await sleep(10); // pending 已清，迟到 action 不再解析（对局已结束）

    brain.beginMatch('m2'); // 同一 brain 开新局
    const p2 = brain.decide({ matchId: 'm2', tick: 1 });
    brain.receiveAction({ protocolVersion: V, matchId: 'm2', tick: 1, action: { type: 'move', x: 2, y: 1 } });
    const r = await p2;
    expect(r.msg.action).toEqual({ type: 'move', x: 2, y: 1 });
    void p; void emitted;
  });
});

// --- ③ ExternalMatchRunner 场景 ------------------------------------------------

const idleStrategy = () => ({ type: 'idle' });
const silentStrategy = () => null; // 不应答 → 决策超时

// 守法 bot：距离 >2 靠近；≤2 且冷却就绪才攻击，否则 idle
function aggressiveStrategy(state) {
  const { you, enemy } = state;
  const dist = Math.abs(you.x - enemy.x) + Math.abs(you.y - enemy.y);
  if (dist <= 2) {
    const atk = you.skills.find((s) => s.id === 'basic_attack');
    if (atk && atk.cooldownRemaining <= 0) return { type: 'attack' };
    return { type: 'idle' };
  }
  if (you.x !== enemy.x) return { type: 'move', x: you.x + Math.sign(enemy.x - you.x), y: you.y };
  return { type: 'move', x: you.x, y: you.y + Math.sign(enemy.y - you.y) };
}

// 违规 bot：永远尝试移动到越界坐标
const invalidStrategy = () => ({ type: 'move', x: 99, y: 99 });

function makeBot(side, respond, tokensUsed, emitted, accept) {
  let brain;
  const socket = {
    id: `mock-bot-${side}`,
    emit(event, data) {
      emitted.push({ event, data });
      if (event === EVENTS.BOT_MATCH_INVITE) {
        // acceptResolve 在 emit 返回后才由 waitAccept 设置，必须异步应答
        setTimeout(() => brain.receiveAccept(accept ? 'accept' : 'decline'), 0);
      } else if (event === EVENTS.BOT_STATE) {
        const action = respond(data);
        if (action) {
          brain.receiveAction({
            protocolVersion: V, matchId: data.matchId, tick: data.tick, action, tokensUsed,
          });
        }
      }
    },
  };
  brain = new ExternalBrain({ socket });
  return { brain, socket };
}

function setupMatch(opts = {}) {
  const {
    tickIntervalMs = 1,
    maxTimeMs = 3000,
    decisionDeadlineMs = 100,
    tokenBudget = BOT_PROTOCOL.TOKEN_BUDGET_DEFAULT,
    strategyA = idleStrategy,
    strategyB = idleStrategy,
    tokensUsedA = 0,
    acceptA = true,
    onActionA = null,
  } = opts;

  const agentA = new AIAgent('pA', [], 'BotA');
  const agentB = new AIAgent('pB', [], 'BotB');
  agentA.external = true;
  agentB.external = true;
  agentA.x = TEST_MAP.spawnA.x; agentA.y = TEST_MAP.spawnA.y;
  agentB.x = TEST_MAP.spawnB.x; agentB.y = TEST_MAP.spawnB.y;

  const match = {
    id: `ext-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    agentA: agentA.id, agentB: agentB.id,
    map: TEST_MAP.id, startTime: Date.now(),
    tickCount: 0, log: [], trace: [], external: true, winner: null,
  };

  const emitted = { A: [], B: [] };
  const resolved = [];
  const aiarena = { resolveMatch: (...args) => resolved.push(args) };

  const botA = makeBot('A', (state) => {
    const action = strategyA(state);
    if (action && onActionA) onActionA(state, botA.brain);
    return action;
  }, tokensUsedA, emitted.A, acceptA);
  const botB = makeBot('B', strategyB, 0, emitted.B, true);

  const runner = new ExternalMatchRunner(
    aiarena,
    { match, agentA, agentB, map: TEST_MAP, brains: { A: botA.brain, B: botB.brain } },
    { tickIntervalMs, maxTimeMs, decisionDeadlineMs, tokenBudget }
  );

  return { runner, match, agentA, agentB, botA, botB, emitted, resolved };
}

describe('ExternalMatchRunner 对局流程', () => {
  it('正常对局：击杀终局 + trace + latency/token 计量 + match_end 双端', async () => {
    const { runner, match, agentA, agentB, emitted, resolved } = setupMatch({ strategyA: aggressiveStrategy });
    agentB.hp = 5; // calcDamage(10, 1.0, 5) = 5 → 一击必杀

    const result = await runner.start();
    expect(result.started).toBe(true);
    expect(resolved).toHaveLength(1); // 终局复用 aiarena.resolveMatch
    expect(agentB.alive).toBe(false);
    expect(agentA.alive).toBe(true);

    // match_end 双端都收到，result 与 stats 齐全
    const endA = emitted.A.find((e) => e.event === EVENTS.BOT_MATCH_END);
    const endB = emitted.B.find((e) => e.event === EVENTS.BOT_MATCH_END);
    expect(endA.data.result).toBe('win');
    expect(endB.data.result).toBe('loss');
    expect(endA.data.protocolVersion).toBe(V);
    expect(endA.data.stats.decisions).toBeGreaterThan(0);
    expect(typeof endA.data.stats.latencyP50Ms).toBe('number');
    expect(typeof endA.data.stats.latencyP99Ms).toBe('number');

    // 守法 bot 的每个动作服务端判定全部有效
    const aTrace = match.trace.filter((t) => t.side === 'A');
    expect(aTrace.length).toBeGreaterThan(0);
    expect(aTrace.every((t) => t.serverValid)).toBe(true);
    expect(aTrace.some((t) => t.action === 'attack(5)')).toBe(true);
    expect(match.stats.A.tokensUsed).toBe(0);
    expect(match.stats.A.violations).toBe(0);
  });

  it('token 自报计量：累计进 stats 并随 match_end 返回', async () => {
    const { runner, match } = setupMatch({
      strategyA: aggressiveStrategy, tokensUsedA: 7, maxTimeMs: 400,
    });
    await runner.start();
    expect(match.stats.A.tokensUsed).toBe(7 * match.stats.A.decisions);
    expect(match.stats.A.tokensUsed).toBeGreaterThan(0);
  });

  it('决策超时：按 idle(timeout) 计 trace；连续 3 次判负', async () => {
    const { runner, match, agentA, resolved } = setupMatch({
      strategyA: silentStrategy, decisionDeadlineMs: 50, maxTimeMs: 5000,
    });
    await runner.start();
    expect(agentA.alive).toBe(false);
    expect(match.stats.A.timeouts).toBeGreaterThanOrEqual(BOT_PROTOCOL.DECISION_TIMEOUT_LIMIT);
    expect(match.trace.some((t) => t.action === 'idle(timeout)')).toBe(true);
    expect(match.trace.some((t) => t.action === 'forfeit(timeout)')).toBe(true);
    expect(resolved).toHaveLength(1);
  });

  it('token 超预算：动作按 idle(budget) 拒绝，不计违规不判负', async () => {
    const { runner, match, agentA } = setupMatch({
      strategyA: aggressiveStrategy, tokensUsedA: 100,
      tokenBudget: 10, decisionDeadlineMs: 50, maxTimeMs: 400,
    });
    await runner.start();
    expect(match.stats.A.violations).toBe(0);
    expect(match.trace.some((t) => t.action === 'idle(budget)')).toBe(true);
    expect(match.stats.A.tokensUsed).toBeGreaterThan(10);
    expect(agentA.alive).toBe(true); // 预算超限不是判负条件
  });

  it('违规判负：单场非法动作 > VIOLATION_LIMIT(10)', async () => {
    const { runner, match, agentA } = setupMatch({
      strategyA: invalidStrategy, decisionDeadlineMs: 50, maxTimeMs: 10000,
    });
    await runner.start();
    expect(agentA.alive).toBe(false);
    expect(match.stats.A.violations).toBe(BOT_PROTOCOL.VIOLATION_LIMIT + 1);
    expect(match.trace.some((t) => t.action === 'forfeit(violation)')).toBe(true);
  });

  it('对局中断连：立即判负', async () => {
    const { runner, match, agentA } = setupMatch({
      strategyA: aggressiveStrategy, maxTimeMs: 10000,
      onActionA: (state, brain) => { if (state.tick >= 3) brain.receiveDisconnect(); },
    });
    await runner.start();
    expect(agentA.alive).toBe(false);
    expect(match.trace.some((t) => t.action === 'forfeit(disconnect)')).toBe(true);
  });

  it('邀请被拒：对局不开始、不调 resolveMatch、不计场次', async () => {
    const { runner, match, emitted, resolved } = setupMatch({ acceptA: false });
    const result = await runner.start();
    expect(result.started).toBe(false);
    expect(result.declinedBy).toBe('A');
    expect(resolved).toHaveLength(0);
    expect(match.trace).toHaveLength(0);
    expect(emitted.A.some((e) => e.event === EVENTS.BOT_MATCH_INVITE)).toBe(true);
  });
});

// --- ① BotProtocol schema 校验 -------------------------------------------------

describe('BotProtocol schema 校验', () => {
  const dims = { width: 20, height: 20 };
  const base = (over = {}) => ({ protocolVersion: V, matchId: 'm1', tick: 3, action: { type: 'idle' }, ...over });

  it('合法动作信封通过（tokensUsed 默认 0）', () => {
    expect(BotProtocol.validateActionMessage(base(), dims)).toEqual({ valid: true, action: { type: 'idle' }, tokensUsed: 0 });
    for (const action of [
      { type: 'move', x: 5, y: 5 },
      { type: 'attack' },
      { type: 'skill', id: 'token_burst' },
      { type: 'shield' },
    ]) {
      expect(BotProtocol.validateActionMessage(base({ action }), dims).valid).toBe(true);
    }
    expect(BotProtocol.validateActionMessage(base({ tokensUsed: 42 }), dims).tokensUsed).toBe(42);
  });

  it('协议版本不匹配拒绝', () => {
    expect(BotProtocol.validateActionMessage(base({ protocolVersion: 99 }), dims).code).toBe('unsupported_version');
  });

  it('信封字段缺失/非法', () => {
    expect(BotProtocol.validateActionMessage(base({ matchId: undefined }), dims).code).toBe('invalid_envelope');
    expect(BotProtocol.validateActionMessage(base({ matchId: 'x'.repeat(201) }), dims).code).toBe('invalid_envelope');
    expect(BotProtocol.validateActionMessage(base({ tick: -1 }), dims).code).toBe('invalid_envelope');
    expect(BotProtocol.validateActionMessage(base({ tick: 1.5 }), dims).code).toBe('invalid_envelope');
  });

  it('未知动作类型 / 越界坐标 / 未知技能 / 非法 tokensUsed', () => {
    expect(BotProtocol.validateActionMessage(base({ action: { type: 'fly' } }), dims).code).toBe('invalid_action_type');
    expect(BotProtocol.validateActionMessage(base({ action: { type: 'move', x: 20, y: 0 } }), dims).code).toBe('invalid_coordinates');
    expect(BotProtocol.validateActionMessage(base({ action: { type: 'move', x: -1, y: 0 } }), dims).code).toBe('invalid_coordinates');
    expect(BotProtocol.validateActionMessage(base({ action: { type: 'move', x: 1.5, y: 0 } }), dims).code).toBe('invalid_coordinates');
    expect(BotProtocol.validateActionMessage(base({ action: { type: 'skill', id: 'nope' } }), dims).code).toBe('invalid_skill');
    expect(BotProtocol.validateActionMessage(base({ tokensUsed: -1 }), dims).code).toBe('invalid_tokens_used');
    expect(BotProtocol.validateActionMessage(base({ tokensUsed: 1.5 }), dims).code).toBe('invalid_tokens_used');
  });

  it('序列化统一打协议版本戳', () => {
    expect(BotProtocol.serializeInvite({ matchId: 'm' }).protocolVersion).toBe(V);
    expect(BotProtocol.serializeState({ matchId: 'm', tick: 1 }).protocolVersion).toBe(V);
    expect(BotProtocol.serializeMatchEnd({ matchId: 'm', result: 'win', stats: {} }).protocolVersion).toBe(V);
    expect(BotProtocol.serializeError('c', 'm').protocolVersion).toBe(V);
  });
});

// --- ④ BuiltinBrain 对拍（确定性） ----------------------------------------------

describe('BuiltinBrain 对拍（提取重构行为零变化）', () => {
  // 记录型 brain 包装器：捕获每次 decide() 的动作标签做全序列对比。
  // 不比对 match.log——P2/P3/P4 才是唯一 pushLog 分支，空地固下
  // 双方 x 轴对齐后 dx=0、P6「移动 0 格」卡死（提取前原有行为），
  // log 为空序列；decide 动作序列才是行为零变化的完整证据。
  function runSeededMatch(seed, map = TEST_MAP) {
    const store = new Store(':memory:', { migrate: false });
    const inner = new BuiltinBrain();
    const actions = [];
    const recordingBrain = {
      decide: (agent, enemy, ctx) => {
        const r = inner.decide(agent, enemy, ctx);
        actions.push(`${agent.name}:${r.action}`);
        return r;
      },
    };
    const mgr = new AIArenaManager({ emit: () => {} }, store, {}, { brain: recordingBrain });
    const a = new AIAgent('p1', [], 'A');
    const b = new AIAgent('p2', [], 'B');
    const origRandom = Math.random;
    Math.random = mulberry32(seed);
    try {
      mgr.startMatch(a, b, map);
    } finally {
      Math.random = origRandom;
    }
    store.close();
    return actions;
  }

  it('同种子两次运行动作序列完全一致', () => {
    const l1 = runSeededMatch(42);
    const l2 = runSeededMatch(42);
    expect(l1.length).toBeGreaterThan(10);
    expect(l2).toEqual(l1);
  });

  it('种子无关：P1–P6 对 dist 完备，P7/P8 不可达 → 决策不消费 Math.random', () => {
    // else-if 链中 P4(dist<=2) 与 P6(dist>2) 完备，P7/P8 是提取前即存在的
    // 不可达分支（原内联实现同样如此，git diff 可证）——BuiltinBrain 从不调用
    // Math.random，故换种子结果不变。若未来重构使 P7/P8 可达，此测试失败以
    // 提示复核对拍基线。
    const l42 = runSeededMatch(42, BOXED_MAP);
    const l43 = runSeededMatch(43, BOXED_MAP);
    expect(l43).toEqual(l42);
    // 封锁图：P6 双向不可走 → 动作停留 idle（而非落入 P8 巡逻）
    expect(l42.length).toBeGreaterThan(10);
    expect(l42.every((e) => e.endsWith(':idle'))).toBe(true);
  });
});

// --- ⑤ AIArenaManager 外部生命周期 + Store 反查 ----------------------------------

describe('AIArenaManager 外部 agent 生命周期', () => {
  let store, mgr, player;

  beforeEach(() => {
    store = new Store(':memory:', { migrate: false });
    mgr = new AIArenaManager({ emit: () => {} }, store, {});
    player = new Player('botmaster');
    store.addPlayer(player);
  });

  afterEach(() => store.close());

  it('注册即入队（external/brain/deployed 就位）', () => {
    let destroyed = 0;
    const brain = { destroy: () => { destroyed++; } };
    const agent = mgr.registerExternalAgent(player.id, brain);
    expect(agent.external).toBe(true);
    expect(agent.brain).toBe(brain);
    expect(agent.deployed).toBe(true);
    expect(mgr.matchQueue).toContain(agent.id);
    expect(mgr.getExternalAgent(player.id)).toBe(agent);
    expect(destroyed).toBe(0);
  });

  it('recall 离队停用但保留 agent（AELO 历史不丢）', () => {
    const agent = mgr.registerExternalAgent(player.id, { destroy: () => {} });
    mgr.recallExternalAgent(player.id);
    expect(mgr.matchQueue).not.toContain(agent.id);
    expect(agent.deployed).toBe(false);
    expect(agent.brain).toBeNull();
    expect(mgr.agents.get(agent.id)).toBe(agent);
    expect(mgr.getExternalAgent(player.id)).toBe(agent); // agent 仍在（仅停用）
  });

  it('重连复用同一 agent，仅替换 brain 且不重复入队', () => {
    let destroyed = 0;
    const brain1 = { destroy: () => { destroyed++; } };
    const brain2 = { destroy: () => {} };
    const a1 = mgr.registerExternalAgent(player.id, brain1);
    const a2 = mgr.registerExternalAgent(player.id, brain2);
    expect(a2).toBe(a1);
    expect(destroyed).toBe(1); // 旧 brain 被销毁
    expect(a1.brain).toBe(brain2);
    expect(mgr.matchQueue.filter((id) => id === a1.id)).toHaveLength(1);
  });
});

describe('Store.getPlayerByBotToken', () => {
  it('按 token 反查玩家；无效/缺失 token 返回 null', () => {
    const store = new Store(':memory:', { migrate: false });
    const p1 = new Player('u1');
    const p2 = new Player('u2');
    p1.botToken = 'tok-1';
    store.addPlayer(p1);
    store.addPlayer(p2);
    expect(store.getPlayerByBotToken('tok-1')).toBe(p1);
    expect(store.getPlayerByBotToken('tok-1')).not.toBe(p2);
    expect(store.getPlayerByBotToken('nope')).toBeNull();
    expect(store.getPlayerByBotToken('')).toBeNull();
    expect(store.getPlayerByBotToken(undefined)).toBeNull();
    store.close();
  });
});

// --- ⑥ 路由 / 握手放行 / 限流类 --------------------------------------------------

describe('bot 路由（/api/bot）', () => {
  let ctx, store, app, token, player, kicked;

  beforeEach(async () => {
    ctx = tmpDb();
    store = new Store(ctx.dbPath, { migrate: false });
    const auth = makeAuth({ store, cfg: { JWT_SECRET: 'test-secret', JWT_EXPIRES: '1h' } });
    kicked = [];

    app = express();
    app.use(express.json());
    app.use('/api/auth', auth.router);
    app.use('/api/bot', makeBotRouter({
      store, verifySession: auth.verifySession,
      kickBotConnections: (id) => kicked.push(id),
    }));

    const res = await request(app).post('/api/auth/register').send({ username: 'botter', password: 'pass1234' });
    token = res.body.sessionToken;
    player = store.getPlayerByUsername('botter');
  });

  afterEach(() => {
    store.close();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  it('POST /token 无 JWT → 401', async () => {
    const res = await request(app).post('/api/bot/token');
    expect(res.status).toBe(401);
  });

  it('POST /token 签发 48 位 hex token 并即时落盘', async () => {
    const res = await request(app).post('/api/bot/token').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(false);
    expect(res.body.botToken).toMatch(/^[0-9a-f]{48}$/);
    expect(player.botToken).toBe(res.body.botToken);
    expect(store.getPlayerByBotToken(res.body.botToken)).toBe(player);
    // 从事务点读盘验证（重启进程可见）
    expect(readFromDisk(ctx.dbPath, player.id).botToken).toBe(res.body.botToken);
  });

  it('重置 token：踢旧连接 + 旧 token 作废', async () => {
    await request(app).post('/api/bot/token').set('Authorization', `Bearer ${token}`);
    const first = player.botToken;

    const res = await request(app).post('/api/bot/token').set('Authorization', `Bearer ${token}`);
    expect(res.body.reset).toBe(true);
    expect(res.body.botToken).not.toBe(first);
    expect(kicked).toEqual([player.id]);
    expect(store.getPlayerByBotToken(first)).toBeNull();
    expect(store.getPlayerByBotToken(res.body.botToken)).toBe(player);
  });

  it('GET /protocol 返回协议 schema（无需认证）', async () => {
    const res = await request(app).get('/api/bot/protocol');
    expect(res.status).toBe(200);
    expect(res.body.protocolVersion).toBe(BOT_PROTOCOL.VERSION);
    expect(res.body.namespace).toBe('/bot');
    expect(res.body.actionTypes).toEqual(expect.arrayContaining(['move', 'attack', 'skill', 'shield', 'idle']));
    expect(res.body.skillIds).toContain('basic_attack');
    expect(res.body.events.botToServer).toContain('bot:action');
    expect(res.body.events.serverToBot).toContain('bot:state');
    expect(res.body.parity.decisionDeadlineMs).toBe(BOT_PROTOCOL.DECISION_DEADLINE_MS);
    expect(res.body.parity.violationLimit).toBe(BOT_PROTOCOL.VIOLATION_LIMIT);
    expect(res.body.timing.stateHz).toBe(20);
  });
});

describe('socketAuth /bot 命名空间放行', () => {
  it('默认命名空间无 token 拒绝；/bot 命名空间无 JWT 也放行', () => {
    const mw = makeSocketAuth({ verifySession: () => null });

    let defaultErr = null;
    mw({ id: 's1', nsp: { name: '/' }, handshake: { auth: {} } }, (e) => { defaultErr = e; });
    expect(defaultErr).toBeInstanceOf(Error);

    let botNext = false;
    mw({ id: 's2', nsp: { name: '/bot' }, handshake: { auth: { botToken: 'x' } } }, () => { botNext = true; });
    expect(botNext).toBe(true); // 由 /bot 命名空间级 botToken 中间件认证
  });
});

describe('eventGuard bot 限流类', () => {
  it('bot 类 100/s 宽限（20Hz 对局的 5 倍余量）', () => {
    guard.rateLimiter.reset();
    const sid = 'bot-rl-test';
    for (let i = 0; i < 100; i++) {
      expect(guard.rateLimiter.consume(sid, 'bot')).toBe(true);
    }
    expect(guard.rateLimiter.consume(sid, 'bot')).toBe(false);
    guard.rateLimiter.cleanup(sid);
  });
});
