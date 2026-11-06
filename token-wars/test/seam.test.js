/**
 * M4 验收：Socket 路由接缝化（tasks.md 5.1–5.5）
 *
 * 与 m2-player-events 同款「真实内核组合」（Context + Loader + full profile
 * 10 插件）+ 镜像 index.js M4 宿主（三个广播，零协议事件注册）。锁定：
 *
 *   ① INV1 双层断言：
 *      行为层——INPUT_MOVE 恰好移动 1 格（双重注册会移动 2 格）、
 *      PING→PONG 经 identity 的 socket:connected 挂载生效；
 *      静态层——server/index.js 与 server/game/*.js 不再出现
 *      guard.on / socket.on(EVENTS.*)（网络可见处理器只经 ctx.socket）。
 *   ② combat:resolve-context 瀑布认领互斥：
 *      pve（活跃副本）优先短路；副本 id 残留但实例失效 → 穿透给 pvp；
 *      pvp 认领后 worldboss 不再参与；三者皆不认领 → 大厅（entities 未定义）；
 *      worldboss 在 pve/pvp 均未认领时认领参战者（entities = 参战者 + Boss）。
 *   ③ INV2 网络层：unload 插件后其 ctx.socket 监听与瀑布认领器全部回滚
 *      （MINING_COLLECT 不再触发 collect；pve unload 后 DUNGEON_JOIN 失效、
 *      瀑布不再被副本认领）。
 */

