const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const guard = require('./middleware/eventGuard');
const GameEngine = require('./game/GameEngine');
const { Context } = require('./core/Context');
const { Loader } = require('./core/Loader');
const { EVENTS } = require('../shared/protocol');
const { MAP_WIDTH, MAP_HEIGHT, TILE } = require('../shared/constants');

const PORT = config.PORT;
const NODE_ENV = config.NODE_ENV;

// --- CLI: --profile <name> / --dump-config ---------------------------------
// --dump-config：解析组合并打印插件树后退出，不创建 http/io、不启动游戏循环
const argv = process.argv.slice(2);
function cliProfileName() {
  const i = argv.indexOf('--profile');
  return (i !== -1 && argv[i + 1]) || 'full';
}
if (argv.includes('--dump-config')) {
  const dumper = new Loader(null);
  const resolved = dumper.resolve(dumper.loadProfile(cliProfileName()), { env: process.env });
  console.log(`[Token Wars] config dump\n${dumper.dumpConfig(resolved)}`);
  process.exit(0);
}
const PROFILE_NAME = cliProfileName();

// --- Default lobby map (open floor with border walls) ---
const lobbyMap = [];
for (let y = 0; y < MAP_HEIGHT; y++) {
  lobbyMap[y] = [];
  for (let x = 0; x < MAP_WIDTH; x++) {
    if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
      lobbyMap[y][x] = TILE.WALL;
    } else {
      lobbyMap[y][x] = TILE.FLOOR;
    }
  }
}

function isWalkable(x, y, mapData) {
  if (typeof x !== 'number' || typeof y !== 'number') return false;
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
  const map = mapData || lobbyMap;
  if (!map || !map[y]) return false;
  return map[y][x] !== TILE.WALL;
}

// Express setup
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client'), { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store'); } }));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// HTTP + Socket.IO
const server = http.createServer(app);
const allowedOrigins = config.CORS_ORIGIN.split(',');
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

// --- Plugin kernel boot ----------------------------------------------------
// 旧版 index.js 的装配（Store 单例、auth/player/shop 路由、socketAuth 中间件、
// 6 个 Manager 实例化、store.load + autoSave）全部迁入 plugins/<name>/；
// 此处仅建 Context、按 profile 挂载、经服务接缝取回引用。
const ctx = new Context({ io, app, server, config, logger });
const loader = new Loader(ctx);
loader.mountProfile(loader.loadProfile(PROFILE_NAME), { env: process.env });

// Game systems（经由服务接缝——与旧版逐行等价的构造参数）
const store = ctx.get('store');
const combatSystem = ctx.get('combat');
const pveManager = ctx.get('pve');
const pvpManager = ctx.get('pvp');
const worldBossManager = ctx.get('worldboss');
const aiArenaManager = ctx.get('aiarena');
const miningManager = ctx.get('mining');
const gameEngine = new GameEngine(io, store, combatSystem, pveManager, miningManager, worldBossManager, aiArenaManager);
gameEngine.start();

// Track connected players
const connectedPlayers = new Map(); // socketId -> player
const socketToPlayerId = new Map(); // socketId -> playerId
const playerToSocket = new Map();   // playerId -> socketId (session uniqueness)

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memoryRss: process.memoryUsage().rss,
    players: { connected: connectedPlayers.size, stored: store.players.size },
    systems: {
      gameEngine: gameEngine.running,
      pvpArenas: pvpManager.activeArenas ? pvpManager.activeArenas.size : 0,
      pveDungeons: pveManager.activeDungeons ? pveManager.activeDungeons.size : 0,
    },
    db: path.basename(config.DB_PATH),
  });
});

/**
 * Register a player on a socket: enforce session uniqueness (kick any existing
 * socket for the same playerId), wire up all game managers, and emit
 * AUTH_SUCCESS.  Called from both the handshake-auth path and the compat
 * AUTH_LOGIN path — the latter is guarded by `socket.data.authenticated` to
 * prevent duplicate registration.
 */
