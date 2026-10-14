/**
 * tracks-parity 测试 — 三赛道分组 + parity 申报抽查（阶段 2，openspec/changes/archive/stage2-tracks-parity）
 *
 * 覆盖：
 *   ① 同赛道配对：同 track 两两配对、跨 track 永不交手、缺省车手组
 *   ② 申报：业务校验/覆盖更新/spec 白名单/归属
 *   ③ 抽查审计：注入 rng 控采样确定性；实测对照（合规/违规/undeclared/未抽中/无 stats）
 *   ④ 处罚：违规累计禁赛 + joinQueue 拒绝
 *   ⑤ 审计证据持久化恢复 + 排行榜 track 过滤
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { AIAgent } = require('../server/models/AIAgent');
const Player = require('../server/models/Player');
const AIArenaManager = require('../server/game/AIArenaManager');
const { Store } = require('../server/data/Store');
const { TRACKS, DEFAULT_TRACK, PARITY, BOT_PROTOCOL, EVENTS } = require('../shared/constants');

const TEST_MAP = {
  id: 'tp_map', name: '三赛道测试图', width: 20, height: 20,
  obstacles: [], spawnA: { x: 1, y: 1 }, spawnB: { x: 18, y: 18 },
};

const DECL = {
  model: 'glm-5.3', hardware: 'H100-x8', tokensPerDecision: 10, latencyBudgetMs: 10,
};

/** 与 ExternalMatchRunner 产出同形的对局对象（stats 可指定，便于实测对照） */
function makeStatsMatch(a, b, seq, statsA, statsB) {
  return {
    id: `tp-fake-${seq}-${Date.now()}`,
    agentA: a.id, agentB: b.id,
    map: TEST_MAP.id,
    startTime: Date.now(),
    tickCount: 3, totalTicks: 3,
    log: [],
    trace: [{ tick: 1, side: 'A', action: 'idle', latencyMs: 1, tokensUsed: 0, serverValid: true, at: 0 }],
    stats: statsA === undefined ? undefined : { A: statsA, B: statsB },
    external: true,
    winner: null,
  };
}

function freshStats(over = {}) {
  return { decisions: 2, latencyP50Ms: 3, latencyP99Ms: 5, tokensUsed: 20, timeouts: 0, violations: 0, ...over };
}

describe('同赛道配对', () => {
  let store, mgr, players;

  beforeEach(() => {
    store = new Store(':memory:', { migrate: false });
    mgr = new AIArenaManager({ emit: () => {} }, store, {});
    players = [];
    for (let i = 1; i <= 5; i++) {
      const p = new Player(`tp-${i}`);
      store.addPlayer(p);
      players.push(p);
    }
  });
  afterEach(() => store.close());

  it('同赛道自动配对，对局条目记录 track', () => {
    mgr.deployAgent(players[0].id, [], 'hardware');
    mgr.deployAgent(players[1].id, [], 'hardware');

    expect(mgr.matchHistory).toHaveLength(1);
    expect(mgr.matchHistory[0].track).toBe('hardware'); // entry.track 随对局持久化
  });

  it('跨赛道永不交手：队列并存但无对局', () => {
    mgr.deployAgent(players[0].id, [], 'agent');
    mgr.deployAgent(players[1].id, [], 'hardware');

    expect(mgr.matchHistory).toHaveLength(0);
    expect(mgr.matchQueue).toHaveLength(2);
  });

  it('同 track 第三人加入才配对（组内 AELO 邻近取前二）', () => {
    mgr.deployAgent(players[0].id, [], 'agent');
    mgr.deployAgent(players[1].id, [], 'hardware');
    mgr.deployAgent(players[2].id, [], 'agent'); // 与 players[0] 同赛道 → 配对

    expect(mgr.matchHistory).toHaveLength(1);
    const m = mgr.matchHistory[0];
    expect(m.track).toBe('agent');
    expect([m.agentA, m.agentB].sort()).toHaveLength(2);
    expect(mgr.matchQueue).toHaveLength(1); // hardware 玩家仍在等
  });

  it('未指定 track 缺省车手组；非法值回退默认', () => {
    mgr.deployAgent(players[0].id, []);
    mgr.deployAgent(players[1].id, [], 'bogus-track');

    const agents = [...mgr.agents.values()];
    expect(agents.every((a) => a.track === DEFAULT_TRACK)).toBe(true);
    expect(TRACKS.AGENT.id).toBe('agent');
    expect(Object.keys(TRACKS).map((k) => TRACKS[k].id).sort()).toEqual(['agent', 'hardware', 'model']);
  });
});