process.env.NODE_ENV = 'test'; // getStore() → :memory:，绝不触碰真实数据

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const { Context } = require('../server/core/Context');
const { Loader } = require('../server/core/Loader');
const { closeStore } = require('../server/data/Store');
const guard = require('../server/middleware/eventGuard');
const logger = require('../server/utils/logger');
const { EVENTS } = require('../shared/constants');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buildServer() {
  closeStore();

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  const ctx = new Context({ io, app, server, logger });
  const loader = new Loader(ctx);
  loader.mountProfile(loader.loadProfile('full'), { env: process.env });

  // —— 镜像 index.js M4 宿主连接循环（三个广播，零协议事件注册） ——
  io.on('connection', (socket) => {
    ctx.emit('socket:connected', { socket });
    if (socket.data.player) {
      ctx.emit('auth:authenticated', { socket, player: socket.data.player });
    }
    socket.on('disconnect', () => {
      ctx.emit('socket:disconnect', { socket });
      guard.rateLimiter.cleanup(socket.id);
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    io, server, url, ctx, loader,
    players: ctx.get('players'),
    store: ctx.get('store'),
    async close() {
      await new Promise((r) => io.close(r));
      await new Promise((r) => server.close(r));
      closeStore();
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
  return { token: body.sessionToken, playerId: body.player.id };
}

function once(sock, event) {
  return new Promise((resolve) => {
    sock.on(event, (d) => resolve(d));
    sock.on('connect_error', (e) => resolve({ error: e.message }));
    setTimeout(() => resolve({ error: 'timeout' }), 5000);
  });
}

describe('M4 Socket 路由接缝化（真实内核组合 + M4 宿主）', () => {
  let srv;

  afterEach(async () => {
    if (srv) { await srv.close(); srv = null; }
  });

  // --- ① INV1 -------------------------------------------------------------

  it('INV1 行为层：INPUT_MOVE 恰好移动 1 格（无双重注册），墙体碰撞生效', async () => {
    srv = await buildServer();
    const { token, playerId } = await registerViaRest(srv.url, 'seam-move');

    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock, EVENTS.AUTH_SUCCESS);
    const serverSocket = [...srv.io.sockets.sockets.values()][0];
    const player = srv.players.connectedPlayers.get(serverSocket.id);
    expect(player.id).toBe(playerId);

    // 大厅中央空地：恰好移动 1 格（若中央注册未删净会 +2）
    player.x = 5; player.y = 5;
    sock.emit(EVENTS.INPUT_MOVE, { dx: 1, dy: 0 });
    await sleep(150);
    expect(player.x).toBe(6);
    expect(player.y).toBe(5);

    // 大厅边界墙（x=MAP_WIDTH-1 为墙）：不可穿墙
    player.x = 28; player.y = 5;
    sock.emit(EVENTS.INPUT_MOVE, { dx: 1, dy: 0 });
    await sleep(150);
    expect(player.x).toBe(28);

    // schema 校验失败 → 回发 VALIDATION_ERROR（guard 仍包裹 ctx.socket）
    const errP = once(sock, EVENTS.ERROR);
    sock.emit(EVENTS.INPUT_MOVE, { dx: 5, dy: 0 }); // 越界 dx
    const err = await errP;
    expect(err.code).toBe('VALIDATION_ERROR');

    sock.close();
    await sleep(100);
  });

  it('INV1 行为层：PING → PONG 经 identity 的 socket:connected 挂载生效', async () => {
    srv = await buildServer();
    const { token } = await registerViaRest(srv.url, 'seam-ping');

    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock, EVENTS.AUTH_SUCCESS);

    const pongP = once(sock, EVENTS.PONG);
    sock.emit(EVENTS.PING, { timestamp: 12345 });
    const pong = await pongP;
    expect(pong.error).toBeUndefined();
    expect(pong.timestamp).toBe(12345);

    sock.close();
    await sleep(100);
  });

  it('INV1 静态层：index.js 与 game/*.js 无 guard.on / socket.on(EVENTS.*)', () => {
    const serverRoot = path.join(__dirname, '..', 'server');

    const indexSrc = fs.readFileSync(path.join(serverRoot, 'index.js'), 'utf8');
    expect(indexSrc).not.toContain('guard.on(');
    expect(indexSrc).not.toMatch(/socket\.on\(EVENTS\./);

    const gameDir = path.join(serverRoot, 'game');
    for (const file of fs.readdirSync(gameDir)) {
      if (!file.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(gameDir, file), 'utf8');
      expect(src).not.toContain('guard.on(');
      expect(src).not.toMatch(/socket\.on\(EVENTS\./);
    }
  });

  // --- ② 瀑布认领互斥 -------------------------------------------------------

  it('瀑布：pve 活跃副本优先认领（pvp/worldboss 不再参与），mapData = 副本地图', async () => {
    srv = await buildServer();
    const { token, playerId } = await registerViaRest(srv.url, 'seam-pve');
    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock, EVENTS.AUTH_SUCCESS);
    const player = srv.store.getPlayerById(playerId);

    const pve = srv.ctx.get('pve');
    const pvp = srv.ctx.get('pvp');
    const worldboss = srv.ctx.get('worldboss');
    const dungeonMap = [[0, 0, 0], [0, 0, 0]];
    const monster = { id: 'mob-1', hp: 10 };
    pve.playerDungeons.set(playerId, 'd-seam');
    pve.activeDungeons.set('d-seam', {
      players: new Map([[playerId, player]]),
      monsters: new Map([[monster.id, monster]]),
      mapData: dungeonMap,
    });
    // 同时挂上竞技场与 Boss 参战 —— 认领必须互斥，pve 赢
    pvp.playerArenas.set(playerId, 'a-seam');
    pvp.activeArenas.set('a-seam', { teams: [[playerId]], mapData: [[1]] });
    worldboss.state = 'active';
    worldboss.boss = { id: 'boss-1', hp: 100 };
    worldboss.participants.set(playerId, player);

    const data = srv.ctx.runWaterfall('combat:resolve-context', { player });
    expect(data.entities).toBeInstanceOf(Map);
    expect(data.entities.size).toBe(2); // 玩家 + 怪物（非竞技场/Boss 实体）
    expect(data.entities.has(playerId)).toBe(true);
    expect(data.entities.has(monster.id)).toBe(true);
    expect(data.mapData).toBe(dungeonMap);

    sock.close();
    await sleep(100);
  });

  it('瀑布：副本 id 残留但实例失效 → 穿透给 pvp 认领（M0 ③ 语义）', async () => {
    srv = await buildServer();
    const { token, playerId } = await registerViaRest(srv.url, 'seam-fall');
    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock, EVENTS.AUTH_SUCCESS);
    const player = srv.store.getPlayerById(playerId);

    const pve = srv.ctx.get('pve');
    const pvp = srv.ctx.get('pvp');
    pve.playerDungeons.set(playerId, 'd-gone'); // id 在、实例不在
    const arenaMap = [[0, 0, 0, 0]];
    pvp.playerArenas.set(playerId, 'a-seam');
    pvp.activeArenas.set('a-seam', { teams: [[playerId]], mapData: arenaMap });

    const data = srv.ctx.runWaterfall('combat:resolve-context', { player });
    expect(data.entities).toBeInstanceOf(Map);
    expect([...data.entities.keys()]).toEqual([playerId]);
    expect(data.mapData).toBe(arenaMap);

    sock.close();
    await sleep(100);
  });

  it('瀑布：worldboss 在 pve/pvp 均未认领时认领参战者；非参战者 → 大厅（不认领）', async () => {
    srv = await buildServer();
    const joiner = await registerViaRest(srv.url, 'seam-boss-joiner');
    const bystander = await registerViaRest(srv.url, 'seam-boss-other');
    const joinerSock = client(srv.url, { auth: { token: joiner.token }, forceNew: true });
    await once(joinerSock, EVENTS.AUTH_SUCCESS);

    const worldboss = srv.ctx.get('worldboss');
    const joinerPlayer = srv.store.getPlayerById(joiner.playerId);
    const bystanderPlayer = srv.store.getPlayerById(bystander.playerId);
    worldboss.state = 'active';
    worldboss.boss = { id: 'boss-1', hp: 100 };
    worldboss.participants.set(joiner.playerId, joinerPlayer);

    const claimed = srv.ctx.runWaterfall('combat:resolve-context', { player: joinerPlayer });
    expect(claimed.entities).toBeInstanceOf(Map);
    expect(claimed.entities.size).toBe(2); // 参战者 + Boss
    expect(claimed.entities.has('boss-1')).toBe(true);
    expect(claimed.mapData).toBeUndefined(); // Boss 战在大厅地图

    const lobby = srv.ctx.runWaterfall('combat:resolve-context', { player: bystanderPlayer });
    expect(lobby.entities).toBeUndefined();

    joinerSock.close();
    await sleep(100);
  });

  // --- ③ INV2 网络层：unload 回滚 ------------------------------------------

  it('INV2：unload mining 后 MINING_COLLECT 监听回滚（不再触发 collect）', async () => {
    srv = await buildServer();
    const { token } = await registerViaRest(srv.url, 'seam-unload-min');
    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock, EVENTS.AUTH_SUCCESS);

    const mining = srv.ctx.get('mining');
    srv.loader.unload('mining');
    expect(() => srv.ctx.get('mining')).toThrow(/未注册/);

    let collected = 0;
    mining.collect = () => { collected += 1; }; // 对象仍在，仅监听应已回滚
    sock.emit(EVENTS.MINING_COLLECT, {});
    await sleep(150);
    expect(collected).toBe(0);

    // 其它插件的 socket 路由不受影响
    const serverSocket = [...srv.io.sockets.sockets.values()][0];
    const player = srv.players.connectedPlayers.get(serverSocket.id);
    player.x = 5; player.y = 5;
    sock.emit(EVENTS.INPUT_MOVE, { dx: 0, dy: 1 });
    await sleep(150);
    expect(player.y).toBe(6);

    sock.close();
    await sleep(100);
  });

  it('INV2：unload pve 后 DUNGEON_JOIN 失效且瀑布不再被副本认领', async () => {
    srv = await buildServer();
    const { token, playerId } = await registerViaRest(srv.url, 'seam-unload-pve');
    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock, EVENTS.AUTH_SUCCESS);
    const player = srv.store.getPlayerById(playerId);

    const pve = srv.ctx.get('pve');
    srv.loader.unload('pve');

    sock.emit(EVENTS.DUNGEON_JOIN, { dungeonId: 'solo_dungeon' });
    await sleep(150);
    expect(pve.playerDungeons.has(playerId)).toBe(false);

    // 手动构造「在副本」状态也应无人认领（认领器已回滚）→ 大厅
    pve.playerDungeons.set(playerId, 'd-x');
    pve.activeDungeons.set('d-x', {
      players: new Map([[playerId, player]]),
      monsters: new Map(),
      mapData: [[0]],
    });
    const data = srv.ctx.runWaterfall('combat:resolve-context', { player });
    expect(data.entities).toBeUndefined();

    sock.close();
    await sleep(100);
  });
});
