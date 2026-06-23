const { Dungeon, DUNGEON_TEMPLATES } = require('../models/Dungeon');
const { Monster, MONSTER_TEMPLATES } = require('../models/Monster');
const { MAP_WIDTH, MAP_HEIGHT, TILE } = require('../../shared/constants');
const { EVENTS } = require('../../shared/protocol');

class PvEManager {
  constructor(io, store, combatSystem) {
    this.io = io;
    this.store = store;
    this.combat = combatSystem;
    this.activeDungeons = new Map(); // dungeonId -> Dungeon
    this.playerDungeons = new Map(); // playerId -> dungeonId
    this.playerSockets = new Map(); // playerId -> socket
    this.entities = new Map(); // global entity registry for combat
  }

  registerSocket(playerId, socket) {
    this.playerSockets.set(playerId, socket);

    // Dungeon join
    socket.on(EVENTS.DUNGEON_JOIN, ({ dungeonId }) => {
      this.joinDungeon(playerId, dungeonId);
    });
  }

  unregisterSocket(playerId) {
    this.playerSockets.delete(playerId);
    // Leave dungeon if in one
    const dungeonId = this.playerDungeons.get(playerId);
    if (dungeonId) {
      this.leaveDungeon(playerId, dungeonId);
    }
  }

  joinDungeon(playerId, templateId) {
    const player = this.store.getPlayerById(playerId);
    const socket = this.playerSockets.get(playerId);
    if (!player || !socket) return;

    // Check if already in dungeon
    if (this.playerDungeons.has(playerId)) {
      socket.emit(EVENTS.ERROR, { message: '已经在副本中', code: 'IN_DUNGEON' });
      return;
    }

    // Create dungeon instance
    const dungeon = new Dungeon(templateId);
    dungeon.addPlayer(player);
    dungeon.state = 'active';

    this.activeDungeons.set(dungeon.id, dungeon);
    this.playerDungeons.set(playerId, dungeon.id);

    // Generate map for first room
    const roomData = dungeon.currentRoomData;
    dungeon.mapData = dungeon.generateMap(roomData.layout);

    // Set player position at spawn
    player.x = Math.floor(MAP_WIDTH / 2);
    player.y = MAP_HEIGHT - 2;
    player.hp = player.maxHp;
    player.alive = true;

    // Register with combat system
    this.combat.registerSocket(playerId, socket);
    this.entities.set(player.id, player);

    // Spawn monsters for first room
    this.spawnRoomMonsters(dungeon, roomData);

    // Send dungeon start to player
    socket.emit(EVENTS.DUNGEON_START, {
      dungeonId: dungeon.id,
      mapData: dungeon.mapData,
      roomIndex: 0,
      monsters: Array.from(dungeon.monsters.values()).map(m => m.serialize()),
      playerPos: { x: player.x, y: player.y },
    });

    // Start game loop for this dungeon
    this.startDungeonLoop(dungeon);
  }

  spawnRoomMonsters(dungeon, roomData) {
    dungeon.monsters = new Map();
    const spawnPositions = this.getSpawnPositions(roomData.enemies.length);

    roomData.enemies.forEach((templateId, i) => {
      const pos = spawnPositions[i];
      const monster = new Monster(templateId, pos.x, pos.y);
      dungeon.monsters.set(monster.id, monster);
      this.entities.set(monster.id, monster);
    });
  }

  getSpawnPositions(count) {
    const positions = [];
    for (let i = 0; i < count; i++) {
      positions.push({
        x: 5 + Math.floor(Math.random() * (MAP_WIDTH - 10)),
        y: 3 + Math.floor(Math.random() * 8),
      });
    }
    return positions;
  }

  startDungeonLoop(dungeon) {
    dungeon.loopInterval = setInterval(() => {
      if (dungeon.state !== 'active') {
        clearInterval(dungeon.loopInterval);
        return;
      }

      this.dungeonTick(dungeon);
    }, 50); // 20 Hz
  }

  dungeonTick(dungeon) {
    const now = Date.now();

    // Process each monster AI
    for (const [monsterId, monster] of dungeon.monsters) {
      if (!monster.alive) continue;

      // Find target
      const target = monster.getHighestThreatPlayer(dungeon.players) ||
                     this.getNearestPlayer(monster, dungeon.players);

      if (!target) continue;

      const dist = Math.abs(monster.x - target.x) + Math.abs(monster.y - target.y);

      // Leash check
      const leashDist = Math.sqrt(
        Math.pow(monster.x - monster.leashOrigin.x, 2) +
        Math.pow(monster.y - monster.leashOrigin.y, 2)
      );
      if (leashDist > monster.leashRange) {
        monster.aiState = 'leashing';
        monster.x = monster.leashOrigin.x;
        monster.y = monster.leashOrigin.y;
        monster.hp = monster.maxHp;
        monster.threatTable.clear();
        continue;
      }

      // Attack if adjacent
      if (dist <= 1 && now - monster.lastAttackTime >= monster.attackCooldown) {
        monster.aiState = 'attacking';
        monster.lastAttackTime = now;

        // Calculate damage
        const damage = Math.max(monster.atk - target.def, 1);
        this.combat.damagePlayer(target, damage, monsterId, dungeon.players);

        // Broadcast attack
        this.broadcastToDungeon(dungeon, EVENTS.COMBAT_HIT, {
          attackerId: monsterId,
          targetId: target.id,
          damage,
          skillId: 'monster_attack',
          isCrit: false,
        });
      }
      // Move toward target
      else if (dist > 1) {
        monster.aiState = 'chasing';
        this.moveMonsterToward(monster, target, dungeon.mapData);
      }
    }

    // Check room clear (all monsters dead)
    const allDead = Array.from(dungeon.monsters.values()).every(m => !m.alive);
    if (allDead && dungeon.state === 'active') {
      this.onRoomClear(dungeon);
    }

    // Sync state to players
    this.syncDungeonState(dungeon);
  }

