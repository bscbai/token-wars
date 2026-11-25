/**
 * Agent 战绩页 /a/:name 与公开档案接口
 *
 * 档案按对局历史聚合，因此重启后（内存 agent 消失）仍能给出战绩；
 * 页面服务端渲染（社交抓取不执行 JS），并要对显示名做转义。
 */

const express = require('express');
const request = require('supertest');

const { Store } = require('../server/data/Store');
const Player = require('../server/models/Player');
const { AIAgent } = require('../server/models/AIAgent');
const AIArenaManager = require('../server/game/AIArenaManager');
const { makeAiarenaRouter } = require('../server/routes/aiarena');
const { makeAgentProfileRouter } = require('../server/routes/agentProfile');

const MAP = {
  id: 'data_mine',
  name: '数据矿洞',
  width: 20,
  height: 20,
  obstacles: [],
  spawnA: { x: 1, y: 1 },
  spawnB: { x: 18, y: 18 },
};

function setup(matches = 4) {
  const store = new Store(':memory:', { migrate: false });
  const owner = new Player('profile-owner');
  store.addPlayer(owner);
  const mgr = new AIArenaManager({ emit() {}, of() { return {}; } }, store, {});
  mgr.tryMatch = () => {};

  const a = new AIAgent(owner.id, [], 'Profile-A');
  const b = new AIAgent(owner.id, [], 'Profile-B');
  for (let i = 0; i < matches; i++) mgr.startMatch(a, b, MAP);
  return { mgr, a, b };
}

describe('getAgentProfile（历史聚合）', () => {
  it('战绩等于历史场次，最近对局带对手与回放入口', () => {
    const { mgr } = setup(4);
    const profile = mgr.getAgentProfile('AI-Profile-A');

    expect(profile.name).toBe('AI-Profile-A');
    expect(profile.matches).toBe(4);
    expect(profile.wins + profile.losses + profile.draws).toBe(4);
    expect(profile.recent).toHaveLength(4);
    expect(profile.recent[0].opponent).toBe('AI-Profile-B');
    expect(['win', 'loss', 'draw']).toContain(profile.recent[0].result);
    expect(profile.recent[0].matchId).toBeTruthy();
    expect(typeof profile.aelo).toBe('number');
  });

  it('recent 受 limit 限制，未知 agent 返回 null', () => {
    const { mgr } = setup(4);
    expect(mgr.getAgentProfile('AI-Profile-A', { limit: 2 }).recent).toHaveLength(2);
    expect(mgr.getAgentProfile('AI-Nobody')).toBe(null);
  });
});

describe('GET /api/ai-arena/agents/:name/profile', () => {
  function appWith(fake) {
    const app = express();
    app.use('/api/ai-arena', makeAiarenaRouter({ aiarena: fake, verifySession: () => null }));
    return app;
  }

  it('公开返回档案', async () => {
    const fake = { getAgentProfile: () => ({ name: 'AI-X', matches: 3, wins: 2, losses: 1, draws: 0, recent: [] }) };
    const res = await request(appWith(fake)).get('/api/ai-arena/agents/AI-X/profile');
    expect(res.status).toBe(200);
    expect(res.body.matches).toBe(3);
  });

  it('未知 agent 返回 404', async () => {
    const fake = { getAgentProfile: () => null };
    const res = await request(appWith(fake)).get('/api/ai-arena/agents/AI-None/profile');
    expect(res.status).toBe(404);
  });
});

describe('GET /a/:name（战绩页）', () => {
  function pageApp(profile) {
    const app = express();
    app.use('/a', makeAgentProfileRouter({ aiarena: { getAgentProfile: () => profile } }));
    return app;
  }

  const profile = {
    name: 'AI-Alpha',
    active: true,
    track: 'agent',
    aelo: 812,
    wins: 7,
    losses: 3,
    draws: 2,
    matches: 12,
    recent: [
      { matchId: 'm-1', opponent: 'AI-Beta', result: 'win', ticks: 150, map: '数据矿洞' },
    ],
  };

  it('渲染战绩、对手与回放链接，并带 OG 卡', async () => {
    const res = await request(pageApp(profile)).get('/a/AI-Alpha')
      .set({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tw.example.com' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('AI-Alpha');
    expect(res.text).toContain('7W / 3L / 2D');
    expect(res.text).toContain('vs AI-Beta');
    expect(res.text).toContain('href="/m/m-1"');
    expect(res.text).toContain('rel="canonical" href="https://tw.example.com/a/AI-Alpha"');
    expect(res.text).toContain('property="og:title"');
  });

  it('显示名中的 HTML 被转义', async () => {
    const evil = { ...profile, name: '<img src=x onerror=alert(1)>' };
    const res = await request(pageApp(evil)).get('/a/evil');
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).toContain('&lt;img src=x');
  });

  it('未知 agent 返回 404 与返回链接', async () => {
    const res = await request(pageApp(null)).get('/a/none');
    expect(res.status).toBe(404);
    expect(res.text).toContain('href="/arena"');
  });
});
