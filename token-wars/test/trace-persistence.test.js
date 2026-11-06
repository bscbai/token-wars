/**
 * trace-persistence 测试 — 对局遥测 trace 持久化（阶段 2b，openspec/changes/trace-persistence）
 *
 * 覆盖：
 *   ① Store 归档接口：saveMatch 落库 + 重开库读回完整（trace/stats/归属/嵌套 mapData）、
 *      loadMatches 排序与 limit、pruneMatches 裁剪、坏行跳过、store 关闭后安全返回
 *   ② AIArenaManager 恢复语义：真实 resolveMatch 落库 → 重启（同库新 Store + 新 manager）
 *      后 getMatchTrace/sendReplay 与重启前一致；builtin 对局兜底 [] + stats null；
 *      maxHistoryLength 裁剪集成；落库失败不阻塞对局
 *
 * 说明：trace 条目用与 ExternalMatchRunner 同形的固定值（非跑真实对局）——
 * 本能力验证的是 JSON round-trip 与恢复语义，trace 产出形状由 bot-protocol
 * 测试保障。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { AIAgent } = require('../server/models/AIAgent');
const AIArenaManager = require('../server/game/AIArenaManager');
const { Store } = require('../server/data/Store');

const TEST_MAP = {
  id: 'persist_map', name: '持久化测试图', width: 20, height: 20,
  obstacles: [], spawnA: { x: 1, y: 1 }, spawnB: { x: 18, y: 18 },
};

/** 与 ExternalMatchRunner 产出同形的对局对象；固定 trace/stats 便于重启前后比对 */
function makeMatch(a, b, seq) {
  return {
    id: `ext-fake-${seq}-${Date.now()}`,
    agentA: a.id, agentB: b.id,
    map: TEST_MAP.id,
    startTime: Date.now(),
    tickCount: 3, totalTicks: 3, totalTimeMs: 120,
    log: [{ tick: 1, agent: a.id, label: 'move(2,1)' }],
    trace: [
      { tick: 1, side: 'A', action: 'move(2,1)', latencyMs: 3, tokensUsed: 12, serverValid: true, at: 1791822279000 },
      { tick: 1, side: 'B', action: 'idle', latencyMs: 5, tokensUsed: 0, serverValid: true, at: 1791822279000 },
      { tick: 2, side: 'A', action: 'attack', latencyMs: 2, tokensUsed: 8, serverValid: true, at: 1791822279050 },
    ],
    stats: {
      A: { decisions: 2, latencyP50Ms: 3, latencyP99Ms: 3, tokensUsed: 20, timeouts: 0, violations: 0 },
      B: { decisions: 1, latencyP50Ms: 5, latencyP99Ms: 5, tokensUsed: 0, timeouts: 1, violations: 0 },
    },
    external: true,
    winner: null,
  };
}