describe('parity 申报', () => {
  let mgr, a, b;

  beforeEach(() => {
    const store = new Store(':memory:', { migrate: false });
    mgr = new AIArenaManager({ emit: () => {} }, store, {});
    a = new AIAgent('p-a', [], 'DeclA');
    b = new AIAgent('p-b', [], 'DeclB');
    mgr.agents.set(a.id, a);
    mgr.agents.set(b.id, b);
  });

  it('合法申报落 agent 并回包；可覆盖更新', () => {
    const r = mgr.setParityDeclaration('p-a', a.id, DECL);
    expect(r.error).toBeUndefined();
    expect(r.declaration.model).toBe('glm-5.3');
    expect(r.declaration.tokensPerDecision).toBe(10);
    expect(typeof r.declaration.at).toBe('number');

    const r2 = mgr.setParityDeclaration('p-a', a.id, { ...DECL, model: 'glm-5.4' });
    expect(r2.declaration.model).toBe('glm-5.4'); // 覆盖而非追加
    expect(a.parityDeclaration.model).toBe('glm-5.4');
  });

  it('非法申报拒绝（空 model / 越界数值）', () => {
    expect(mgr.setParityDeclaration('p-a', a.id, { ...DECL, model: '' }).error).toBe('invalid_declaration');
    expect(mgr.setParityDeclaration('p-a', a.id, { ...DECL, tokensPerDecision: 0 }).error).toBe('invalid_declaration');
    expect(mgr.setParityDeclaration('p-a', a.id, { ...DECL, tokensPerDecision: BOT_PROTOCOL.TOKEN_BUDGET_DEFAULT + 1 }).error).toBe('invalid_declaration');
    expect(mgr.setParityDeclaration('p-a', a.id, { ...DECL, latencyBudgetMs: BOT_PROTOCOL.DECISION_DEADLINE_MS + 1 }).error).toBe('invalid_declaration');
    expect(mgr.setParityDeclaration('p-a', a.id, { ...DECL, tokensPerDecision: 1.5 }).error).toBe('invalid_declaration');
    expect(a.parityDeclaration).toBeNull();
  });

  it('spec 白名单：只留 weightsHash/apiVersion/params/quantization', () => {
    const r = mgr.setParityDeclaration('p-a', a.id, {
      ...DECL, spec: { weightsHash: 'sha256:abc', apiVersion: 'v2', evil: 'x', params: 70 },
    });
    expect(r.declaration.spec).toEqual({ weightsHash: 'sha256:abc', apiVersion: 'v2', params: '70' });
  });

  it('归属：他人 agent 拒绝；getParityStatus 仅本人', () => {
    expect(mgr.setParityDeclaration('p-b', a.id, DECL).error).toBe('forbidden');
    mgr.setParityDeclaration('p-a', a.id, DECL);
    expect(mgr.getParityStatus('p-b', a.id).error).toBe('forbidden');
    const status = mgr.getParityStatus('p-a', a.id);
    expect(status.declaration.model).toBe('glm-5.3');
    expect(status.parityFlags).toBe(0);
    expect(status.paritySuspended).toBe(false);
    expect(status.track).toBe(DEFAULT_TRACK);
  });
});

