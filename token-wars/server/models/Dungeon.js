const { v4: uuidv4 } = require('uuid');
const { MAP_WIDTH, MAP_HEIGHT, TILE } = require('../../shared/constants');

// Dungeon templates
const DUNGEON_TEMPLATES = {
  solo_easy: {
    name: '初级数据矿洞',
    difficulty: 'solo',
    maxPlayers: 1,
    rooms: [
      {
        enemies: ['drone', 'drone', 'drone'],
        layout: 'open_room',
      },
      {
        enemies: ['drone', 'crawler', 'drone'],
        layout: 'open_room',
      },
      {
        enemies: ['elite_guard'],
        layout: 'open_room',
      },
      {
        enemies: ['boss_cache_controller'],
        layout: 'boss_arena',
        isBoss: true,
      },
    ],
  },
  group_medium: {
    name: '中级算力仓库',
    difficulty: 'group',
    maxPlayers: 5,
    rooms: [
      {
        enemies: ['crawler', 'crawler', 'drone', 'drone'],
        layout: 'open_room',
      },
      {
        enemies: ['crawler', 'elite_guard', 'drone'],
        layout: 'corridor',
      },
      {
        enemies: ['elite_guard', 'elite_guard'],
        layout: 'open_room',
      },
      {
        enemies: ['boss_cache_controller'],
        layout: 'boss_arena',
        isBoss: true,
      },
    ],
  },
};

class Dungeon {
  constructor(templateId) {
    const template = DUNGEON_TEMPLATES[templateId];
    if (!template) throw new Error(`Unknown dungeon template: ${templateId}`);

    this.id = uuidv4();
    this.templateId = templateId;
    this.name = template.name;
    this.difficulty = template.difficulty;
    this.maxPlayers = template.maxPlayers;
    this.rooms = template.rooms;
    this.currentRoom = 0;
    this.players = new Map(); // playerId -> player ref
    this.state = 'waiting'; // waiting, active, complete, failed
    this.mapData = null;
  }

  get isComplete() {
    return this.currentRoom >= this.rooms.length;
  }

  get currentRoomData() {
    return this.rooms[this.currentRoom] || null;
  }

  addPlayer(player) {
    if (this.players.size >= this.maxPlayers) return false;
    this.players.set(player.id, player);
    return true;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  advanceRoom() {
    this.currentRoom++;
    if (this.currentRoom >= this.rooms.length) {
      this.state = 'complete';
    }
  }

  generateMap(roomLayout) {
    const map = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      map[y] = [];
      for (let x = 0; x < MAP_WIDTH; x++) {
        // Border walls
        if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
          map[y][x] = TILE.WALL;
        } else {
          map[y][x] = TILE.FLOOR;
        }
      }
    }

    // Add some obstacles based on layout
    if (roomLayout === 'corridor') {
      // Walls creating a corridor
      for (let x = 5; x < 25; x++) {
        map[10][x] = TILE.WALL;
        map[20][x] = TILE.WALL;
      }
      map[10][12] = TILE.FLOOR; // gap
      map[20][18] = TILE.FLOOR; // gap
    } else if (roomLayout === 'boss_arena') {
      // Open arena with pillars
      const pillars = [[7, 7], [7, 22], [22, 7], [22, 22], [15, 15]];
      for (const [px, py] of pillars) {
        map[py][px] = TILE.WALL;
      }
    }

    // Spawn points
    map[MAP_HEIGHT - 2][Math.floor(MAP_WIDTH / 2)] = TILE.SPAWN_A;

    return map;
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      difficulty: this.difficulty,
      currentRoom: this.currentRoom,
      totalRooms: this.rooms.length,
      state: this.state,
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
    };
  }
}

module.exports = { Dungeon, DUNGEON_TEMPLATES };
