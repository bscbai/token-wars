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
const { EVENTS, RARITY } = require('../shared/constants');
const MiningManager = require('../server/game/MiningManager');

// --- helpers --------------------------------------------------------------

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-sock-'));
  return { dir, dbPath: path.join(dir, 'a.db') };
}

const JWT_SECRET = 'test-socket-auth-secret';

/** Minimal mock for managers that only need registerSocket/unregisterSocket. */
function mockManager() {
  return {
    playerSockets: new Map(),
    registerSocket(pid, sock) { this.playerSockets.set(pid, sock); },
    unregisterSocket(pid) { this.playerSockets.delete(pid); },
    calculateOfflineMining() {},
  };
}

/**
 * Build a self-contained test server that mirrors the connection-handling
 * logic in server/index.js: handshake middleware, registerPlayer (with
 * session uniqueness), AUTH_LOGIN idempotent guard, and disconnect cleanup.
 */
async function buildTestServer() {
  const ctx = tmpDb();
  const store = new Store(ctx.dbPath, { migrate: false });
  const auth = makeAuth({ store, cfg: { JWT_SECRET, JWT_EXPIRES: '1h' } });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', auth.router);

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });

  // --- middleware (real code) ---
  io.use(makeSocketAuth({ verifySession: auth.verifySession }));

  // --- managers ---
  const miningManager = new MiningManager(io, store);
  const combatSystem = mockManager();
  const pveManager = mockManager();
  const pvpManager = mockManager();
  const worldBossManager = mockManager();
  const aiArenaManager = mockManager();

  const connectedPlayers = new Map();
  const socketToPlayerId = new Map();
  const playerToSocket = new Map();

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
    miningManager.calculateOfflineMining(player);
    miningManager.registerSocket(player.id, socket);
    combatSystem.registerSocket(player.id, socket);
    pveManager.registerSocket(player.id, socket);
    pvpManager.registerSocket(player.id, socket);
    worldBossManager.registerSocket(player.id, socket);
    aiArenaManager.registerSocket(player.id, socket);
    socket.emit(EVENTS.AUTH_SUCCESS, { playerId: player.id, player: player.serialize() });
  }

  io.on('connection', (socket) => {
    if (socket.data.player) {
      registerPlayer(socket, socket.data.player);
    }

    socket.on(EVENTS.AUTH_LOGIN, ({ token }) => {
      if (socket.data.authenticated) return;
      const player = auth.verifySession(token);
      if (!player) {
        socket.emit(EVENTS.AUTH_FAIL, { reason: 'Invalid session' });
        return;
      }
      socket.data.authenticated = true;
      socket.data.player = player;
      registerPlayer(socket, player);
    });

    socket.on('disconnect', () => {
      const player = connectedPlayers.get(socket.id);
      const playerId = socketToPlayerId.get(socket.id);
      if (playerId) {
        if (playerToSocket.get(playerId) === socket.id) {
          miningManager.unregisterSocket(playerId);
          combatSystem.unregisterSocket(playerId);
          pveManager.unregisterSocket(playerId);
          pvpManager.unregisterSocket(playerId);
          worldBossManager.unregisterSocket(playerId);
          aiArenaManager.unregisterSocket(playerId);
          playerToSocket.delete(playerId);
        }
        socketToPlayerId.delete(socket.id);
      }
      if (player) connectedPlayers.delete(socket.id);
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  return {
    ctx, store, auth, io, server, url,
    miningManager, connectedPlayers, playerToSocket,
    async close() {
      await new Promise((r) => io.close(r));
      await new Promise((r) => server.close(r));
      store.close();
      fs.rmSync(ctx.dir, { recursive: true, force: true });
    },
  };
}

/** Create a player via REST and return { token, player } . */
async function registerPlayerViaRest(url, username) {
  const res = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'pass1234' }),
  });
  const body = await res.json();
  return { token: body.sessionToken, player: body.player };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- tests ----------------------------------------------------------------