describe('parity 抽查审计', () => {
  let seq = 0;

  /** rng 恒 0 = 必抽中；构造 mgr 时注入 */
  function makeMgr(rng) {
    const store = new Store(':memory:', { migrate: false });
    return new AIArenaManager({ emit: () => {} }, store, {}, { rng });
  }

  function auditOf(mgr, match) {
    return mgr.matchHistory.find((m) => m.id === match.id).audit;
  }

  it('抽中 + 合规：checks 记实测对照，无违规', () => {
    const mgr = makeMgr(() => 0); // 必抽中
    const a = new AIAgent('p-a', [], 'AudA');
    const b = new AIAgent('p-b', [], 'AudB');
    b.alive = false;
    mgr.agents.set(a.id, a); // 申报按 agentId 索引 → 必须登记
    mgr.agents.set(b.id, b);
    mgr.setParityDeclaration('p-a', a.id, DECL); // 10 tok/决策 ≤ 实测 10；P99=5 ≤ 10×1.5

    const match = makeStatsMatch(a, b, ++seq, freshStats(), freshStats());
    mgr.resolveMatch(match, a, b, TEST_MAP);

    const audit = auditOf(mgr, match);
    expect(audit).toHaveLength(2); // 双方各一条
    const mine = audit.find((x) => x.agentId === a.id);
    expect(mine.violations).toEqual([]);
    expect(mine.checks).toHaveLength(2); // tokensPerDecision + latencyP99
    expect(mine.checks[0]).toEqual({ item: 'tokensPerDecision', declared: 10, measured: 10 });
    expect(a.parityFlags).toBe(0);
  });

  it('抽中 + 违规：实测超申报被记违规并累计 flags', () => {
    const mgr = makeMgr(() => 0);
    const a = new AIAgent('p-a', [], 'VioA');
    const b = new AIAgent('p-b', [], 'VioB');
    b.alive = false;
    mgr.agents.set(a.id, a);
    mgr.agents.set(b.id, b);
    mgr.setParityDeclaration('p-a', a.id, { ...DECL, tokensPerDecision: 5, latencyBudgetMs: 2 });
    // 实测 10 tok/决策 > 5；P99=5 > 2×1.5=3 → 双违规

    const match = makeStatsMatch(a, b, ++seq, freshStats(), freshStats());
    mgr.resolveMatch(match, a, b, TEST_MAP);

    const mine = auditOf(mgr, match).find((x) => x.agentId === a.id);
    expect(mine.violations).toEqual(['tokensPerDecision', 'latencyP99']);
    expect(a.parityFlags).toBe(2);
  });

  it('未申报记 undeclared（提示非违规）；未抽中 audit=null；无 stats 不可审计', () => {
    const mgr = makeMgr(() => 0);
    const a = new AIAgent('p-a', [], 'UndA');
    const b = new AIAgent('p-b', [], 'UndB');
    b.alive = false;

    const m1 = makeStatsMatch(a, b, ++seq, freshStats(), freshStats());
    mgr.resolveMatch(m1, a, b, TEST_MAP);
    const mine1 = auditOf(mgr, m1).find((x) => x.agentId === a.id);
    expect(mine1.checks).toEqual(['undeclared']);
    expect(mine1.violations).toEqual([]);
    expect(a.parityFlags).toBe(0);

    const mgr2 = makeMgr(() => 0.99); // 永不抽中
    const c = new AIAgent('p-c', [], 'NoSampleC');
    const d = new AIAgent('p-d', [], 'NoSampleD');
    d.alive = false;
    const m2 = makeStatsMatch(c, d, ++seq, freshStats(), freshStats());
    mgr2.resolveMatch(m2, c, d, TEST_MAP);
    expect(auditOf(mgr2, m2)).toBeNull();

    const e = new AIAgent('p-e', [], 'BuiltinE');
    const f = new AIAgent('p-f', [], 'BuiltinF');
    f.alive = false;
    const m3 = makeStatsMatch(e, f, ++seq); // 无 stats（内置对局形态）
    mgr.resolveMatch(m3, e, f, TEST_MAP);
    expect(auditOf(mgr, m3)).toEqual([]); // 抽中但无可审计数据
  });

  it('违规累计达上限禁赛：出队 + joinQueue 拒绝', () => {
    const mgr = makeMgr(() => 0);
    const p = new Player('tp-sus');
    const store = mgr.store;
    store.addPlayer(p);
    const a = new AIAgent(p.id, [], 'SusA');
    const b = new AIAgent('p-b', [], 'SusB');
    b.alive = false;
    mgr.agents.set(a.id, a);
    mgr.agents.set(b.id, b);
    mgr.setParityDeclaration(p.id, a.id, { ...DECL, tokensPerDecision: 5, latencyBudgetMs: 2 }); // 每场 2 违规（token + 延迟）

    for (let i = 0; i < 2; i++) {
      const m = makeStatsMatch(a, b, ++seq, freshStats(), freshStats());
      a.alive = true; b.alive = false;
      mgr.resolveMatch(m, a, b, TEST_MAP);
    }
    expect(a.parityFlags).toBeGreaterThanOrEqual(PARITY.VIOLATION_LIMIT);
    expect(a.paritySuspended).toBe(true);

    const emitted = [];
    mgr.registerSocket(p.id, { emit: (e, d) => emitted.push({ e, d }) });
    mgr.joinQueue(p.id, a.id);
    expect(mgr.matchQueue).not.toContain(a.id);
    expect(emitted.some((x) => x.e === 'ai_arena:queue_fail' && x.d.reason === 'parity_suspended')).toBe(true);
  });
});