function registerPlayer(socket, player) {
  // --- Session uniqueness: one account → one authoritative socket ---
  const existingSocketId = playerToSocket.get(player.id);
  if (existingSocketId && existingSocketId !== socket.id) {
    const existingSocket = io.sockets.sockets.get(existingSocketId);
    if (existingSocket) {
      existingSocket.emit(EVENTS.SESSION_REPLACED, {
        message: 'Session replaced by a new connection',
      });
      existingSocket.disconnect(true);
      logger.info(
        { playerId: player.id, oldSocketId: existingSocketId, newSocketId: socket.id },
        '[WS] Replaced existing session'
      );
    }
  }

  playerToSocket.set(player.id, socket.id);
  connectedPlayers.set(socket.id, player);
  socketToPlayerId.set(socket.id, player.id);

  // Calculate offline mining
  miningManager.calculateOfflineMining(player);

  // Register with all managers
  miningManager.registerSocket(player.id, socket);
  combatSystem.registerSocket(player.id, socket);
  pveManager.registerSocket(player.id, socket);
  pvpManager.registerSocket(player.id, socket);
  worldBossManager.registerSocket(player.id, socket);
  aiArenaManager.registerSocket(player.id, socket);

  socket.emit(EVENTS.AUTH_SUCCESS, { playerId: player.id, player: player.serialize() });
  logger.info({ username: player.username, socketId: socket.id }, '[WS] Player authenticated');
}

io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, '[WS] Client connected');

  // --- New path: handshake middleware already authenticated ---
  // The socket.data.player is set by socketAuth middleware. Register the
  // player immediately — no need to wait for an AUTH_LOGIN event.
  if (socket.data.player) {
    registerPlayer(socket, socket.data.player);
  }

  // --- Compat path: AUTH_LOGIN event ---
  // Kept for the transition period.  The idempotent guard
  // (`socket.data.authenticated`) ensures that if the handshake middleware
  // already authenticated, this handler is a no-op — preventing the duplicate
  // registerSocket → duplicate listener → double-fire bug.
  socket.on(EVENTS.AUTH_LOGIN, ({ token }) => {
    if (socket.data.authenticated) return; // idempotent guard

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
    registerPlayer(socket, player);
  });

  // --- Movement with wall collision + guard (rate limit + schema) ---
  const moveSchema = {
    dx: { type: 'number', min: -1, max: 1, required: true },
    dy: { type: 'number', min: -1, max: 1, required: true },
  };
  guard.on(socket, EVENTS.INPUT_MOVE, moveSchema, ({ dx, dy }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || !player.alive) return;

    const newX = player.x + dx;
    const newY = player.y + dy;

    // Get the correct map for collision check
    let mapData = null;
    const dungeonId = pveManager.playerDungeons.get(player.id);
    if (dungeonId) {
      const dungeon = pveManager.activeDungeons.get(dungeonId);
      if (dungeon) mapData = dungeon.mapData;
    }
    const arenaId = pvpManager.playerArenas.get(player.id);
    if (arenaId) {
      const arena = pvpManager.activeArenas.get(arenaId);
      if (arena) mapData = arena.mapData;
    }

    // Wall collision check
    if (isWalkable(newX, newY, mapData)) {
      player.x = newX;
      player.y = newY;
    }
  }, 'movement');

  // --- Skill use with mutual exclusion + guard (rate limit + schema) ---
  const skillSchema = {
    skillId: { type: 'number', min: 0, max: 3, integer: true, required: true },
    targetX: { type: 'number', min: 0, max: MAP_WIDTH - 1, integer: true, required: true },
    targetY: { type: 'number', min: 0, max: MAP_HEIGHT - 1, integer: true, required: true },
  };
  guard.on(socket, EVENTS.INPUT_SKILL, skillSchema, ({ skillId, targetX, targetY }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || !player.alive) return;

    // Mutual exclusion: in dungeon OR in arena, never both
    const dungeonId = pveManager.playerDungeons.get(player.id);
    if (dungeonId) {
      const dungeon = pveManager.activeDungeons.get(dungeonId);
      if (dungeon) {
        const allEntities = new Map([...dungeon.players, ...dungeon.monsters]);
        combatSystem.useSkill(player, skillId, targetX, targetY, allEntities);
        return;
      }
    }

    const arenaId = pvpManager.playerArenas.get(player.id);
    if (arenaId) {
      const arena = pvpManager.activeArenas.get(arenaId);
      if (arena) {
        const allPlayers = new Map();
        for (const team of arena.teams) {
          for (const pid of team) {
            const p = store.getPlayerById(pid);
            if (p) allPlayers.set(pid, p);
          }
        }
        combatSystem.useSkill(player, skillId, targetX, targetY, allPlayers);
        return;
      }
    }

    // Not in any combat context — ignore silently (lobby has no combat)
  }, 'skill');

  // Ping/pong (rate-limited via guard.rateLimiter; kept as bare socket.on
  // per S3 exclusion — PING is an internal protocol event)
  socket.on(EVENTS.PING, ({ timestamp }) => {
    if (!guard.rateLimiter.consume(socket.id, 'ping')) return;
    socket.emit(EVENTS.PONG, { timestamp });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const player = connectedPlayers.get(socket.id);
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) {
      // Only unregister from managers if this socket is still the active
      // one for the player.  When a session is replaced (kick), the old
      // socket's disconnect fires after playerToSocket has already been
      // updated to the new socket — so this guard prevents accidentally
      // unregistering the new connection.
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
    if (player) {
      logger.info({ username: player.username }, '[WS] Player disconnected');
      connectedPlayers.delete(socket.id);
    }
    // Cleanup rate limit data
    guard.rateLimiter.cleanup(socket.id);
  });
});

