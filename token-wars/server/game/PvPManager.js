const Arena = require('../models/Arena');
const { PVP, DEATH_DROP_RATE, MAP_WIDTH, MAP_HEIGHT, TILE } = require('../../shared/constants');
const { EVENTS } = require('../../shared/protocol');

class PvPManager {
  constructor(io, store, combatSystem) {
    this.io = io;
    this.store = store;
    this.combat = combatSystem;
    this.queues = { '1v1': [], '3v3': [] }; // mode -> [{playerId, rating, socket}]
    this.activeArenas = new Map(); // arenaId -> Arena
    this.playerArenas = new Map(); // playerId -> arenaId
    this.playerSockets = new Map();
  }

  registerSocket(playerId, socket) {
    this.playerSockets.set(playerId, socket);

    socket.on(EVENTS.PVP_QUEUE, ({ mode }) => {
      this.joinQueue(playerId, mode);
    });

    socket.on(EVENTS.PVP_DEQUEUE, () => {
      this.leaveQueue(playerId);
    });
  }

  unregisterSocket(playerId) {
    this.playerSockets.delete(playerId);
    this.leaveQueue(playerId);
    const arenaId = this.playerArenas.get(playerId);
    if (arenaId) this.leaveArena(playerId, arenaId);
  }

  joinQueue(playerId, mode) {
    if (!['1v1', '3v3'].includes(mode)) return;
    if (this.playerArenas.has(playerId)) return;

    const player = this.store.getPlayerById(playerId);
    const socket = this.playerSockets.get(playerId);
    if (!player || !socket) return;

    // Check if already in queue
    if (this.queues[mode].some(q => q.playerId === playerId)) return;

    this.queues[mode].push({
      playerId,
      rating: player.pvpRating,
      socket,
    });

    console.log(`[PvP] ${player.username} queued for ${mode} (${this.queues[mode].length} in queue)`);

    // Try to match
    this.tryMatch(mode);
  }

  leaveQueue(playerId) {
    for (const mode of ['1v1', '3v3']) {
      this.queues[mode] = this.queues[mode].filter(q => q.playerId !== playerId);
    }
  }

  tryMatch(mode) {
    const queue = this.queues[mode];
    const requiredPlayers = mode === '1v1' ? 2 : 6;

    if (queue.length < requiredPlayers) return;

    // Sort by rating for fair matching
    queue.sort((a, b) => a.rating - b.rating);

    // Take first N players
    const matched = queue.splice(0, requiredPlayers);

    // Split into teams
    const teams = mode === '1v1'
      ? [[matched[0].playerId], [matched[1].playerId]]
      : [
          [matched[0].playerId, matched[1].playerId, matched[2].playerId],
          [matched[3].playerId, matched[4].playerId, matched[5].playerId],
        ];

    this.createArena(mode, teams, matched);
  }

  createArena(mode, teams, queueEntries) {
    const arena = new Arena(mode, teams);
    this.activeArenas.set(arena.id, arena);

    // Register players
    for (const entry of queueEntries) {
      this.playerArenas.set(entry.playerId, arena.id);
      this.combat.registerSocket(entry.playerId, entry.socket);
    }

    // Set positions
    teams.forEach((team, teamIdx) => {
      const spawn = arena.getSpawnPosition(teamIdx);
      team.forEach((playerId, i) => {
        const player = this.store.getPlayerById(playerId);
        if (player) {
          player.x = spawn.x + i;
          player.y = spawn.y;
          player.hp = player.maxHp;
          player.alive = true;
          player.shield = 0;
          player.buffs = [];
        }
      });
    });

    // Start first round
    arena.startRound();

    // Notify all players
    this.broadcastToArena(arena, EVENTS.PVP_MATCHED, {
      arenaId: arena.id,
      teams,
      mapData: arena.mapData,
      mode,
    });

    this.broadcastToArena(arena, EVENTS.PVP_ROUND_START, {
      roundNumber: arena.currentRound,
    });

    // Start arena loop
    this.startArenaLoop(arena);
  }

  startArenaLoop(arena) {
    arena.loopInterval = setInterval(() => {
      if (arena.state !== 'active') return;
      this.arenaTick(arena);
    }, 50); // 20 Hz
  }

  arenaTick(arena) {
    const now = Date.now();
    const elapsed = now - arena.roundStartTime;

    // Check shrinking (after 90s)
    if (elapsed >= PVP.SHRINK_TIME && elapsed < PVP.CORE_TIME) {
      // Hazard tiles on edges
      // (simplified: just broadcast warning)
    }

    // Check Data Core spawn (after 120s)
    if (elapsed >= PVP.CORE_TIME && !arena.dataCoreSpawned) {
      arena.dataCoreSpawned = true;
      arena.dataCoreHp = PVP.CORE_HP;
      arena.dataCorePos = { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) };
      // Broadcast core spawn
      this.broadcastToArena(arena, 'pvp:data_core', {
        x: arena.dataCorePos.x,
        y: arena.dataCorePos.y,
        hp: arena.dataCoreHp,
      });
    }