describe('审计证据持久化 + 排行榜赛道过滤', () => {
  let dir, dbPath, seq = 0;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tracks-parity-'));
    dbPath = path.join(dir, 't.db');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('entry.audit 随 ai_matches 持久化，重启后完整恢复', () => {
    const store = new Store(dbPath, { migrate: false });
    const mgr1 = new AIArenaManager({ emit: () => {} }, store, {}, { rng: () => 0 });
    const a = new AIAgent('p-a', [], 'PerA');
    const b = new AIAgent('p-b', [], 'PerB');
    b.alive = false;
    mgr1.agents.set(a.id, a);
    mgr1.agents.set(b.id, b);
    mgr1.setParityDeclaration('p-a', a.id, { ...DECL, tokensPerDecision: 5 });
    const match = makeStatsMatch(a, b, ++seq, freshStats(), freshStats());
    mgr1.resolveMatch(match, a, b, TEST_MAP);
    const before = mgr1.matchHistory.at(-1).audit;
    expect(before[0].violations.length).toBeGreaterThan(0);
    store.close();

    const store2 = new Store(dbPath, { migrate: false });
    const mgr2 = new AIArenaManager({ emit: () => {} }, store2, {});
    expect(mgr2.matchHistory.at(-1).audit).toEqual(before); // 审计证据即遥测证据
    expect(mgr2.matchHistory.at(-1).track).toBe(DEFAULT_TRACK);
    store2.close();
  });

  it('getLeaderboard 按 track 过滤；缺省全量；非法值按全量', () => {
    const store = new Store(dbPath, { migrate: false });
    const mgr = new AIArenaManager({ emit: () => {} }, store, {});
    const mk = (id, track) => {
      const ag = new AIAgent(id, [], id, track);
      mgr.agents.set(ag.id, ag);
      return ag;
    };
    mk('p-h1', 'hardware');
    mk('p-h2', 'hardware');
    mk('p-m1', 'model');
    mk('p-a1', 'agent');

    expect(mgr.getLeaderboard(20, 'hardware')).toHaveLength(2);
    expect(mgr.getLeaderboard(20, 'model')).toHaveLength(1);
    expect(mgr.getLeaderboard(20, 'agent')).toHaveLength(1);
    expect(mgr.getLeaderboard(20)).toHaveLength(4);
    expect(mgr.getLeaderboard(20, 'hardware')[0].track).toBe('hardware');

    const emitted = [];
    mgr.registerSocket('p-a1', { emit: (e, d) => emitted.push({ e, d }) });
    mgr.sendLeaderboard('p-a1', { track: 'model' });
    expect(emitted.at(-1).d.entries).toHaveLength(1);
    expect(emitted.at(-1).d.track).toBe('model');

    mgr.sendLeaderboard('p-a1', { track: 'nope' }); // 非法值 → 全量
    expect(emitted.at(-1).d.entries).toHaveLength(4);
    expect(emitted.at(-1).d.track).toBeNull();
    store.close();
  });

  it('set_parity 回包事件（parity_set）携带申报或错误', () => {
    const store = new Store(dbPath, { migrate: false });
    const mgr = new AIArenaManager({ emit: () => {} }, store, {});
    const a = new AIAgent('p-a', [], 'EvA');
    mgr.agents.set(a.id, a);
    const emitted = [];
    mgr.registerSocket('p-a', { emit: (e, d) => emitted.push({ e, d }) });

    mgr.setParityDeclaration('p-a', a.id, DECL);
    expect(emitted.at(-1).e).toBe(EVENTS.AI_ARENA_PARITY_SET);
    expect(emitted.at(-1).d.declaration.model).toBe('glm-5.3');

    mgr.setParityDeclaration('p-a', a.id, { ...DECL, model: '' });
    expect(emitted.at(-1).d.error).toBe('invalid_declaration');

    mgr.sendParityStatus('p-a', a.id);
    expect(emitted.at(-1).e).toBe(EVENTS.AI_ARENA_PARITY_STATUS);
    expect(emitted.at(-1).d.declaration.model).toBe('glm-5.3');
    store.close();
  });
});