// --- Graceful shutdown ------------------------------------------------------
// Order: stop accepting traffic -> drop sockets -> stop the tick -> flush and
// close the db (which checkpoints the WAL). Hard-exit after SHUTDOWN_TIMEOUT_MS
// so a stuck socket can never leave the WAL un-checkpointed forever.
const SHUTDOWN_TIMEOUT_MS = 5000;   // hard ceiling — force exit past this
const DRAIN_GRACE_MS = 1500;        // let in-flight requests finish
const FORCED_CLOSE_SETTLE_MS = 300; // after cutting sockets off
let shuttingDown = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function closeAsync(label, fn) {
  const started = Date.now();
  return new Promise((resolve) => {
    const done = () => {
      logger.debug({ label, ms: Date.now() - started }, '[Server] close step done');
      resolve();
    };
    try {
      fn(done);
    } catch (err) {
      logger.warn({ err: err.message, label }, '[Server] close step failed');
      resolve();
    }
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, '[Server] Graceful shutdown started');

  // Last-resort guard: if anything hangs, still try to close the db, then bail.
  const forceExit = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, '[Server] Shutdown timed out — forcing exit');
    try { store.close(); } catch (_) {}
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // 1) stop accepting new connections
  const httpClosed = closeAsync('http', (done) => server.close(done));
  // Idle keep-alive sockets hold server.close() open indefinitely; drop them now.
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();

  // 2) disconnect socket.io clients
  const ioClosed = closeAsync('socket.io', (done) => io.close(done));

  // Give in-flight work a short grace, then cut off whatever is left. A client
  // holding an open socket must never delay the db flush below.
  const networkClosed = Promise.all([httpClosed, ioClosed]);
  let drained = false;
  await Promise.race([networkClosed.then(() => { drained = true; }), delay(DRAIN_GRACE_MS)]);
  if (!drained) {
    logger.warn({ graceMs: DRAIN_GRACE_MS }, '[Server] Connections still open — forcing close');
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await Promise.race([networkClosed, delay(FORCED_CLOSE_SETTLE_MS)]);
  }

  // 3) stop the game tick
  try { gameEngine.stop(); } catch (err) {
    logger.warn({ err: err.message }, '[Server] gameEngine.stop failed');
  }

  // 4) final save + WAL checkpoint + db close
  try { store.close(); } catch (err) {
    logger.error({ err: err.message }, '[Server] store.close failed');
  }

  clearTimeout(forceExit);
  logger.info('[Server] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

// Start
server.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, env: NODE_ENV, profile: PROFILE_NAME }, '[Token Wars] Server running');
});
