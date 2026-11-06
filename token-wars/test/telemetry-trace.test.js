/**
 * telemetry-trace 测试 — 遥测 trace 查询开放（阶段 2a，openspec/changes/telemetry-trace-query）
 *
 * 覆盖：
 *   ① AIArenaManager 查询语义：history playerIds、getMatchTrace（external 非空 /
 *      builtin 空数组 + stats null / side 过滤 / 归属 / result 视角）、
 *      getAgentMatches 归属与列表字段、sendReplay 越权加固与 trace 载荷
 *   ② REST /api/ai-arena：真实 aiarena 插件挂载（Context + express）后的
 *      401/403/404/200 + ?side 过滤 + list 端点归属
 */

const express = require('express');
const request = require('supertest');

const { AIAgent } = require('../server/models/AIAgent');
const Player = require('../server/models/Player');
const ExternalBrain = require('../server/game/ExternalBrain');
const ExternalMatchRunner = require('../server/game/ExternalMatchRunner');
const AIArenaManager = require('../server/game/AIArenaManager');
const { makeAuth } = require('../server/routes/auth');
const { Context } = require('../server/core/Context');
const { Store } = require('../server/data/Store');
const aiarenaPlugin = require('../server/plugins/aiarena');
const { EVENTS, BOT_NAMESPACE } = require('../shared/constants');

const TEST_MAP = {
  id: 'test_map', name: '测试图', width: 20, height: 20,
  obstacles: [], spawnA: { x: 1, y: 1 }, spawnB: { x: 18, y: 18 },
};

const idleStrategy = () => ({ type: 'idle' });

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

// mock bot socket：BOT_STATE 到达即按策略应答 action（与 bot-protocol.test.js 同型）
function makeBot(side, respond, tokensUsed, emitted, accept = true) {
  let brain;
  const socket = {
    id: `mock-bot-${side}`,
    emit(event, data) {
      emitted.push({ event, data });
      if (event === EVENTS.BOT_MATCH_INVITE) {
        setTimeout(() => brain.receiveAccept(accept ? 'accept' : 'decline'), 0);
      } else if (event === EVENTS.BOT_STATE) {
        const action = respond(data);
        if (action) {
          brain.receiveAction({
            protocolVersion: 1, matchId: data.matchId, tick: data.tick, action, tokensUsed,
          });
        }
      }
    },
  };
  brain = new ExternalBrain({ socket });
  return { brain, socket };
}

/**
 * 打一场 external 对局并落入 mgr.matchHistory（终局经 resolveMatch 复用全部赛后处理）。
 * B 方挂机且残血 → A 靠近后一击必杀（A win）。tickIntervalMs=1 保证测试秒级完成。
 */
