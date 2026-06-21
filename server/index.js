const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { EVENTS, MINING, INVENTORY, AI_ARENA } = require('../shared/constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.static(path.join(__dirname, '..', 'client', 'public')));
app.use('/src', express.static(path.join(__dirname, '..', 'client', 'src')));
app.use('/shared', express.static(path.join(__dirname, '..', 'client', 'shared')));

// ─── In-memory data stores ───────────────────────────────────────────

// Mining sessions: playerId → { timer, room }
const miningSessions = new Map();

// Player inventories: playerId → [{ id, type, ...props }]
const playerInventories = new Map();

// PvP match queue: [socketId]
const pvpQueue = [];

// Player-to-room mapping: socketId → roomId
const playerRooms = new Map();

// ─── Inventory helpers ───────────────────────────────────────────────

function getInventory(playerId) {
  if (!playerInventories.has(playerId)) {
    playerInventories.set(playerId, []);
  }
  return playerInventories.get(playerId);
}

function generateItemId() {
  return 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ─── Mining logic ────────────────────────────────────────────────────

function startMining(socket, roomId) {
  if (miningSessions.has(socket.id)) {
    socket.emit(EVENTS.MINE_START, { success: false, reason: 'already_mining' });
    return;
  }

  const session = {
    timer: null,
    room: roomId,
    tokens: 0,
  };

  session.timer = setInterval(() => {
    session.tokens += MINING.TOKEN_PER_TICK;
    socket.emit(EVENTS.MINE_REWARD, {
      tokens: session.tokens,
      tickAmount: MINING.TOKEN_PER_TICK,
    });
  }, MINING.TICK_INTERVAL);

  miningSessions.set(socket.id, session);

  socket.emit(EVENTS.MINE_START, {
    success: true,
    tickInterval: MINING.TICK_INTERVAL,
    tokensPerTick: MINING.TOKEN_PER_TICK,
  });
}

function stopMining(socket) {
  const session = miningSessions.get(socket.id);
  if (!session) {
    socket.emit(EVENTS.MINE_STOP, { success: false, reason: 'not_mining' });
    return;
  }

  clearInterval(session.timer);
  const totalTokens = session.tokens;
  miningSessions.delete(socket.id);

  socket.emit(EVENTS.MINE_STOP, {
    success: true,
    totalTokens,
  });
}

// ─── PvP match queue ─────────────────────────────────────────────────

function addToPvpQueue(socketId) {
  if (pvpQueue.includes(socketId)) return;
  pvpQueue.push(socketId);

  if (pvpQueue.length >= 2) {
    const player1 = pvpQueue.shift();
    const player2 = pvpQueue.shift();

    const matchId = 'pvp_' + Date.now();

    io.to(player1).emit(EVENTS.PVP_MATCH_FOUND, { matchId, opponent: player2 });
    io.to(player2).emit(EVENTS.PVP_MATCH_FOUND, { matchId, opponent: player1 });
  }
}

function removeFromPvpQueue(socketId) {
  const idx = pvpQueue.indexOf(socketId);
  if (idx !== -1) pvpQueue.splice(idx, 1);
}

// ─── AI Arena Manager (must be initialized before connection handler) ─

const AIArenaManager = require('./game/AIArenaManager');
const aiArenaManager = new AIArenaManager(io);

// ─── Socket.IO connection ────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Connection] Player connected: ${socket.id}`);

  const playerId = socket.handshake.query.playerId || socket.id;

  // Join a room named after playerId for targeted event delivery
  socket.join(playerId);

  // ── AI Arena handlers (unified connection) ──
  aiArenaManager.handleConnection(socket, playerId);

  // ── Room join ──
  socket.on(EVENTS.JOIN_ROOM, (data) => {
    const roomId = data.room || data.roomId || 'global';
    socket.join(roomId);
    playerRooms.set(socket.id, roomId);

    socket.to(roomId).emit(EVENTS.PLAYER_JOINED, {
      id: socket.id,
      playerId,
      ...data,
    });

    socket.emit(EVENTS.ROOM_UPDATE, {
      room: roomId,
      playerCount: io.sockets.adapter.rooms.get(roomId)?.size || 0,
    });
  });

  // ── Room leave ──
  socket.on(EVENTS.LEAVE_ROOM, (data) => {
    const roomId = data?.room || playerRooms.get(socket.id) || 'global';
    socket.leave(roomId);
    playerRooms.delete(socket.id);

    socket.to(roomId).emit(EVENTS.PLAYER_LEFT, {
      id: socket.id,
      playerId,
    });
  });

  // ── Player move ──
  socket.on(EVENTS.PLAYER_MOVE, (data) => {
    if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PLAYER_MOVE, {
        id: socket.id,
        x: data.x,
        y: data.y,
        angle: typeof data.angle === 'number' ? data.angle : 0,
      });
    }
  });

  // ── Player attack ──
  socket.on(EVENTS.PLAYER_ATTACK, (data) => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PLAYER_ATTACK, {
        id: socket.id,
        ...data,
      });
    }
  });

  // ── Player shoot ──
  socket.on(EVENTS.PLAYER_SHOOT, (data) => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PROJECTILE_SPAWN, {
        id: socket.id,
        projectileId: 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        ...data,
      });
    }
  });

  // ── Player dash ──
  socket.on(EVENTS.PLAYER_DASH, (data) => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PLAYER_DASH, {
        id: socket.id,
        ...data,
      });
    }
  });

  // ── Player died ──
  socket.on(EVENTS.PLAYER_DIED, (data) => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PLAYER_DIED, {
        id: socket.id,
        ...data,
      });
    }
  });

  // ── State sync ──
  socket.on(EVENTS.STATE_SYNC, (data) => {
    if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.STATE_SYNC, {
        id: socket.id,
        x: data.x,
        y: data.y,
        angle: typeof data.angle === 'number' ? data.angle : 0,
        hp: typeof data.hp === 'number' ? data.hp : 100,
      });
    }
  });

  // ── Projectile hit ──
  socket.on(EVENTS.PROJECTILE_HIT, (data) => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PROJECTILE_HIT, {
        id: socket.id,
        ...data,
      });
    }
  });

  // ── Projectile destroy ──
  socket.on(EVENTS.PROJECTILE_DESTROY, (data) => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PROJECTILE_DESTROY, {
        id: socket.id,
        ...data,
      });
    }
  });

  // ── Chat message ──
  socket.on(EVENTS.CHAT_MESSAGE, (data) => {
    const message = typeof data?.message === 'string' ? data.message.substring(0, 200) : '';
    if (!message) return;
    const roomId = playerRooms.get(socket.id) || 'global';
    io.to(roomId).emit(EVENTS.CHAT_BROADCAST, {
      id: socket.id,
      playerId,
      message,
      timestamp: Date.now(),
    });
  });

  // ── Mining ──
  socket.on(EVENTS.MINE_START, (data) => {
    const roomId = data?.room || playerRooms.get(socket.id) || 'global';
    startMining(socket, roomId);
  });

  socket.on(EVENTS.MINE_STOP, () => {
    stopMining(socket);
  });

  // ── Inventory ──
  socket.on(EVENTS.INVENTORY_GET, () => {
    const inventory = getInventory(playerId);
    socket.emit(EVENTS.INVENTORY_GET, {
      inventory,
      maxSlots: INVENTORY.MAX_SLOTS,
    });
  });

  socket.on(EVENTS.INVENTORY_ADD, (data) => {
    const inventory = getInventory(playerId);
    if (inventory.length >= INVENTORY.MAX_SLOTS) {
      socket.emit(EVENTS.INVENTORY_ADD, { success: false, reason: 'inventory_full' });
      return;
    }

    const item = {
      id: generateItemId(),
      type: data.type,
      name: data.name || data.type,
      addedAt: Date.now(),
      ...data.props,
    };
    inventory.push(item);

    socket.emit(EVENTS.INVENTORY_ADD, {
      success: true,
      item,
      inventory,
    });
  });

  socket.on(EVENTS.INVENTORY_USE, (data) => {
    const inventory = getInventory(playerId);
    const idx = inventory.findIndex((item) => item.id === data.itemId);
    if (idx === -1) {
      socket.emit(EVENTS.INVENTORY_USE, { success: false, reason: 'item_not_found' });
      return;
    }

    const item = inventory[idx];
    inventory.splice(idx, 1);

    const effects = {};
    const itemTypeInfo = INVENTORY.ITEM_TYPES[item.type];

    if (itemTypeInfo) {
      if (itemTypeInfo.heal) effects.heal = itemTypeInfo.heal;
      if (itemTypeInfo.duration) effects.duration = itemTypeInfo.duration;
      if (itemTypeInfo.multiplier) effects.multiplier = itemTypeInfo.multiplier;
      if (itemTypeInfo.absorb) effects.absorb = itemTypeInfo.absorb;
      if (itemTypeInfo.rarity) effects.rarity = itemTypeInfo.rarity;
    }

    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.INVENTORY_USE, {
        id: socket.id,
        itemId: data.itemId,
        type: item.type,
        effects,
      });
    }

    socket.emit(EVENTS.INVENTORY_USE, {
      success: true,
      itemId: data.itemId,
      type: item.type,
      effects,
      inventory,
    });
  });

  socket.on(EVENTS.INVENTORY_DROP, (data) => {
    const inventory = getInventory(playerId);
    const idx = inventory.findIndex((item) => item.id === data.itemId);
    if (idx === -1) {
      socket.emit(EVENTS.INVENTORY_DROP, { success: false, reason: 'item_not_found' });
      return;
    }

    const dropped = inventory.splice(idx, 1)[0];

    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.INVENTORY_DROP, {
        id: socket.id,
        item: dropped,
        x: data.x,
        y: data.y,
      });
    }

    socket.emit(EVENTS.INVENTORY_DROP, {
      success: true,
      itemId: dropped.id,
      inventory,
    });
  });

  // ── PvP Match Queue ──
  socket.on(EVENTS.PVP_MATCH_QUEUE, (data) => {
    if (data?.action === 'join') {
      addToPvpQueue(socket.id);
      socket.emit(EVENTS.PVP_MATCH_QUEUE, { status: 'queued' });
    } else if (data?.action === 'leave') {
      removeFromPvpQueue(socket.id);
      socket.emit(EVENTS.PVP_MATCH_QUEUE, { status: 'left_queue' });
    }
  });

  socket.on(EVENTS.PVP_MATCH_END, (data) => {
    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PVP_MATCH_END, data);
    }
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    console.log(`[Connection] Player disconnected: ${socket.id}`);

    stopMining(socket);
    removeFromPvpQueue(socket.id);

    const roomId = playerRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit(EVENTS.PLAYER_LEFT, {
        id: socket.id,
        playerId,
      });
    }

    playerRooms.delete(socket.id);

    // Schedule inventory cleanup (delayed in case of quick reconnect)
    setTimeout(() => {
      // Only delete if no other socket is using this playerId
      const stillConnected = [...io.sockets.sockets.values()].some(
        (s) => (s.handshake.query.playerId || s.id) === playerId
      );
      if (!stillConnected) {
        playerInventories.delete(playerId);
      }
    }, 60000); // 1 minute grace period
  });
});

// ─── Server start ────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`[Token Wars] Server running on ${HOST}:${PORT}`);
  console.log(`[Token Wars] Static files from: ${path.join(__dirname, '..', 'client', 'public')}`);
});

module.exports = app;