describe('Store 对局归档接口', () => {
  let dir, dbPath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-trace-persist-'));
    dbPath = path.join(dir, 't.db');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('saveMatch 落库 → 重开同库读回完整（trace/stats/归属/嵌套 mapData）', () => {
    const a = new AIAgent('p-a', [], 'PersistA');
    const b = new AIAgent('p-b', [], 'PersistB');
    const match = makeMatch(a, b, 1);
    const entry = {
      ...match,
      agentAName: a.name, agentBName: b.name,
      agentAAelo: a.aelo, agentBAelo: b.aelo,
      agentAPlayerId: 'p-a', agentBPlayerId: 'p-b',
      mapData: {
        id: TEST_MAP.id, name: TEST_MAP.name, width: 20, height: 20,
        obstacles: [[4, 4], [4, 15]], spawnA: { x: 1, y: 1 }, spawnB: { x: 18, y: 18 },
      },
      winner: a.id, winnerAelo: 1012, loserAelo: 988,
      saved: Date.now(),
    };

    const store = new Store(dbPath, { migrate: false });
    expect(store.saveMatch(entry)).toBe(true);
    store.close();

    const reopened = new Store(dbPath, { migrate: false }); // 模拟重启
    const rows = reopened.loadMatches();
    reopened.close();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(entry.id);
    expect(rows[0].agentAPlayerId).toBe('p-a'); // 归属基础必须存活
    expect(rows[0].agentBPlayerId).toBe('p-b');
    expect(rows[0].trace).toEqual(entry.trace); // 逐条 round-trip
    expect(rows[0].stats).toEqual(entry.stats);
    expect(rows[0].log).toEqual(entry.log);
    expect(rows[0].mapData.obstacles).toEqual([[4, 4], [4, 15]]); // 嵌套数组
    expect(rows[0].winner).toBe(a.id);
    expect(rows[0].saved).toBe(entry.saved);
  });

  it('loadMatches 新→旧排序 + limit 取最新', () => {
    const store = new Store(dbPath, { migrate: false });
    for (let i = 1; i <= 3; i++) {
      store.saveMatch({ id: `m${i}`, saved: 1000 + i, trace: [], agentAPlayerId: 'p' });
    }
    const all = store.loadMatches();
    expect(all.map((m) => m.id)).toEqual(['m3', 'm2', 'm1']);
    expect(store.loadMatches(2).map((m) => m.id)).toEqual(['m3', 'm2']);
    store.close();
  });

  it('pruneMatches(keep) 只保留最新 keep 行', () => {
    const store = new Store(dbPath, { migrate: false });
    for (let i = 1; i <= 3; i++) {
      store.saveMatch({ id: `m${i}`, saved: 1000 + i, trace: [] });
    }
    expect(store.pruneMatches(2)).toBe(1);
    expect(store.loadMatches(10).map((m) => m.id)).toEqual(['m3', 'm2']);
    expect(store.pruneMatches(10)).toBe(0); // 无裁剪
    store.close();
  });

  it('坏行（非法 JSON）跳过不阻断其余恢复', () => {
    const store = new Store(dbPath, { migrate: false });
    store.saveMatch({ id: 'good', saved: 2, trace: [{ tick: 1 }] });
    store.db.prepare('INSERT INTO ai_matches (id, data, saved) VALUES (?, ?, ?)')
      .run('corrupt', '{ not json', 1);
    const rows = store.loadMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('good');
    store.close();
  });

  it('store 关闭后 saveMatch/loadMatches/pruneMatches 安全返回，不抛', () => {
    const store = new Store(dbPath, { migrate: false });
    store.close();
    expect(store.saveMatch({ id: 'm', saved: 1 })).toBe(false);
    expect(store.loadMatches()).toEqual([]);
    expect(store.pruneMatches(5)).toBe(0);
    expect(() => store.saveMatch(null)).not.toThrow();
  });
});