async function runExternalMatch(mgr, { playerAId, playerBId, nameA = 'ExtA', nameB = 'ExtB' } = {}) {
  const agentA = new AIAgent(playerAId, [], nameA);
  const agentB = new AIAgent(playerBId, [], nameB);
  agentA.external = true;
  agentB.external = true;
  mgr.agents.set(agentA.id, agentA); // 与 registerExternalAgent 一致：入 agents 表
  mgr.agents.set(agentB.id, agentB);
  agentA.x = TEST_MAP.spawnA.x; agentA.y = TEST_MAP.spawnA.y;
  agentB.x = TEST_MAP.spawnB.x; agentB.y = TEST_MAP.spawnB.y;
  agentB.hp = 5; // calcDamage(10, 1.0, 5) = 5 → 一击必杀

  const match = {
    id: `ext-tt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    agentA: agentA.id, agentB: agentB.id,
    map: TEST_MAP.id, startTime: Date.now(),
    tickCount: 0, log: [], trace: [], external: true, winner: null,
  };

  const emitted = { A: [], B: [] };
  const botA = makeBot('A', aggressiveStrategy, 0, emitted.A);
  const botB = makeBot('B', idleStrategy, 0, emitted.B);

  const runner = new ExternalMatchRunner(
    { resolveMatch: (...args) => mgr.resolveMatch(...args) },
    { match, agentA, agentB, map: TEST_MAP, brains: { A: botA.brain, B: botB.brain } },
    { tickIntervalMs: 1, maxTimeMs: 3000, decisionDeadlineMs: 100 }
  );
  await runner.start();
  return { match, agentA, agentB };
}

// --- ① AIArenaManager 查询语义 -------------------------------------------------

describe('AIArenaManager 遥测查询语义', () => {
  let store, mgr, pA, pB, pC;

  beforeEach(() => {
    store = new Store(':memory:', { migrate: false });
    mgr = new AIArenaManager({ emit: () => {} }, store, {});
    pA = new Player('tt-a'); store.addPlayer(pA);
    pB = new Player('tt-b'); store.addPlayer(pB);
    pC = new Player('tt-c'); store.addPlayer(pC);
  });

  afterEach(() => store.close());

  it('external 对局：history 落 playerIds；trace/stats 非空；result 随查询视角', async () => {
    const { match, agentA } = await runExternalMatch(mgr, { playerAId: pA.id, playerBId: pB.id });

    const hist = mgr.matchHistory.at(-1);
    expect(hist.id).toBe(match.id);
    expect(hist.agentAPlayerId).toBe(pA.id); // 归属基础：agent 可删/换，不能反查玩家
    expect(hist.agentBPlayerId).toBe(pB.id);

    const fromA = mgr.getMatchTrace(pA.id, match.id);
    expect(fromA.error).toBeUndefined();
    expect(fromA.external).toBe(true);
    expect(fromA.result).toBe('win'); // A 一击必杀 B
    expect(fromA.traceCount).toBe(fromA.trace.length);
    expect(fromA.trace.length).toBeGreaterThan(0);
    expect(fromA.trace.every((t) => typeof t.latencyMs === 'number')).toBe(true);
    expect(fromA.stats.decisions).toBeGreaterThan(0);
    expect(fromA.stats).toBe(match.stats.A);

    expect(mgr.getMatchTrace(pB.id, match.id).result).toBe('loss'); // 对手视角
    expect(mgr.getMatchTrace(pC.id, match.id)).toEqual({ error: 'forbidden' });
    expect(mgr.getMatchTrace(pA.id, 'no-such-match')).toEqual({ error: 'match_not_found' });
    void agentA;
  });

  it('side 过滤：只留该侧 trace；非法值忽略（返全量）', async () => {
    const { match } = await runExternalMatch(mgr, { playerAId: pA.id, playerBId: pB.id });

    const full = mgr.getMatchTrace(pA.id, match.id);
    const onlyA = mgr.getMatchTrace(pA.id, match.id, { side: 'A' });
    const onlyB = mgr.getMatchTrace(pA.id, match.id, { side: 'B' });
    expect(onlyA.trace.every((t) => t.side === 'A')).toBe(true);
    expect(onlyB.trace.every((t) => t.side === 'B')).toBe(true);
    expect(onlyA.trace.length).toBeGreaterThan(0);
    expect(onlyA.trace.length).toBeLessThan(full.trace.length);
    expect(onlyA.traceCount).toBe(onlyA.trace.length);
    expect(mgr.getMatchTrace(pA.id, match.id, { side: 'Z' }).trace).toEqual(full.trace);
  });

  it('内置对局：无 trace 字段 → 查询返回空数组 + stats null（不伪造数据）', () => {
    const a = new AIAgent(pA.id, [], 'BuiltA');
    const b = new AIAgent(pB.id, [], 'BuiltB');
    mgr.agents.set(a.id, a);
    mgr.agents.set(b.id, b);
    mgr.startMatch(a, b, TEST_MAP);

    const hist = mgr.matchHistory.at(-1);
    expect(hist.external).toBeFalsy();
    expect(hist.trace).toBeUndefined();

    const r = mgr.getMatchTrace(pA.id, hist.id);
    expect(r.external).toBe(false);
    expect(r.trace).toEqual([]);
    expect(r.traceCount).toBe(0);
    expect(r.stats).toBeNull();
    expect(['win', 'loss', 'draw']).toContain(r.result);
  });

  it('训练对局：对手 playerId 为 system，归属仍只限本人', () => {
    const trainee = new AIAgent(pA.id, [], 'Trainee');
    mgr.agents.set(trainee.id, trainee);
    mgr.startTrainingMatch(pA.id, trainee.id);

    const hist = mgr.matchHistory.at(-1);
    expect(hist.isTraining).toBe(true);
    expect(hist.agentAPlayerId).toBe(pA.id);
    expect(hist.agentBPlayerId).toBe('system');

    expect(mgr.getMatchTrace(pA.id, hist.id).error).toBeUndefined();
    expect(mgr.getMatchTrace(pB.id, hist.id)).toEqual({ error: 'forbidden' }); // 旁观者不可见
  });

  it('getAgentMatches：主人拿列表（traceCount + 本人 stats）；他人/不存在 → forbidden', async () => {
    const { agentA } = await runExternalMatch(mgr, { playerAId: pA.id, playerBId: pB.id });

    const list = mgr.getAgentMatches(pA.id, agentA.id);
    expect(list.error).toBeUndefined();
    expect(list.agentId).toBe(agentA.id);
    expect(list.matches).toHaveLength(1);
    expect(list.matches[0].traceCount).toBeGreaterThan(0);
    expect(list.matches[0].stats.decisions).toBeGreaterThan(0);

    expect(mgr.getAgentMatches(pB.id, agentA.id)).toEqual({ error: 'forbidden' });
    expect(mgr.getAgentMatches(pA.id, 'ghost-agent')).toEqual({ error: 'forbidden' });
  });

  it('sendReplay 越权加固：非参赛方 forbidden；参赛方载荷追加 trace/stats', async () => {
    const { match } = await runExternalMatch(mgr, { playerAId: pA.id, playerBId: pB.id });

    const emittedA = [];
    mgr.registerSocket(pA.id, { emit: (e, d) => emittedA.push({ e, d }) });
    mgr.sendReplay(pA.id, match.id);
    const payload = emittedA.at(-1);
    expect(payload.e).toBe('ai_arena:replay');
    expect(payload.d.error).toBeUndefined();
    expect(payload.d.trace.length).toBeGreaterThan(0); // 加法扩展：既有字段不变
    expect(payload.d.stats).not.toBeNull();
    expect(payload.d.log).toBeDefined();

    const emittedC = [];
    mgr.registerSocket(pC.id, { emit: (e, d) => emittedC.push({ e, d }) });
    mgr.sendReplay(pC.id, match.id);
    expect(emittedC.at(-1).d).toEqual({ error: 'forbidden' });

    mgr.sendReplay(pA.id, 'no-such-match');
    expect(emittedA.at(-1).d).toEqual({ error: 'match_not_found' });
  });

  it('未注册 socket 的查询不炸（REST 路径无 socket 依赖）', async () => {
    const { match } = await runExternalMatch(mgr, { playerAId: pA.id, playerBId: pB.id });
    expect(() => mgr.sendReplay(pA.id, match.id)).not.toThrow();
  });
});

// --- ② REST /api/ai-arena（真实插件挂载） ----------------------------------------

describe('REST /api/ai-arena（aiarena 插件挂载后）', () => {
  let store, app, mgr, tokenA, tokenB, tokenC, playerA, playerB, extMatchId, builtinMatchId;

  beforeEach(async () => {
    store = new Store(':memory:', { migrate: false });
    const { router: authRouter, verifySession } = makeAuth({ store });

    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);

    // 真实挂载 aiarena 插件（io 仅需 of() 供 /bot 命名空间占位）
    const botNs = { use() {}, on() {} };
    const ctx = new Context({ app, io: { use() {}, of: () => botNs } });
    ctx.service('store', store);
    ctx.service('combat', {});
    ctx.service('auth', verifySession);
    ctx.enterPluginScope('aiarena');
    aiarenaPlugin.setup(ctx);
    ctx.exitPluginScope();
    mgr = ctx.get('aiarena');

    const register = async (name) => {
      const res = await request(app).post('/api/auth/register').send({ username: name, password: 'pass1234' });
      return res.body.sessionToken;
    };
    tokenA = await register('tele-a');
    tokenB = await register('tele-b');
    tokenC = await register('tele-c');
    playerA = store.getPlayerByUsername('tele-a');
    playerB = store.getPlayerByUsername('tele-b');

    // external 对局（A win）与内置对局各一场
    const ext = await runExternalMatch(mgr, { playerAId: playerA.id, playerBId: playerB.id });
    extMatchId = ext.match.id;
    const ba = new AIAgent(playerA.id, [], 'BuiltA');
    const bb = new AIAgent(playerB.id, [], 'BuiltB');
    mgr.agents.set(ba.id, ba);
    mgr.agents.set(bb.id, bb);
    mgr.startMatch(ba, bb, TEST_MAP);
    builtinMatchId = mgr.matchHistory.at(-1).id;
  });

  afterEach(() => store.close());

  it('无 token / 无效 token → 401', async () => {
    const noToken = await request(app).get(`/api/ai-arena/matches/${extMatchId}/trace`);
    expect(noToken.status).toBe(401);
    expect(noToken.body.error).toBe('No session token');

    const bad = await request(app).get('/api/ai-arena/matches/x/trace').set('Authorization', 'Bearer garbage');
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('Invalid session');
  });

  it('trace 端点：参赛方 200 全量；?side 过滤；非参赛方 403；不存在 404', async () => {
    const res = await request(app)
      .get(`/api/ai-arena/matches/${extMatchId}/trace`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.matchId).toBe(extMatchId);
    expect(res.body.external).toBe(true);
    expect(res.body.result).toBe('win');
    expect(res.body.traceCount).toBe(res.body.trace.length);
    expect(res.body.trace.length).toBeGreaterThan(0);
    expect(res.body.stats.decisions).toBeGreaterThan(0);

    const sideB = await request(app)
      .get(`/api/ai-arena/matches/${extMatchId}/trace?side=B`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(sideB.status).toBe(200);
    expect(sideB.body.trace.every((t) => t.side === 'B')).toBe(true);
    expect(sideB.body.trace.length).toBeLessThan(res.body.trace.length);

    const stranger = await request(app)
      .get(`/api/ai-arena/matches/${extMatchId}/trace`)
      .set('Authorization', `Bearer ${tokenC}`);
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe('Not a participant');

    const missing = await request(app)
      .get('/api/ai-arena/matches/no-such-match/trace')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('Match not found');
  });

  it('内置对局 trace：200 + external false + 空数组 + stats null', async () => {
    const res = await request(app)
      .get(`/api/ai-arena/matches/${builtinMatchId}/trace`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.external).toBe(false);
    expect(res.body.trace).toEqual([]);
    expect(res.body.stats).toBeNull();
  });

  it('list 端点：本人 agent 200（含 traceCount/stats）；他人 agent 403', async () => {
    // 取 external 对局的 agentA id（该 agent 仍登记在 mgr.agents）
    const agentAId = [...mgr.agents.values()].find((a) => a.external && a.playerId === playerA.id).id;

    const res = await request(app)
      .get(`/api/ai-arena/agents/${agentAId}/matches`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.agentId).toBe(agentAId);
    expect(res.body.matches).toHaveLength(1);
    expect(res.body.matches[0].traceCount).toBeGreaterThan(0);
    expect(res.body.matches[0].stats.decisions).toBeGreaterThan(0);

    const other = await request(app)
      .get(`/api/ai-arena/agents/${agentAId}/matches`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('Not your agent');
  });

  it('插件挂载冒烟：/api/ai-arena 在 express 路由栈中', () => {
    const mounted = app._router.stack.some((layer) => layer.regexp.test('/api/ai-arena/matches/x/trace'));
    expect(mounted).toBe(true);
    expect(BOT_NAMESPACE).toBe('/bot');
  });
});
