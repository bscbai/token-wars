/**
 * 官方陪练 bot 测试（DEMO_HOUSEBOT）
 * 覆盖：部署即入队；houseBot 无视每日上限与对局冷却持续回队。
 */

const { Store } = require('../server/data/Store');
const Player = require('../server/models/Player');
const AIArenaManager = require('../server/game/AIArenaManager');

function makeMgr() {
  const store = new Store(':memory:', { migrate: false });
  const owner = new Player('house-owner');
  store.addPlayer(owner);
  const mgr = new AIArenaManager({ emit() {}, of() { return {}; } }, store, {});
  return { store, owner, mgr };
}

describe('house bot（官方陪练）', () => {
  let mgr;
  let owner;

  beforeEach(() => {
    ({ mgr, owner } = makeMgr());
  });

  it('deployHouseBot：标记 houseBot 并立即进入队列', () => {
    const agent = mgr.deployHouseBot(owner);
    expect(agent).toBeTruthy();
    expect(agent.houseBot).toBe(true);
    expect(agent.deployed).toBe(true);
    expect(mgr.matchQueue).toContain(agent.id);
  });

  it('每日比赛打满后仍可重新入队（普通 agent 会被 daily_cap 拦截）', () => {
    const agent = mgr.deployHouseBot(owner);
    mgr.leaveQueue(agent.id);
    agent.dailyMatches = 999;
    mgr.joinQueue(owner.id, agent.id);
    expect(mgr.matchQueue).toContain(agent.id);
  });

  it('对局冷却中仍可立即回队（普通 agent 有 5 分钟冷却）', () => {
    const agent = mgr.deployHouseBot(owner);
    mgr.leaveQueue(agent.id);
    agent.lastMatchTime = Date.now(); // 刚刚打完
    mgr.joinQueue(owner.id, agent.id);
    expect(mgr.matchQueue).toContain(agent.id);
  });

  it('重复入队不会产生重复队列项', () => {
    const agent = mgr.deployHouseBot(owner);
    mgr.joinQueue(owner.id, agent.id);
    mgr.joinQueue(owner.id, agent.id);
    expect(mgr.matchQueue.filter((id) => id === agent.id)).toHaveLength(1);
  });
});
