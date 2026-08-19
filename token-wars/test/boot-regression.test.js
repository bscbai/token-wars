/**
 * M0 回归基线（openspec/changes/plugin-architecture · tasks.md 1.1–1.3）
 *
 * 目的：在插件化重构（M1–M5）动任何产品代码之前，把 server/index.js 与
 * GameEngine 的现状行为锁定为可执行断言。迁移每个阶段合入后，本文件必须
 * 保持全绿 —— 行为等价是插件化 proposal 的硬性验收条件。
 *
 * 锁定的三类行为：
 *   ① 玩家接入/断开 wiring：registerPlayer 对 6 个 manager 的
 *      registerSocket/unregisterSocket 调用，及会话顶替时旧 socket 的
 *      disconnect 守卫（不误注销新连接）。
 *   ② GameEngine.tick 节奏分发：mining 每 20 tick、worldBoss/aiArena 每
 *      100 tick、buff 清理/shield 流失每 10 tick（仅存活玩家）。
 *   ③ INPUT_SKILL 战斗上下文路由：副本优先 → 竞技场兜底 → 大厅静默忽略，
 *      含「副本 id 存在但实例已失效时穿透到竞技场」的顺序语义。
 *
 * 注：①③ 沿用 socket-auth.test.js 的「镜像」惯例（复制 index.js 的装配
 * 逻辑 + 替身 manager），因为直接 require server/index.js 会绑定端口启动
 * 真实服务。M1 落地 Loader 后，boot 路径将获得直接的组合测试。
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { Store } = require('../server/data/Store');
const { makeAuth } = require('../server/routes/auth');
const { makeSocketAuth } = require('../server/middleware/socketAuth');
const guard = require('../server/middleware/eventGuard');
const GameEngine = require('../server/game/GameEngine');
const { EVENTS, MAP_WIDTH, MAP_HEIGHT } = require('../shared/constants');

const JWT_SECRET = 'test-m0-regression-secret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- ① 玩家接入 wiring（镜像 server/index.js） -----------------------------

/** 替身 manager：记录 registerSocket/unregisterSocket/calculateOfflineMining 调用。 */
function spyManager() {
  const calls = { register: [], unregister: [], offline: [] };
  return {
    registerSocket(pid, sock) { calls.register.push([pid, sock]); },
    unregisterSocket(pid) { calls.unregister.push(pid); },
    calculateOfflineMining(p) { calls.offline.push(p && p.id); },
    _calls: calls,
  };
}

