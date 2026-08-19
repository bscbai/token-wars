/**
 * M2 验收：玩家接入事件化（tasks.md 3.1–3.3）
 *
 * 与 M0 ① 的「纯镜像替身」不同：这里用真实内核组合（Context + Loader +
 * full profile 的 10 个真实插件）挂载，宿主仅镜像 index.js M2 形态的薄连接
 * 循环（auth:authenticated / socket:disconnect 两个广播 + AUTH_LOGIN 兼容）。
 * 6 个真实 manager 挂载后以 spy 包装，断言与 M0 ① 相同的可观测行为，
 * 外加 player:join/leave 的事件契约与 INV2（unload 后不再注册）。
 */

process.env.NODE_ENV = 'test'; // getStore() → :memory:，绝不触碰真实数据

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
const SIX = ['mining', 'combat', 'pve', 'pvp', 'worldboss', 'aiarena'];

/** 挂载后 spy 包装 6 个真实 manager：记录 register/unregister/offline 调用序 */
function spyWrapManagers(ctx) {
  const calls = {};
  for (const name of SIX) calls[name] = { register: [], unregister: [], offline: [] };
  for (const name of SIX) {
    const mgr = ctx.get(name);
    for (const [method, slot] of [['registerSocket', 'register'], ['unregisterSocket', 'unregister']]) {
      const orig = mgr[method].bind(mgr);
      mgr[method] = (pid, socket) => {
        calls[name][slot].push([pid, socket]);
        return orig(pid, socket);
      };
    }
  }
  const mining = ctx.get('mining');
  const origOffline = mining.calculateOfflineMining.bind(mining);
  mining.calculateOfflineMining = (p) => {
    calls.mining.offline.push(p.id);
    return origOffline(p);
  };
  return calls;
}

