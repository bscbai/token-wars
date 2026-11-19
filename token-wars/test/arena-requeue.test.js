/**
 * 对局结束后自动重排的回归测试
 *
 * 背景：AIArenaManager.joinQueue 会把「对局冷却中」的 agent 直接丢弃（只发
 * queue_fail，不重试）。因此 resolveMatch 里的重新入队必须等到冷却结束，
 * 否则冷却 > 2s（正式服默认 5 分钟）时外部 agent 打完一场就再也不会回到
 * 队列，demo / 常驻服务器会停在第一场。
 */

const { Store } = require('../server/data/Store');
const Player = require('../server/models/Player');
const { AIAgent } = require('../server/models/AIAgent');

// 必须在 require 管理器之前设置：冷却时长在模块加载时读取
process.env.AI_MATCH_COOLDOWN_MS = '6000';
const AIArenaManager = require('../server/game/AIArenaManager');

const MAP = {
  id: 'data_mine',
  name: '数据矿洞',
  width: 20,
  height: 20,
  obstacles: [],
  spawnA: { x: 0, y: 0 },
  spawnB: { x: 19, y: 19 },
};

function setup() {
  const store = new Store(':memory:', { migrate: false });
  const player = new Player('requeue-owner');
  store.addPlayer(player);
  const mgr = new AIArenaManager({ emit() {}, of() { return {}; } }, store, {});
  mgr.tryMatch = () => {}; // 只验证入队，不触发真实的对外对局

  const a = new AIAgent(player.id, [], 'Alpha');
  const b = new AIAgent(player.id, [], 'Beta');
  for (const agent of [a, b]) {
    agent.external = true;
    agent.deployed = true;
    agent.brain = {};
  }
  mgr.agents.set(a.id, a);
  mgr.agents.set(b.id, b);

  const match = {
    id: 'requeue-match',
    agentA: a.id,
    agentB: b.id,
    map: MAP.id,
    startTime: Date.now(),
    tickCount: 10,
    log: [],
    trace: [],
    totalTicks: 10,
    totalTimeMs: 500,
    winner: null,
  };
  return { mgr, a, b, match };
}

describe('对局结束后的自动重排', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('外部 agent 等到冷却结束才回队（不会在 2s 时被冷却丢弃）', () => {
    vi.useFakeTimers();
    const { mgr, a, b, match } = setup();
    a.alive = false; // 让 b 获胜，走正常终局路径

    mgr.resolveMatch(match, a, b, MAP);

    vi.advanceTimersByTime(2500);
    expect(mgr.matchQueue).not.toContain(a.id);
    expect(mgr.matchQueue).not.toContain(b.id);

    vi.advanceTimersByTime(4500); // 累计 7000ms > 冷却 6000 + 500 缓冲
    expect(mgr.matchQueue).toContain(a.id);
    expect(mgr.matchQueue).toContain(b.id);
  });

  it('官方陪练 bot 不受冷却限制，2s 后即回队', () => {
    vi.useFakeTimers();
    const { mgr, a, b, match } = setup();
    a.houseBot = true;
    a.alive = false;

    mgr.resolveMatch(match, a, b, MAP);

    vi.advanceTimersByTime(2500);
    expect(mgr.matchQueue).toContain(a.id);
  });
});
