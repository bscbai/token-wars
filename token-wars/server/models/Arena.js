const { v4: uuidv4 } = require('uuid');
const { MAP_WIDTH, MAP_HEIGHT, TILE, PVP } = require('../../shared/constants');

class Arena {
  constructor(mode, teams) {
    this.id = uuidv4();
    this.mode = mode; // '1v1' or '3v3'
    this.teams = teams; // [[playerIds], [playerIds]]
    this.state = 'waiting'; // waiting, active, round_over, match_over
    this.currentRound = 1;
    this.maxRounds = mode === '1v1' ? 3 : 1;
    this.scores = [0, 0]; // wins per team
    this.roundStartTime = 0;
    this.mapData = null;
    this.lastStandApplied = new Set(); // playerIds who got Last Stand
  }

  get isActive() {
    return this.state === 'active';
  }

  get matchWinner() {
    const winsNeeded = Math.ceil(this.maxRounds / 2);
    if (this.scores[0] >= winsNeeded) return 0;
    if (this.scores[1] >= winsNeeded) return 1;
    return -1;
  }

  generateMap() {
    const map = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      map[y] = [];
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
          map[y][x] = TILE.WALL;
        } else {
          map[y][x] = TILE.FLOOR;
        }
      }
    }

    // Symmetrical obstacles
    const obstacles = [
      [7, 7], [7, 22], [22, 7], [22, 22],
      [10, 10], [10, 19], [19, 10], [19, 19],
      [15, 12], [15, 17],
    ];
    for (const [ox, oy] of obstacles) {
      map[oy][ox] = TILE.WALL;
    }

    // Spawn points
    map[MAP_HEIGHT - 2][5] = TILE.SPAWN_A;
    map[MAP_HEIGHT - 2][24] = TILE.SPAWN_B;

    return map;
  }

  getSpawnPosition(teamIndex) {
    if (teamIndex === 0) return { x: 5, y: MAP_HEIGHT - 2 };
    return { x: 24, y: MAP_HEIGHT - 2 };
  }

  startRound() {
    this.state = 'active';
    this.roundStartTime = Date.now();
    this.mapData = this.generateMap();
    this.lastStandApplied.clear();
  }

  endRound(winnerTeam) {
    this.state = 'round_over';
    this.scores[winnerTeam]++;
  }

  checkMatchEnd() {
    const winsNeeded = Math.ceil(this.maxRounds / 2);
    if (this.scores[0] >= winsNeeded || this.scores[1] >= winsNeeded) {
      this.state = 'match_over';
      return true;
    }
    return false;
  }

  serialize() {
    return {
      id: this.id,
      mode: this.mode,
      teams: this.teams,
      state: this.state,
      currentRound: this.currentRound,
      scores: this.scores,
    };
  }
}

module.exports = Arena;