async function buildServer() {
  closeStore(); // 每个用例独立的 :memory: 存储

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  const ctx = new Context({ io, app, server, logger });
  const loader = new Loader(ctx);
  loader.mountProfile(loader.loadProfile('full'), { env: process.env });

  const calls = spyWrapManagers(ctx);

  // 事件契约观测（宿主作用域订阅，晚于插件 → 不影响插件监听器顺序）
  const events = { join: [], leave: [] };
  ctx.on('player:join', ({ player, socket }) => events.join.push({ player, socket }));
  ctx.on('player:leave', ({ player, socket }) => events.leave.push({ player, socket }));

  // —— 镜像 index.js M2 宿主连接循环（两个广播 + AUTH_LOGIN 兼容路径） ——
  io.on('connection', (socket) => {
    if (socket.data.player) {
      ctx.emit('auth:authenticated', { socket, player: socket.data.player });
    }
    socket.on(EVENTS.AUTH_LOGIN, ({ token }) => {
      if (socket.data.authenticated) return;
      if (!guard.rateLimiter.consume(socket.id, 'auth')) {
        socket.emit(EVENTS.AUTH_FAIL, { reason: 'Rate limited' });
        return;
      }
      const player = ctx.get('auth')(token);
      if (!player) {
        socket.emit(EVENTS.AUTH_FAIL, { reason: 'Invalid session' });
        return;
      }
      socket.data.authenticated = true;
      socket.data.player = player;
      ctx.emit('auth:authenticated', { socket, player });
    });
    socket.on('disconnect', () => {
      ctx.emit('socket:disconnect', { socket });
      guard.rateLimiter.cleanup(socket.id);
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    io, server, url, ctx, loader, calls, events,
    players: ctx.get('players'),
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
  return { token: body.sessionToken, player: body.player };
}

function once(sock, event) {
  return new Promise((resolve) => {
    sock.on(event, (d) => resolve(d));
    sock.on('connect_error', (e) => resolve({ error: e.message }));
    setTimeout(() => resolve({ error: 'timeout' }), 5000);
  });
}

function allSix(calls) {
  return SIX.map((k) => calls[k]);
}

describe('M2 玩家接入事件化（真实内核组合）', () => {
  let srv;

  afterEach(async () => {
    if (srv) { await srv.close(); srv = null; }
  });

  it('3.1/3.2 握手认证 → player:join（携带 player+socket）→ 6 manager 各注册一次，回发 AUTH_SUCCESS', async () => {
    srv = await buildServer();
    const { token, player } = await registerViaRest(srv.url, 'm2-alice');

    const sock = client(srv.url, { auth: { token }, forceNew: true });
    const authSuccess = await once(sock, EVENTS.AUTH_SUCCESS);
    const serverSocket = [...srv.io.sockets.sockets.values()][0];

    // AUTH_SUCCESS 仍回发（客户端可见行为不变）
    expect(authSuccess.error).toBeUndefined();
    expect(authSuccess.playerId).toBe(player.id);

    // 事件契约：player:join 携带 player + socket
    expect(srv.events.join).toHaveLength(1);
    expect(srv.events.join[0].player.id).toBe(player.id);
    expect(srv.events.join[0].socket).toBe(serverSocket);

    // 6 个真实 manager 各收到 registerSocket(pid, socket)
    for (const c of allSix(srv.calls)) {
      expect(c.register).toHaveLength(1);
      expect(c.register[0][0]).toBe(player.id);
      expect(c.register[0][1]).toBe(serverSocket);
    }
    // 离线挂机收益仍先于 socket 注册计算（原 index.js:136→139 顺序）
    expect(srv.calls.mining.offline).toEqual([player.id]);
    // 连接存续期间无 leave
    expect(srv.events.leave).toHaveLength(0);

    sock.close();
    await sleep(200);
  });

  it('3.1/3.2 断开 → socket:disconnect → player:leave → 6 manager 各注销一次', async () => {
    srv = await buildServer();
    const { token, player } = await registerViaRest(srv.url, 'm2-bob');

    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock, EVENTS.AUTH_SUCCESS);
    sock.close();
    await sleep(200);

    expect(srv.events.leave).toHaveLength(1);
    expect(srv.events.leave[0].player.id).toBe(player.id);
    for (const c of allSix(srv.calls)) {
      expect(c.unregister.map((u) => u[0])).toEqual([player.id]);
    }
    // 三表已清空
    expect(srv.players.connectedPlayers.size).toBe(0);
    expect(srv.players.playerToSocket.size).toBe(0);
  });

  it('3.3 会话顶替 → 同一事件流：旧连接注销、新连接注册且为持有者；新连接再断开 → 再注销', async () => {
    srv = await buildServer();
    const { token, player } = await registerViaRest(srv.url, 'm2-carol');

    const sock1 = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock1, EVENTS.AUTH_SUCCESS);

    // 先挂监听再建第二个连接（kick 发生在 sock2 注册流程中）
    const replacedPromise = new Promise((r) => {
      sock1.on(EVENTS.SESSION_REPLACED, r);
    });
    const sock2 = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock2, EVENTS.AUTH_SUCCESS);

    const replaced = await Promise.race([replacedPromise, sleep(3000).then(() => null)]);
    expect(replaced).not.toBeNull();
    sock1.close(); // 阻止旧客户端自动重连污染后续断言
    await sleep(200);

    // 与 M0 ③ 相同的时序：register×2、unregister×1（旧注册被同步注销）
    for (const c of allSix(srv.calls)) {
      expect(c.register).toHaveLength(2);
      expect(c.unregister.map((u) => u[0])).toEqual([player.id]);
    }
    // player:join×2 / player:leave×1（旧连接的 leave）
    expect(srv.events.join).toHaveLength(2);
    expect(srv.events.leave.map((e) => e.player.id)).toEqual([player.id]);

    // 顶替完成后持有者 = 新 socket
    const activeId = srv.players.playerToSocket.get(player.id);
    expect(srv.io.sockets.sockets.has(activeId)).toBe(true);
    expect(activeId).not.toBe(sock1.id);

    // 当前持有者断开 → 再注销一次
    sock2.close();
    await sleep(200);
    for (const c of allSix(srv.calls)) {
      expect(c.unregister.map((u) => u[0])).toEqual([player.id, player.id]);
    }
    expect(srv.events.leave).toHaveLength(2);
  });

  it('INV2：unload world-player 后 auth:authenticated 不再产生注册（注册即可逆）', async () => {
    srv = await buildServer();
    const { token, player } = await registerViaRest(srv.url, 'm2-dave');

    const sock = client(srv.url, { auth: { token }, forceNew: true });
    await once(sock, EVENTS.AUTH_SUCCESS);
    sock.close();
    await sleep(200);
    expect(allSix(srv.calls).every((c) => c.register.length === 1)).toBe(true);

    srv.loader.unload('world-player'); // 回滚其全部效应（service/route/ctx.on）

    // 再广播认证事实 → 无 player:join → 无 manager 注册
    srv.ctx.emit('auth:authenticated', { socket: { id: 'ghost' }, player: { id: 'ghost-1' } });
    expect(allSix(srv.calls).every((c) => c.register.length === 1)).toBe(true);
    expect(() => srv.ctx.get('players')).toThrow(/未注册/);
    void player;
  });
});
