const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const store = require('./data/Store');
const { router: authRouter, verifySession } = require('./routes/auth');
const playerRouter = require('./routes/player');
const MiningManager = require('./game/MiningManager');
const CombatSystem = require('./game/CombatSystem');
const PvEManager = require('./game/PvEManager');
const PvPManager = require('./game/PvPManager');
const WorldBossManager = require('./game/WorldBossManager');
const AIArenaManager = require('./game/AIArenaManager');
const GameEngine = require('./game/GameEngine');
const { EVENTS } = require('../shared/protocol');
const { MAP_WIDTH, MAP_HEIGHT, TILE } = require('../shared/constants');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

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
  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
  const map = mapData || lobbyMap;
  return map[y][x] !== TILE.WALL;
}

// Express setup
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client'), { etag: false, lastModified: false, setHeaders: (res) => { res.set('Cache-Control', 'no-store'); } }));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
const shopRouter = require('./routes/shop');
app.use('/api/auth', authRouter);
app.use('/api/player', playerRouter);
app.use('/api/shop', shopRouter);

// HTTP + Socket.IO
const server = http.createServer(app);
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : (NODE_ENV === 'production' ? '*' : '*');
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
});

// --- Socket.IO rate limiting middleware ---
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX = 200; // max events per window
const rateLimitMap = new Map(); // socketId -> { count, resetTime }

function rateLimit(socket) {
  const now = Date.now();
  let record = rateLimitMap.get(socket.id);
  if (!record || now > record.resetTime) {
    record = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(socket.id, record);
  }
  record.count++;
  return record.count <= RATE_LIMIT_MAX;
}

// --- Movement throttle (server-side) ---
const MOVE_MIN_INTERVAL_MS = 80; // ~12 moves/sec max
const lastMoveTime = new Map(); // socketId -> timestamp

// Game systems
const miningManager = new MiningManager(io, store);
const combatSystem = new CombatSystem(io, store);
const pveManager = new PvEManager(io, store, combatSystem);
const pvpManager = new PvPManager(io, store, combatSystem);
const worldBossManager = new WorldBossManager(io, store, combatSystem);
const aiArenaManager = new AIArenaManager(io, store, combatSystem);
const gameEngine = new GameEngine(io, store, combatSystem, pveManager, miningManager, worldBossManager, aiArenaManager);
gameEngine.start();

// Track connected players
const connectedPlayers = new Map(); // socketId -> player
const socketToPlayerId = new Map(); // socketId -> playerId

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // --- FIX #5: Auth via session token ---
  socket.on(EVENTS.AUTH_LOGIN, ({ token }) => {
    if (!rateLimit(socket)) {
      socket.emit(EVENTS.AUTH_FAIL, { reason: 'Rate limited' });
      return;
    }
    const player = verifySession(token);
    if (!player) {
      socket.emit(EVENTS.AUTH_FAIL, { reason: 'Invalid session' });
      return;
    }
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
    console.log(`[WS] Player authenticated: ${player.username}`);
  });

  // --- FIX #1: Movement with wall collision + rate limit ---
  socket.on(EVENTS.INPUT_MOVE, ({ dx, dy }) => {
    if (!rateLimit(socket)) return;

    const player = connectedPlayers.get(socket.id);
    if (!player || !player.alive) return;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return;

    // Server-side movement throttle
    const now = Date.now();
    const last = lastMoveTime.get(socket.id) || 0;
    if (now - last < MOVE_MIN_INTERVAL_MS) return;
    lastMoveTime.set(socket.id, now);

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
  });

  // --- FIX #2: Skill use with mutual exclusion ---
  socket.on(EVENTS.INPUT_SKILL, ({ skillId, targetX, targetY }) => {
    if (!rateLimit(socket)) return;

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
  });

  // Ping/pong
  socket.on(EVENTS.PING, ({ timestamp }) => {
    socket.emit(EVENTS.PONG, { timestamp });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const player = connectedPlayers.get(socket.id);
    const playerId = socketToPlayerId.get(socket.id);
    if (playerId) {
      miningManager.unregisterSocket(playerId);
      combatSystem.unregisterSocket(playerId);
      pveManager.unregisterSocket(playerId);
      pvpManager.unregisterSocket(playerId);
      worldBossManager.unregisterSocket(playerId);
      aiArenaManager.unregisterSocket(playerId);
      socketToPlayerId.delete(socket.id);
    }
    if (player) {
      console.log(`[WS] Player disconnected: ${player.username}`);
      connectedPlayers.delete(socket.id);
    }
    // Cleanup rate limit data
    rateLimitMap.delete(socket.id);
    lastMoveTime.delete(socket.id);
  });
});

// Load persisted data
store.load();
store.startAutoSave(60000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  store.save();
  store.stopAutoSave();
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.save();
  store.stopAutoSave();
  process.exit(0);
});

// Start
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Token Wars] Server running on port ${PORT} (${NODE_ENV})`);
});