  moveMonsterToward(monster, target, mapData) {
    const dx = Math.sign(target.x - monster.x);
    const dy = Math.sign(target.y - monster.y);

    // Try horizontal first, then vertical
    let newX = monster.x + dx;
    let newY = monster.y;

    if (this.isWalkable(newX, newY, mapData)) {
      monster.x = newX;
      return;
    }

    newX = monster.x;
    newY = monster.y + dy;
    if (this.isWalkable(newX, newY, mapData)) {
      monster.y = newY;
    }
  }

  isWalkable(x, y, mapData) {
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
    return mapData[y][x] !== TILE.WALL;
  }

  getNearestPlayer(monster, players) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const [, player] of players) {
      if (!player.alive) continue;
      const dist = Math.abs(monster.x - player.x) + Math.abs(monster.y - player.y);
      if (dist < nearestDist) {
        nearest = player;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  onRoomClear(dungeon) {
    dungeon.advanceRoom();

    if (dungeon.state === 'complete') {
      // Dungeon finished!
      this.completeDungeon(dungeon);
      return;
    }

    // Move to next room
    const nextRoom = dungeon.currentRoomData;
    dungeon.mapData = dungeon.generateMap(nextRoom.layout);

    // Reset player positions
    for (const [, player] of dungeon.players) {
      player.x = Math.floor(MAP_WIDTH / 2);
      player.y = MAP_HEIGHT - 2;
    }

    // Spawn next room's monsters
    this.spawnRoomMonsters(dungeon, nextRoom);

    // Notify players
    this.broadcastToDungeon(dungeon, EVENTS.DUNGEON_ROOM_CLEAR, {
      roomIndex: dungeon.currentRoom - 1,
      nextRoom: dungeon.currentRoom,
    });
    this.broadcastToDungeon(dungeon, EVENTS.DUNGEON_START, {
      dungeonId: dungeon.id,
      mapData: dungeon.mapData,
      roomIndex: dungeon.currentRoom,
      monsters: Array.from(dungeon.monsters.values()).map(m => m.serialize()),
    });
  }

  completeDungeon(dungeon) {
    // Calculate rewards
    const rewards = {
      unstable: 10 + dungeon.rooms.length * 5,
      xp: 50 + dungeon.rooms.length * 30,
      stableChance: 0.3 + dungeon.rooms.length * 0.1,
    };

    for (const [, player] of dungeon.players) {
      player.addUnstableTokens(rewards.unstable);
      player.addXp(rewards.xp);
      if (Math.random() < rewards.stableChance) {
        player.addStableToken('rare');
      }
      this.combat.syncPlayer(player);

      const socket = this.playerSockets.get(player.id);
      if (socket) {
        socket.emit(EVENTS.DUNGEON_COMPLETE, { rewards });
      }
    }

    this.cleanupDungeon(dungeon);
  }

  leaveDungeon(playerId, dungeonId) {
    const dungeon = this.activeDungeons.get(dungeonId);
    if (!dungeon) return;

    dungeon.removePlayer(playerId);
    this.playerDungeons.delete(playerId);
    this.entities.delete(playerId);
    this.combat.unregisterSocket(playerId);

    if (dungeon.players.size === 0) {
      this.cleanupDungeon(dungeon);
    }
  }

  cleanupDungeon(dungeon) {
    if (dungeon.loopInterval) clearInterval(dungeon.loopInterval);
    for (const [id] of dungeon.monsters || []) {
      this.entities.delete(id);
    }
    this.activeDungeons.delete(dungeon.id);
    for (const [playerId] of dungeon.players) {
      this.playerDungeons.delete(playerId);
    }
  }

  syncDungeonState(dungeon) {
    const state = {
      players: [],
      monsters: [],
    };
    for (const [, player] of dungeon.players) {
      state.players.push({ id: player.id, x: player.x, y: player.y, hp: player.hp, maxHp: player.maxHp, alive: player.alive });
    }
    for (const [, monster] of dungeon.monsters) {
      if (monster.alive) state.monsters.push(monster.serialize());
    }
    this.broadcastToDungeon(dungeon, EVENTS.STATE_SYNC, state);
  }

  broadcastToDungeon(dungeon, event, data) {
    for (const [playerId] of dungeon.players) {
      const socket = this.playerSockets.get(playerId);
      if (socket) socket.emit(event, data);
    }
  }
}

module.exports = PvEManager;