describe('Socket.IO Handshake Authentication (S2)', () => {
  let srv;

  afterEach(async () => {
    if (srv) { await srv.close(); srv = null; }
  });

  // ① no token → rejected
  it('rejects connection without a token', async () => {
    srv = await buildTestServer();
    const sock = client(srv.url, { auth: {}, forceNew: true });

    const error = await new Promise((resolve) => {
      sock.on('connect_error', (err) => resolve(err));
      sock.on('connect', () => resolve(null));
    });

    sock.close();
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/authentication|required|invalid/i);
  });

  // ① wrong token → rejected
  it('rejects connection with an invalid token', async () => {
    srv = await buildTestServer();
    const sock = client(srv.url, {
      auth: { token: 'not.a.real.jwt' },
      forceNew: true,
    });

    const error = await new Promise((resolve) => {
      sock.on('connect_error', (err) => resolve(err));
      sock.on('connect', () => resolve(null));
    });

    sock.close();
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/invalid|session/i);
  });

  // ① correct token → accepted + AUTH_SUCCESS
  it('accepts connection with a valid token and emits AUTH_SUCCESS', async () => {
    srv = await buildTestServer();
    const { token } = await registerPlayerViaRest(srv.url, 'alice');

    const sock = client(srv.url, { auth: { token }, forceNew: true });

    const result = await new Promise((resolve) => {
      sock.on('auth:success', (data) => resolve(data));
      sock.on('connect_error', (err) => resolve({ error: err.message }));
      setTimeout(() => resolve({ error: 'timeout' }), 5000);
    });

    sock.close();
    expect(result.error).toBeUndefined();
    expect(result.playerId).toBeDefined();
    expect(result.player.username).toBe('alice');
  });

  // ② duplicate AUTH_LOGIN → idempotent (no double-fire on mining:upgrade)
  it('duplicate AUTH_LOGIN does not cause duplicate mining:upgrade', async () => {
    srv = await buildTestServer();
    const { token, player } = await registerPlayerViaRest(srv.url, 'bob');

    // Give the player enough stable tokens to afford 3 upgrades
    // (level 2: 20 uncommon, level 3: 50 rare, level 4: 100 epic).
    const p = srv.store.getPlayerById(player.id);
    for (let i = 0; i < 20; i++) p.addStableToken(RARITY.UNCOMMON);
    for (let i = 0; i < 50; i++) p.addStableToken(RARITY.RARE);
    for (let i = 0; i < 100; i++) p.addStableToken(RARITY.EPIC);
    srv.store.savePlayer(p);

    const sock = client(srv.url, { auth: { token }, forceNew: true });

    // Wait for initial auth (handshake middleware path)
    await new Promise((resolve) => {
      sock.on('auth:success', () => resolve());
      sock.on('connect_error', () => resolve());
      setTimeout(resolve, 5000);
    });

    // Send AUTH_LOGIN 3 more times — the idempotent guard should make
    // these no-ops, so no duplicate listeners are registered.
    sock.emit('auth:login', { token });
    sock.emit('auth:login', { token });
    sock.emit('auth:login', { token });

    // Give the server a moment to process the extra AUTH_LOGINs
    await sleep(200);

    // Count mining:upgraded events
    const upgradedEvents = [];
    sock.on('mining:upgraded', (data) => upgradedEvents.push(data));

    // Trigger one mining:upgrade
    sock.emit('mining:upgrade');

    await sleep(300);

    sock.close();

    // Without the idempotent guard, 4 listeners (1 from handshake + 3 from
    // AUTH_LOGIN) would fire and the player would jump to level 4.
    // With the guard, only 1 listener fires → 1 upgrade → level 2.
    expect(upgradedEvents).toHaveLength(1);
    expect(upgradedEvents[0].newLevel).toBe(2);

    // Verify on the server side too
    const finalPlayer = srv.store.getPlayerById(player.id);
    expect(finalPlayer.miningLevel).toBe(2);
  });

  // ③ same account second connection → old socket gets session:replaced
  it('second connection for same account kicks the first with session:replaced', async () => {
    srv = await buildTestServer();
    const { token } = await registerPlayerViaRest(srv.url, 'charlie');

    // First connection
    const sock1 = client(srv.url, { auth: { token }, forceNew: true });
    await new Promise((resolve) => {
      sock1.on('auth:success', () => resolve());
      setTimeout(resolve, 5000);
    });

    // Listen for session:replaced on the first socket
    const replacedPromise = new Promise((resolve) => {
      sock1.on('session:replaced', (data) => resolve(data));
    });
    const disconnectPromise = new Promise((resolve) => {
      sock1.on('disconnect', () => resolve(true));
    });

    // Second connection with the same token
    const sock2 = client(srv.url, { auth: { token }, forceNew: true });
    await new Promise((resolve) => {
      sock2.on('auth:success', () => resolve());
      sock2.on('connect_error', () => resolve());
      setTimeout(resolve, 5000);
    });

    // The old socket should receive session:replaced
    const replaced = await Promise.race([
      replacedPromise,
      sleep(3000).then(() => null),
    ]);

    // The old socket should be disconnected
    const disconnected = await Promise.race([
      disconnectPromise,
      sleep(3000).then(() => false),
    ]);

    sock1.close();
    sock2.close();

    expect(replaced).not.toBeNull();
    expect(replaced.message).toMatch(/replaced/i);
    expect(disconnected).toBe(true);
  });
});
