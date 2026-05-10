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
const GameEngine = require('./game/GameEngine');
const { EVENTS } = require('../shared/protocol');

const PORT = process.env.PORT || 3000;

// Express setup
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));
const shopRouter = require('./routes/shop');
app.use('/api/auth', authRouter);
app.use('/api/player', playerRouter);
app.use('/api/shop', shopRouter);

// HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Game systems
const miningManager = new MiningManager(io, store);
const combatSystem = new CombatSystem(io, store);
const pveManager = new PvEManager(io, store, combatSystem);
const pvpManager = new PvPManager(io, store, combatSystem);
const worldBossManager = new WorldBossManager(io, store, combatSystem);
const gameEngine = new GameEngine(io, store, combatSystem, pveManager, miningManager, worldBossManager);
gameEngine.start();

// Track connected players
const connectedPlayers = new Map(); // socketId -> player
const socketToPlayerId = new Map(); // socketId -> playerId

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Auth via session token
  socket.on(EVENTS.AUTH_LOGIN, ({ token }) => {
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

    socket.emit(EVENTS.AUTH_SUCCESS, { playerId: player.id, player: player.serialize() });
    console.log(`[WS] Player authenticated: ${player.username}`);
  });

  // Movement — delegated to PvE/PvP managers when in dungeon/arena
  socket.on(EVENTS.INPUT_MOVE, ({ dx, dy }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || !player.alive) return;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return;
    const newX = player.x + dx;
    const newY = player.y + dy;
    if (newX >= 0 && newX < 30 && newY >= 0 && newY < 30) {
      player.x = newX;
      player.y = newY;
    }
  });

  // Skill use — validated by CombatSystem
  socket.on(EVENTS.INPUT_SKILL, ({ skillId, targetX, targetY }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || !player.alive) return;
    // Get entities from PvE manager if in dungeon
    const dungeonId = pveManager.playerDungeons.get(player.id);
    if (dungeonId) {
      const dungeon = pveManager.activeDungeons.get(dungeonId);
      if (dungeon) {
        const allEntities = new Map([...dungeon.players, ...dungeon.monsters]);
        combatSystem.useSkill(player, skillId, targetX, targetY, allEntities);
      }
    }
    // Get entities from PvP arena if in arena
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
      }
    }
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
      socketToPlayerId.delete(socket.id);
    }
    if (player) {
      console.log(`[WS] Player disconnected: ${player.username}`);
      connectedPlayers.delete(socket.id);
    }
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
server.listen(PORT, () => {
  console.log(`[Token Wars] Server running on http://localhost:${PORT}`);
});
