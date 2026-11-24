/**
 * 公开对局回放
 *
 * 观战页可以点开任意一场最近对局逐帧回放——这是分享链接的主要落点，
 * 所以必须：1) 模拟时真的记录帧；2) 公开接口只暴露位置/血量，不泄露
 * trace/latency/token/playerId；3) 未收录的对局返回 404。
 */

const express = require('express');
const request = require('supertest');

const { Store } = require('../server/data/Store');
const Player = require('../server/models/Player');
const { AIAgent } = require('../server/models/AIAgent');
const AIArenaManager = require('../server/game/AIArenaManager');
const { makeAiarenaRouter } = require('../server/routes/aiarena');

const MAP = {
  id: 'arena_dome',
  name: '竞技穹顶',
  width: 20,
  height: 20,
  obstacles: [[5, 5]],
  spawnA: { x: 1, y: 1 },
  spawnB: { x: 18, y: 18 },
};

function setup() {
  const store = new Store(':memory:', { migrate: false });
  const owner = new Player('replay-owner');
  store.addPlayer(owner);
  const mgr = new AIArenaManager({ emit() {}, of() { return {}; } }, store, {});
  mgr.tryMatch = () => {}; // 不触发赛后重排，保持测试确定

  const a = new AIAgent(owner.id, [], 'Replay-A');
  const b = new AIAgent(owner.id, [], 'Replay-B');
  mgr.startMatch(a, b, MAP); // 同步模拟 + 结算，会写入 history（含回放帧）

  const entry = mgr.matchHistory[mgr.matchHistory.length - 1];
  return { mgr, entry, a, b };
}

describe('对局回放：帧记录', () => {
  it('内置对局会记录位置/血量帧，并封顶 600 帧', () => {
    const { entry } = setup();
    expect(Array.isArray(entry.frames)).toBe(true);
    expect(entry.frames.length).toBeGreaterThan(5);
    expect(entry.frames.length).toBeLessThanOrEqual(600);
    for (const frame of entry.frames.slice(0, 3)) {
      expect(typeof frame.t).toBe('number');
      for (const side of ['a', 'b']) {
        expect(frame[side]).toMatchObject({
          x: expect.any(Number),
          y: expect.any(Number),
          hp: expect.any(Number),
          alive: expect.any(Boolean),
        });
      }
    }
  });
});

describe('getMatchReplay：公开字段', () => {
  it('返回地图几何、双方名称与回放帧，不含 trace/日志/身份', () => {
    const { mgr, entry } = setup();
    const replay = mgr.getMatchReplay(entry.id);

    expect(replay.matchId).toBe(entry.id);
    expect(replay.map).toMatchObject({ id: 'arena_dome', width: 20, height: 20 });
    expect(replay.map.obstacles).toEqual([[5, 5]]);
    expect(replay.agentA.name).toBe('AI-Replay-A');
    expect(replay.agentB.name).toBe('AI-Replay-B');
    expect(['A', 'B', 'draw']).toContain(replay.winner);
    expect(replay.frames).toEqual(entry.frames);

    const serialized = JSON.stringify(replay);
    expect(serialized).not.toContain('latencyMs');
    expect(serialized).not.toContain('playerId');
    expect(serialized).not.toContain('"trace"');
  });

  it('未收录的对局返回 null', () => {
    const { mgr } = setup();
    expect(mgr.getMatchReplay('nope')).toBe(null);
  });
});

describe('GET /api/ai-arena/matches/:matchId/replay', () => {
  function appWith(aiarena) {
    const app = express();
    app.use('/api/ai-arena', makeAiarenaRouter({ aiarena, verifySession: () => null }));
    return app;
  }

  it('无需登录即可获取回放', async () => {
    const fake = { getMatchReplay: (id) => (id === 'm-1' ? { matchId: 'm-1', frames: [] } : null) };
    const res = await request(appWith(fake)).get('/api/ai-arena/matches/m-1/replay');
    expect(res.status).toBe(200);
    expect(res.body.matchId).toBe('m-1');
  });

  it('未知对局返回 404', async () => {
    const fake = { getMatchReplay: () => null };
    const res = await request(appWith(fake)).get('/api/ai-arena/matches/missing/replay');
    expect(res.status).toBe(404);
  });
});