    // Check round end conditions
    const aliveByTeam = arena.teams.map(team =>
      team.filter(pid => {
        const p = this.store.getPlayerById(pid);
        return p && p.alive;
      })
    );

    // Check if a team is wiped
    if (aliveByTeam[0].length === 0) {
      this.endRound(arena, 1);
    } else if (aliveByTeam[1].length === 0) {
      this.endRound(arena, 0);
    }

    // Apply Last Stand buffs
    for (let teamIdx = 0; teamIdx < 2; teamIdx++) {
      const team = arena.teams[teamIdx];
      const alive = aliveByTeam[teamIdx];
      if (alive.length > 0 && alive.length < team.length) {
        // Some teammates dead — apply Last Stand to survivors
        for (const pid of alive) {
          if (!arena.lastStandApplied.has(pid)) {
            const player = this.store.getPlayerById(pid);
            if (player) {
              const deadCount = team.length - alive.length;
              player.buffs.push({
                name: 'last_stand',
                atkMult: Math.pow(PVP.LAST_STAND_ATK, deadCount),
                defMult: Math.pow(PVP.LAST_STAND_DEF, deadCount),
                expiresAt: now + PVP.LAST_STAND_DURATION,
              });
              arena.lastStandApplied.add(pid);

              this.broadcastToArena(arena, EVENTS.PVP_LAST_STAND, {
                playerId: pid,
                atkBonus: PVP.LAST_STAND_ATK,
                defBonus: PVP.LAST_STAND_DEF,
                duration: PVP.LAST_STAND_DURATION,
                stackCount: deadCount,
              });
            }
          }
        }
      }
    }

    // Sync state
    this.syncArenaState(arena);
  }

  endRound(arena, winnerTeam) {
    arena.endRound(winnerTeam);

    this.broadcastToArena(arena, EVENTS.PVP_ROUND_END, {
      winner: winnerTeam,
      scores: arena.scores,
    });

    // Check if match is over
    if (arena.checkMatchEnd()) {
      this.endMatch(arena);
    } else {
      // Start next round after delay
      setTimeout(() => {
        arena.currentRound++;
        arena.startRound();
        arena.dataCoreSpawned = false;

        // Reset players
        arena.teams.forEach((team, teamIdx) => {
          const spawn = arena.getSpawnPosition(teamIdx);
          team.forEach((playerId, i) => {
            const player = this.store.getPlayerById(playerId);
            if (player) {
              player.x = spawn.x + i;
              player.y = spawn.y;
              player.hp = player.maxHp;
              player.alive = true;
              player.shield = 0;
              player.buffs = [];
            }
          });
        });

        this.broadcastToArena(arena, EVENTS.PVP_ROUND_START, {
          roundNumber: arena.currentRound,
        });
      }, 3000);
    }
  }

  endMatch(arena) {
    const winner = arena.matchWinner;

    // Calculate rating changes
    const ratingChanges = {};
    for (let teamIdx = 0; teamIdx < 2; teamIdx++) {
      for (const pid of arena.teams[teamIdx]) {
        const player = this.store.getPlayerById(pid);
        if (!player) continue;
        const won = teamIdx === winner;
        const change = won ? PVP.RATING_CHANGE : -PVP.RATING_CHANGE;
        player.pvpRating += change;
        ratingChanges[pid] = change;

        if (won) {
          player.pvpWins++;
          player.winStreak++;
          // Streak rewards
          if (player.winStreak >= 3 && player.streakRewardsClaimed < PVP.WIN_STREAK_DAILY_CAP) {
            player.addUnstableTokens(2);
            player.streakRewardsClaimed++;
          }
        } else {
          player.pvpLosses++;
          player.winStreak = 0;
          player.addUnstableTokens(1); // consolation
        }

        player.addXp(won ? 75 : 25);
        this.combat.syncPlayer(player);
      }
    }

    this.broadcastToArena(arena, EVENTS.PVP_MATCH_END, {
      winner,
      ratingChanges,
    });

    // Cleanup
    setTimeout(() => this.cleanupArena(arena), 5000);
  }

  syncArenaState(arena) {
    const state = { players: [] };
    for (const team of arena.teams) {
      for (const pid of team) {
        const player = this.store.getPlayerById(pid);
        if (player) {
          state.players.push({
            id: player.id,
            x: player.x,
            y: player.y,
            hp: player.hp,
            maxHp: player.maxHp,
            alive: player.alive,
            team: arena.teams.indexOf(team),
          });
        }
      }
    }
    this.broadcastToArena(arena, EVENTS.STATE_SYNC, state);
  }

  broadcastToArena(arena, event, data) {
    for (const team of arena.teams) {
      for (const pid of team) {
        const socket = this.playerSockets.get(pid);
        if (socket) socket.emit(event, data);
      }
    }
  }

  cleanupArena(arena) {
    if (arena.loopInterval) clearInterval(arena.loopInterval);
    for (const team of arena.teams) {
      for (const pid of team) {
        this.playerArenas.delete(pid);
      }
    }
    this.activeArenas.delete(arena.id);
  }
}

module.exports = PvPManager;