async function buildMirrorServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-m0-'));
  const store = new Store(path.join(dir, 'a.db'), { migrate: false });
  const auth = makeAuth({ store, cfg: { JWT_SECRET, JWT_EXPIRES: '1h' } });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', auth.router);

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  io.use(makeSocketAuth({ verifySession: auth.verifySession }));

  // 6 个替身 manager —— 与 server/index.js:82-88 实例化的集合一致
  const managers = {
    mining: spyManager(),
    combat: spyManager(),
    pve: spyManager(),
    pvp: spyManager(),
    worldBoss: spyManager(),
    aiArena: spyManager(),
  };

  const connectedPlayers = new Map();
  const socketToPlayerId = new Map();
  const playerToSocket = new Map();

  // 镜像 server/index.js registerPlayer（119-153 行）
  function registerPlayer(socket, player) {
    const existingSocketId = playerToSocket.get(player.id);
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket) {
        existingSocket.emit(EVENTS.SESSION_REPLACED, {
          message: 'Session replaced by a new connection',
        });
        existingSocket.disconnect(true);
      }
    }
    playerToSocket.set(player.id, socket.id);
    connectedPlayers.set(socket.id, player);
    socketToPlayerId.set(socket.id, player.id);
    managers.mining.calculateOfflineMining(player);
    managers.mining.registerSocket(player.id, socket);
    managers.combat.registerSocket(player.id, socket);
    managers.pve.registerSocket(player.id, socket);
    managers.pvp.registerSocket(player.id, socket);
    managers.worldBoss.registerSocket(player.id, socket);
    managers.aiArena.registerSocket(player.id, socket);
    socket.emit(EVENTS.AUTH_SUCCESS, { playerId: player.id, player: player.serialize() });
  }

  io.on('connection', (socket) => {
    if (socket.data.player) {
      registerPlayer(socket, socket.data.player);
    }
    // 镜像 server/index.js disconnect 处理（267-293 行，省略 INPUT_* 注册）
    socket.on('disconnect', () => {
      const playerId = socketToPlayerId.get(socket.id);
      if (playerId) {
        if (playerToSocket.get(playerId) === socket.id) {
          managers.mining.unregisterSocket(playerId);
          managers.combat.unregisterSocket(playerId);
          managers.pve.unregisterSocket(playerId);
          managers.pvp.unregisterSocket(playerId);
          managers.worldBoss.unregisterSocket(playerId);
          managers.aiArena.unregisterSocket(playerId);
          playerToSocket.delete(playerId);
        }
        socketToPlayerId.delete(socket.id);
      }
      connectedPlayers.delete(socket.id);
      guard.rateLimiter.cleanup(socket.id);
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    io, server, url, store, managers, playerToSocket,
    async close() {
      await new Promise((r) => io.close(r));
      await new Promise((r) => server.close(r));
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function registerViaRest(url, username) {
  const res = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pass1234' }),
  });
  const body = await res.json();
  return { token: body.sessionToken, player: body.player };
}

function allManagers(managers) {
  return ['mining', 'combat', 'pve', 'pvp', 'worldBoss', 'aiArena'].map((k) => managers[k]);
}

describe('M0 ① 玩家接入 wiring（registerSocket ×6）', () => {
  let srv;

  afterEach(async () => {
    if (srv) { await srv.close(); srv = null; }
  });

  it('握手认证成功 → 6 个 manager 各收到一次 registerSocket(pid, socket)，并回发 AUTH_SUCCESS', async () => {
    srv = await buildMirrorServer();
    const { token, player } = await registerViaRest(srv.url, 'm0-alice');

    const sock = client(srv.url, { auth: { token }, forceNew: true });
    const authSuccess = await new Promise((resolve) => {
      sock.on(EVENTS.AUTH_SUCCESS, (d) => resolve(d));
      sock.on('connect_error', (e) => resolve({ error: e.message }));
      setTimeout(() => resolve({ error: 'timeout' }), 5000);
    });

    const serverSocket = [...srv.io.sockets.sockets.values()][0];
    sock.close();

    expect(authSuccess.error).toBeUndefined();
    expect(authSuccess.playerId).toBe(player.id);

    for (const mgr of allManagers(srv.managers)) {
      expect(mgr._calls.register).toHaveLength(1);
      expect(mgr._calls.register[0][0]).toBe(player.id);
      expect(mgr._calls.register[0][1]).toBe(serverSocket);
    }
    // 离线挂机在 manager 注册之前计算（index.js:141）
    expect(srv.managers.mining._calls.offline).toEqual([player.id]);
  });

  it('断开连接 → 6 个 manager 各收到一次 unregisterSocket(pid)', async () => {
    srv = await buildMirrorServer();
    const { token, player } = await registerViaRest(srv.url, 'm0-bob');

    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await new Promise((resolve) => {
      sock.on(EVENTS.AUTH_SUCCESS, () => resolve());
      setTimeout(resolve, 5000);
    });

    sock.close();
    await sleep(200); // 等服务端 disconnect 处理完成

    for (const mgr of allManagers(srv.managers)) {
      expect(mgr._calls.unregister).toEqual([player.id]);
    }
  });

  it('会话顶替 → 旧 socket 被踢并注销旧注册（同步时序），新连接注册且为其当前持有者', async () => {
    srv = await buildMirrorServer();
    const { token, player } = await registerViaRest(srv.url, 'm0-carol');

    const sock1 = client(srv.url, { auth: { token }, forceNew: true });
    await new Promise((resolve) => {
      sock1.on(EVENTS.AUTH_SUCCESS, () => resolve());
      setTimeout(resolve, 5000);
    });

    // 先挂监听再建第二个连接 —— kick 发生在 sock2 的注册流程中，
    // 监听器挂晚了会错过 session:replaced（socket-auth.test.js 同款顺序）
    const replacedPromise = new Promise((r) => {
      sock1.on(EVENTS.SESSION_REPLACED, r);
    });
    const sock2 = client(srv.url, { auth: { token }, forceNew: true });
    await new Promise((resolve) => {
      sock2.on(EVENTS.AUTH_SUCCESS, () => resolve());
      setTimeout(resolve, 5000);
    });

    // 旧 socket 应收到 session:replaced 并被断开
    const replaced = await Promise.race([
      replacedPromise,
      sleep(3000).then(() => null),
    ]);
    expect(replaced).not.toBeNull();
    sock1.close(); // 阻止旧客户端自动重连污染后续断言
    await sleep(200); // 等旧 socket 的服务端 disconnect 处理完

    // socket.io v4 现状：服务端 disconnect(true) 同步触发 'disconnect'，
    // 此时 playerToSocket 尚未指向新 socket → 守卫放行，注销的是旧注册
    // （无害：新连接在同一同步块内随后重新注册）。
    for (const mgr of allManagers(srv.managers)) {
      expect(mgr._calls.register).toHaveLength(2); // 每个连接各注册一次
      expect(mgr._calls.unregister).toEqual([player.id]);
    }
    // 顶替完成后注册表指向新 socket —— 新连接的注册未被旧注销破坏
    const activeId = srv.playerToSocket.get(player.id);
    expect(srv.io.sockets.sockets.has(activeId)).toBe(true);

    // 当前持有者（新 socket）断开 → 再注销一次
    sock2.close();
    await sleep(200);
    for (const mgr of allManagers(srv.managers)) {
      expect(mgr._calls.unregister).toEqual([player.id, player.id]);
    }
  });
});

// --- ② GameEngine.tick 节奏分发（真实 GameEngine 类） ------------------------

describe('M0 ② GameEngine.tick 节奏分发', () => {
  function buildEngine() {
    const mining = { tick: vi.fn() };
    const worldBoss = { tick: vi.fn() };
    const aiArena = { tick: vi.fn() };
    const combat = { cleanupBuffs: vi.fn(), processShieldDrain: vi.fn() };
    const alive = { id: 'alive-1', alive: true };
    const dead = { id: 'dead-1', alive: false };
    const store = { players: new Map([['alive-1', alive], ['dead-1', dead]]) };
    const engine = new GameEngine({}, store, combat, {}, mining, worldBoss, aiArena);
    return { engine, mining, worldBoss, aiArena, combat, alive };
  }

  function runTicks(engine, n) {
    for (let i = 0; i < n; i++) engine.tick();
  }

  it('100 tick 内：mining 每 20 tick 一次，共 5 次', () => {
    const f = buildEngine();
    runTicks(f.engine, 100);
    expect(f.mining.tick).toHaveBeenCalledTimes(5);
  });

  it('100 tick 内：worldBoss / aiArena 每 100 tick 一次，各 1 次', () => {
    const f = buildEngine();
    runTicks(f.engine, 100);
    expect(f.worldBoss.tick).toHaveBeenCalledTimes(1);
    expect(f.aiArena.tick).toHaveBeenCalledTimes(1);
  });

  it('边界：第 10 / 19 / 20 tick 的精确分发', () => {
    // 10 tick：buff 清理 1 次，mining/worldBoss/aiArena 均 0 次
    const f10 = buildEngine();
    runTicks(f10.engine, 10);
    expect(f10.combat.cleanupBuffs).toHaveBeenCalledTimes(1);
    expect(f10.mining.tick).toHaveBeenCalledTimes(0);
    expect(f10.worldBoss.tick).toHaveBeenCalledTimes(0);

    // 19 tick：仍无 mining；buff 清理仍只有 1 次（发生在第 10 tick）
    const f19 = buildEngine();
    runTicks(f19.engine, 19);
    expect(f19.mining.tick).toHaveBeenCalledTimes(0);
    expect(f19.combat.cleanupBuffs).toHaveBeenCalledTimes(1);

    // 20 tick：mining 恰好 1 次；buff 清理 2 次（第 10、20 tick）
    const f20 = buildEngine();
    runTicks(f20.engine, 20);
    expect(f20.mining.tick).toHaveBeenCalledTimes(1);
    expect(f20.combat.cleanupBuffs).toHaveBeenCalledTimes(2);
  });

  it('buff 清理 / shield 流失每 10 tick 一次，且只作用于存活玩家', () => {
    const f = buildEngine();
    runTicks(f.engine, 100);
    expect(f.combat.cleanupBuffs).toHaveBeenCalledTimes(10);
    expect(f.combat.processShieldDrain).toHaveBeenCalledTimes(10);
    for (const call of f.combat.cleanupBuffs.mock.calls) {
      expect(call[0]).toBe(f.alive); // 永远不是 dead-1
    }
    for (const call of f.combat.processShieldDrain.mock.calls) {
      expect(call[0]).toBe(f.alive);
    }
  });
});

// --- ③ INPUT_SKILL 战斗上下文路由（镜像 server/index.js:220-257） -----------

describe('M0 ③ INPUT_SKILL 战斗上下文路由', () => {
  const skillSchema = {
    skillId: { type: 'number', min: 0, max: 3, integer: true, required: true },
    targetX: { type: 'number', min: 0, max: MAP_WIDTH - 1, integer: true, required: true },
    targetY: { type: 'number', min: 0, max: MAP_HEIGHT - 1, integer: true, required: true },
  };

  function buildRouting() {
    const listeners = new Map();
    const socket = {
      id: `sock-${Math.random().toString(36).slice(2, 8)}`,
      data: {},
      emit: vi.fn(),
      on: (event, listener) => listeners.set(event, listener),
    };
    const player = { id: 'p1', alive: true, x: 5, y: 5 };
    const playersById = new Map();
    const combatSystem = { useSkill: vi.fn() };
    const pveManager = { playerDungeons: new Map(), activeDungeons: new Map() };
    const pvpManager = { playerArenas: new Map(), activeArenas: new Map() };
    const store = { getPlayerById: (id) => playersById.get(id) };
    const connectedPlayers = new Map([[socket.id, player]]);

    // —— index.js INPUT_SKILL 处理器的逐行镜像（含 guard 接线）——
    guard.on(socket, EVENTS.INPUT_SKILL, skillSchema, ({ skillId, targetX, targetY }) => {
      const p = connectedPlayers.get(socket.id);
      if (!p || !p.alive) return;

      const dungeonId = pveManager.playerDungeons.get(p.id);
      if (dungeonId) {
        const dungeon = pveManager.activeDungeons.get(dungeonId);
        if (dungeon) {
          const allEntities = new Map([...dungeon.players, ...dungeon.monsters]);
          combatSystem.useSkill(p, skillId, targetX, targetY, allEntities);
          return;
        }
      }

      const arenaId = pvpManager.playerArenas.get(p.id);
      if (arenaId) {
        const arena = pvpManager.activeArenas.get(arenaId);
        if (arena) {
          const allPlayers = new Map();
          for (const team of arena.teams) {
            for (const pid of team) {
              const tp = store.getPlayerById(pid);
              if (tp) allPlayers.set(pid, tp);
            }
          }
          combatSystem.useSkill(p, skillId, targetX, targetY, allPlayers);
          return;
        }
      }
      // 不在任何战斗上下文 —— 静默忽略（大厅无战斗）
    }, 'skill');

    const fire = (payload = { skillId: 0, targetX: 5, targetY: 5 }) =>
      listeners.get(EVENTS.INPUT_SKILL)(payload);

    return { socket, player, playersById, combatSystem, pveManager, pvpManager, fire };
  }

  beforeEach(() => {
    guard.rateLimiter.reset();
  });

  it('在副本中 → useSkill 收到「副本玩家 ∪ 怪物」实体表', () => {
    const r = buildRouting();
    const monster = { id: 'm1', hp: 50 };
    const otherPlayer = { id: 'p2' };
    r.pveManager.playerDungeons.set('p1', 'd-1');
    r.pveManager.activeDungeons.set('d-1', {
      players: new Map([['p1', r.player], ['p2', otherPlayer]]),
      monsters: new Map([['m1', monster]]),
      mapData: null,
    });

    r.fire({ skillId: 2, targetX: 6, targetY: 7 });

    expect(r.combatSystem.useSkill).toHaveBeenCalledTimes(1);
    const [playerArg, skillId, tx, ty, entities] = r.combatSystem.useSkill.mock.calls[0];
    expect(playerArg).toBe(r.player);
    expect(skillId).toBe(2);
    expect(tx).toBe(6);
    expect(ty).toBe(7);
    expect(entities.size).toBe(3); // 2 玩家 + 1 怪
    expect(entities.get('m1')).toBe(monster);
  });

  it('在竞技场中（不在副本）→ useSkill 收到「双方全部队伍玩家」实体表', () => {
    const r = buildRouting();
    const p2 = { id: 'p2' };
    const p3 = { id: 'p3' };
    r.playersById.set('p1', r.player);
    r.playersById.set('p2', p2);
    r.playersById.set('p3', p3);
    r.pvpManager.playerArenas.set('p1', 'a-1');
    r.pvpManager.activeArenas.set('a-1', { teams: [['p1', 'p2'], ['p3']], mapData: null });

    r.fire({ skillId: 1, targetX: 3, targetY: 4 });

    expect(r.combatSystem.useSkill).toHaveBeenCalledTimes(1);
    const entities = r.combatSystem.useSkill.mock.calls[0][4];
    expect(entities.size).toBe(3);
    expect(entities.get('p2')).toBe(p2);
    expect(entities.get('p3')).toBe(p3);
  });

  it('副本 id 存在但实例已失效 → 穿透到竞技场兜底（顺序语义）', () => {
    const r = buildRouting();
    r.playersById.set('p1', r.player);
    r.pveManager.playerDungeons.set('p1', 'd-gone'); // 副本已结束/被清理
    r.pvpManager.playerArenas.set('p1', 'a-1');
    r.pvpManager.activeArenas.set('a-1', { teams: [['p1']], mapData: null });

    r.fire();

    expect(r.combatSystem.useSkill).toHaveBeenCalledTimes(1);
    expect(r.combatSystem.useSkill.mock.calls[0][4].size).toBe(1);
  });

  it('大厅（无任何战斗上下文）→ 静默忽略：不调用 useSkill 也不报错', () => {
    const r = buildRouting();
    expect(() => r.fire()).not.toThrow();
    expect(r.combatSystem.useSkill).not.toHaveBeenCalled();
  });

  it('死亡玩家 → 直接忽略，不调用 useSkill', () => {
    const r = buildRouting();
    r.player.alive = false;
    r.pveManager.playerDungeons.set('p1', 'd-1');
    r.pveManager.activeDungeons.set('d-1', {
      players: new Map(), monsters: new Map(), mapData: null,
    });

    r.fire();
    expect(r.combatSystem.useSkill).not.toHaveBeenCalled();
  });

  it('schema 校验失败（skillId 越界）→ 回发 error 事件，不进入路由', () => {
    const r = buildRouting();
    r.pveManager.playerDungeons.set('p1', 'd-1');
    r.pveManager.activeDungeons.set('d-1', {
      players: new Map(), monsters: new Map(), mapData: null,
    });

    r.fire({ skillId: 9, targetX: 5, targetY: 5 });

    expect(r.combatSystem.useSkill).not.toHaveBeenCalled();
    expect(r.socket.emit).toHaveBeenCalledWith(
      EVENTS.ERROR,
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    );
  });
});