describe('AIArenaManager 恢复语义（真实 resolveMatch 落库）', () => {
  let dir, dbPath, seq = 0;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-trace-restore-'));
    dbPath = path.join(dir, 't.db');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** 双 agent（B 已倒地 → A 胜）并经 resolveMatch 全量赛后处理落库 */
  function playMatch(mgr, { external = true, playerA = 'p-a', playerB = 'p-b' } = {}) {
    const a = new AIAgent(playerA, [], 'ArchA');
    const b = new AIAgent(playerB, [], 'ArchB');
    b.alive = false;
    const match = external ? makeMatch(a, b, ++seq) : {
      id: `built-fake-${++seq}-${Date.now()}`,
      agentA: a.id, agentB: b.id, map: TEST_MAP.id,
      startTime: Date.now(), tickCount: 1, log: [], winner: null,
    };
    mgr.resolveMatch(match, a, b, TEST_MAP);
    return match;
  }

  it('重启后 getMatchTrace 与重启前一致（trace/stats/result/external）', () => {
    const store = new Store(dbPath, { migrate: false });
    const mgr1 = new AIArenaManager({ emit: () => {} }, store, {});
    const match = playMatch(mgr1);
    const before = mgr1.getMatchTrace('p-a', match.id);
    store.close();

    const store2 = new Store(dbPath, { migrate: false }); // 模拟重启
    const mgr2 = new AIArenaManager({ emit: () => {} }, store2, {});
    const after = mgr2.getMatchTrace('p-a', match.id);
    store2.close();

    expect(before.trace.length).toBeGreaterThan(0);
    expect(after).toEqual(before); // 全字段一致即 round-trip 成立
    expect(mgr2.getMatchTrace('p-b', match.id).result).toBe('loss'); // 对手视角
    expect(mgr2.getMatchTrace('p-c', match.id)).toEqual({ error: 'forbidden' }); // 归属校验不因恢复失效
    expect(mgr2.getMatchTrace('p-a', 'ghost-match')).toEqual({ error: 'match_not_found' });
  });

  it('重启后 sendReplay 仍发 trace/stats；非参赛方仍被拦', () => {
    const store = new Store(dbPath, { migrate: false });
    const mgr1 = new AIArenaManager({ emit: () => {} }, store, {});
    const match = playMatch(mgr1);
    store.close();

    const store2 = new Store(dbPath, { migrate: false });
    const mgr2 = new AIArenaManager({ emit: () => {} }, store2, {});
    const emitted = [];
    mgr2.registerSocket('p-a', { emit: (e, d) => emitted.push({ e, d }) });
    mgr2.sendReplay('p-a', match.id);
    const payload = emitted.at(-1);
    expect(payload.e).toBe('ai_arena:replay');
    expect(payload.d.trace.length).toBe(3);
    expect(payload.d.stats).not.toBeNull();

    const stranger = [];
    mgr2.registerSocket('p-c', { emit: (e, d) => stranger.push({ e, d }) });
    mgr2.sendReplay('p-c', match.id);
    expect(stranger.at(-1).d).toEqual({ error: 'forbidden' });
    store2.close();
  });

  it('builtin 对局（无 trace/stats 字段）恢复后兜底 [] + stats null', () => {
    const store = new Store(dbPath, { migrate: false });
    const mgr1 = new AIArenaManager({ emit: () => {} }, store, {});
    const match = playMatch(mgr1, { external: false });
    store.close();

    const store2 = new Store(dbPath, { migrate: false });
    const mgr2 = new AIArenaManager({ emit: () => {} }, store2, {});
    const r = mgr2.getMatchTrace('p-a', match.id);
    store2.close();

    expect(r.external).toBe(false);
    expect(r.trace).toEqual([]);
    expect(r.traceCount).toBe(0);
    expect(r.stats).toBeNull();
  });

  it('裁剪集成：maxHistoryLength=2 时 3 场只保留最新 2 场（库与内存一致）', () => {
    const store = new Store(dbPath, { migrate: false });
    const mgr = new AIArenaManager({ emit: () => {} }, store, {});
    mgr.maxHistoryLength = 2;
    const m1 = playMatch(mgr);
    const m2 = playMatch(mgr);
    const m3 = playMatch(mgr);

    expect(store.loadMatches(10).map((m) => m.id)).toEqual([m3.id, m2.id]);
    expect(mgr.matchHistory.map((m) => m.id)).toEqual([m2.id, m3.id]);
    store.close();
  });

  it('落库失败不阻塞对局：store 已关闭时 resolveMatch 照常入内存 history', () => {
    const store = new Store(dbPath, { migrate: false });
    const mgr = new AIArenaManager({ emit: () => {} }, store, {});
    store.close();
    const match = playMatch(mgr); // saveMatch 返 false（isOpen 假），不得抛
    expect(mgr.matchHistory.at(-1).id).toBe(match.id);
    expect(mgr.getMatchTrace('p-a', match.id).error).toBeUndefined();
  });
});
