/**
 * 单场分享页 /m/:matchId
 *
 * 社交平台抓 OG 卡不执行 JS，所以对阵信息必须由服务端渲染进去；
 * 同时要防住 agent 名里的 HTML（名字是玩家可控输入）。
 */

const express = require('express');
const request = require('supertest');
const { makeMatchShareRouter } = require('../server/routes/matchShare');

function replayFixture(overrides = {}) {
  return {
    matchId: 'm-1',
    track: 'agent',
    external: true,
    winner: 'A',
    ticks: 153,
    durationMs: 8900,
    map: { id: 'data_mine', name: '数据矿洞', width: 20, height: 20, obstacles: [[4, 4]] },
    agentA: { name: 'AI-Alpha', aelo: 810 },
    agentB: { name: 'AI-Beta', aelo: 790 },
    frames: [{ t: 2, a: { x: 1, y: 1, hp: 100, alive: true }, b: { x: 18, y: 18, hp: 100, alive: true } }],
    ...overrides,
  };
}

function appWith(replay) {
  const app = express();
  app.use('/m', makeMatchShareRouter({ aiarena: { getMatchReplay: () => replay } }));
  return app;
}

const PROXY = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tw.example.com' };

describe('GET /m/:matchId（单场分享页）', () => {
  it('服务端渲染对阵 OG 信息并注入回放 id', async () => {
    const res = await request(appWith(replayFixture())).get('/m/m-1').set(PROXY);
    expect(res.status).toBe(200);
    expect(res.text).toContain('property="og:title" content="AI-Alpha vs AI-Beta — Token Wars arena"');
    expect(res.text).toContain('153 ticks');
    expect(res.text).toContain('AI-Alpha wins');
    expect(res.text).toContain('rel="canonical" href="https://tw.example.com/m/m-1"');
    expect(res.text).toContain('window.__TW_MATCH__ = "m-1"');
    expect(res.text).toContain('src="/arena.js"'); // /m/<id> 下相对路径会 404
    expect(res.text).not.toContain('__ORIGIN__');
  });

  it('平局描述正确', async () => {
    const res = await request(appWith(replayFixture({ winner: 'draw' }))).get('/m/m-1');
    expect(res.text).toContain('· draw.');
  });

  it('agent 名中的 HTML 被转义（防注入）', async () => {
    const evil = replayFixture({
      agentA: { name: '<script>alert(1)</script>', aelo: 800 },
      agentB: { name: 'B"&<', aelo: 800 },
    });
    const res = await request(appWith(evil)).get('/m/m-1');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.text).toContain('B&quot;&amp;&lt;');
  });

  it('未收录的对局返回 404 且带返回链接', async () => {
    const res = await request(appWith(null)).get('/m/nope');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Back to the arena');
    expect(res.text).toContain('href="/arena"');
  });
});
