const { AIAgent, AI_LEVELS, AI_DECISIONS } = require('../models/AIAgent');
const { SKILLS, calcDamage, MAP_WIDTH, MAP_HEIGHT, TILE, PVP } = require('../../shared/constants');
const { EVENTS } = require('../../shared/protocol');
const guard = require('../middleware/eventGuard');

// AI Arena constants
const AI_MATCH_TICK_MS = 50; // Simulate at 20Hz
const AI_MATCH_MAX_TIME_MS = 120000; // 120 seconds max
const AI_MATCH_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown
const AI_DAILY_MATCH_CAP = 20;
const AI_AELO_K = 20;

// Season AI Buffs (applied to all agents during specific season weeks)
const SEASON_BUFFS = {
  QUANTUM_AWAKEN: {
    id: 'quantum_awaken',
    name: '量子觉醒',
    attackWeightBonus: 0.15,
    description: 'AI攻击倾向 +15%',
  },
  SHADOW_PROTOCOL: {
    id: 'shadow_protocol',
    name: '暗影协议',
    dodgeWeightBonus: 0.15,
    description: 'AI闪避倾向 +15%',
  },
  ENTROPY_CRISIS: {
    id: 'entropy_crisis',
    name: '熵增危机',
    counterChance: 0.20,
    description: 'AI受伤时反击概率 +20%',
  },
};

// Tournament constants
const TOURNAMENT_TOP_N = 16; // Top 16 enter elimination bracket
const TOURNAMENT_MATCH_INTERVAL_MS = 30000; // 30s between tournament match broadcasts

// AI Arena maps
const AI_MAPS = {
  DATA_MINE: {
    id: 'data_mine',
    name: '数据矿洞',
    width: 20,
    height: 20,
    obstacles: [
      [4, 4], [4, 15], [15, 4], [15, 15],
      [7, 7], [7, 12], [12, 7], [12, 12],
      [10, 8], [6, 10], [13, 10],
    ],
    weightMods: { mobility: 0.15, attack: -0.10 },
    spawnA: { x: 1, y: 1 },
    spawnB: { x: 18, y: 18 },
  },
  COMPUTE_SQUARE: {
    id: 'compute_square',
    name: '算力广场',
    width: 20,
    height: 20,
    obstacles: [
      [9, 9], [10, 9], [9, 10], [10, 10], // Center block
    ],
    weightMods: { attack: 0.15, mobility: -0.05 },
    spawnA: { x: 1, y: 10 },
    spawnB: { x: 18, y: 10 },
  },
  CACHE_MAZE: {
    id: 'cache_maze',
    name: '缓存迷宫',
    width: 20,
    height: 20,
    obstacles: [
      [3, 3], [3, 5], [3, 7], [3, 9], [3, 11],
      [16, 3], [16, 5], [16, 7], [16, 9], [16, 11],
      [8, 5], [8, 14], [11, 5], [11, 14],
    ],
    weightMods: { mobility: 0.20, defense: 0.10 },
    spawnA: { x: 1, y: 1 },
    spawnB: { x: 18, y: 18 },
  },
  ARENA_DOME: {
    id: 'arena_dome',
    name: '竞技穹顶',
    width: 20,
    height: 20,
    obstacles: [[5, 5], [14, 5], [5, 14], [14, 14]],
    weightMods: {},
    spawnA: { x: 1, y: 1 },
    spawnB: { x: 18, y: 18 },
  },
  DATA_TORRENT: {
    id: 'data_torrent',
    name: '数据洪流',
    width: 20,
    height: 20,
    obstacles: [[5, 9], [14, 9]],
    weightMods: { mobility: 0.25, economy: -0.10 },
    spawnA: { x: 1, y: 1 },
    spawnB: { x: 18, y: 18 },
  },
};

class AIArenaManager {
  constructor(io, store, combatSystem) {
    this.io = io;
    this.store = store;
    this.combat = combatSystem;
    this.agents = new Map(); // agentId -> AIAgent
    this.playerAgents = new Map(); // playerId -> [agentIds]
    this.playerSockets = new Map(); // playerId -> socket
    this.matchQueue = []; // agentIds waiting for match
    this.activeMatches = new Map(); // matchId -> match state
    this.matchHistory = []; // recent matches for replay
    this.maxHistoryLength = 1000;

    // Season & tournament state
    this.currentSeason = { buff: null, week: 1 };
    this.tournament = null; // active tournament bracket
    this.tournamentTimer = null; // interval for match broadcasts
  }

  // --- Socket Registration ---

  registerSocket(playerId, socket) {
    this.playerSockets.set(playerId, socket);

    // --- Schemas ---
    const deploySchema   = { tokenDisk: { type: 'any', required: true } };
    const agentIdSchema  = { agentId: { type: 'string', maxLength: 100, required: true } };
    const behaviorSchema = { agentId: { type: 'string', maxLength: 100, required: true }, behaviorId: { type: 'string', maxLength: 50, required: true } };
    const nameSchema     = { agentId: { type: 'string', maxLength: 100, required: true }, name: { type: 'string', maxLength: 64, required: true } };
    const replaySchema   = { matchId: { type: 'string', maxLength: 200, required: true } };

    guard.on(socket, 'ai_arena:deploy',        deploySchema,   ({ tokenDisk }) => this.deployAgent(playerId, tokenDisk), 'economy');
    guard.on(socket, 'ai_arena:recall',         agentIdSchema,  ({ agentId }) => this.recallAgent(playerId, agentId), 'economy');
    guard.on(socket, 'ai_arena:train',          agentIdSchema,  ({ agentId }) => this.startTrainingMatch(playerId, agentId), 'economy');
    guard.on(socket, 'ai_arena:set_behavior',   behaviorSchema, ({ agentId, behaviorId }) => this.setAgentBehavior(playerId, agentId, behaviorId), 'economy');
    guard.on(socket, 'ai_arena:name_agent',     nameSchema,     ({ agentId, name }) => this.nameAgent(playerId, agentId, name), 'economy');
    guard.on(socket, 'ai_arena:match_history',  agentIdSchema,  ({ agentId }) => this.sendMatchHistory(playerId, agentId), 'query');
    guard.on(socket, 'ai_arena:get_agents',     null,           () => this.sendAgentList(playerId), 'query');
    guard.on(socket, 'ai_arena:get_replay',     replaySchema,   ({ matchId }) => this.sendReplay(playerId, matchId), 'query');
    guard.on(socket, 'ai_arena:leaderboard',    null,           () => this.sendLeaderboard(playerId), 'query');
    guard.on(socket, 'ai_arena:tournament',     null,           () => this.sendTournamentState(playerId), 'query');
    guard.on(socket, 'ai_arena:season_info',    null,           () => this.sendSeasonInfo(playerId), 'query');

    // Send existing agents on connect
    this.sendAgentList(playerId);
  }

  unregisterSocket(playerId) {
    this.playerSockets.delete(playerId);
  }

  // --- Agent Lifecycle ---

  deployAgent(playerId, tokenDisk) {
    const player = this.store.getPlayerById(playerId);
    if (!player) return;

    const agent = new AIAgent(playerId, tokenDisk, player.username);
    this.agents.set(agent.id, agent);

    if (!this.playerAgents.has(playerId)) {
      this.playerAgents.set(playerId, []);
    }
    this.playerAgents.get(playerId).push(agent.id);

    // Deploy: move tokens from player to agent
    agent.deployed = true;
    agent.deployedAt = Date.now();

    // Reset daily counter if needed
    const today = new Date().toDateString();
    if (agent.dailyResetDate !== today) {
      agent.dailyMatches = 0;
      agent.dailyResetDate = today;
    }

    // Auto-join queue
    this.joinQueue(playerId, agent.id);

    // Notify player
    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit('ai_arena:deployed', {
        agent: agent.serializeFull(),
        dailyMatchesLeft: AI_DAILY_MATCH_CAP - agent.dailyMatches,
      });
    }

    console.log(`[AI Arena] Agent deployed: ${agent.name} (${agent.id.slice(0, 8)}), AELO=${agent.aelo}`);
  }

  recallAgent(playerId, agentId) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.playerId !== playerId) return;

    this.leaveQueue(agentId);
    agent.deployed = false;

    // Return tokens to player
    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit('ai_arena:recalled', { agentId });
    }
  }

  setAgentBehavior(playerId, agentId, behaviorId) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.playerId !== playerId) return;

    const result = agent.setSpecialBehavior(behaviorId);

    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit('ai_arena:behavior_set', {
        agentId,
        specialBehavior: agent.specialBehavior,
        success: result,
      });
    }
  }

  nameAgent(playerId, agentId, name) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.playerId !== playerId) return;
    if (name.length > 12) name = name.slice(0, 12);
    agent.name = name;

    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit('ai_arena:agent_named', { agentId, name });
      this.sendAgentList(playerId);
    }
  }

  sendAgentList(playerId) {
    const agentIds = this.playerAgents.get(playerId) || [];
    const list = agentIds
      .map(id => this.agents.get(id))
      .filter(a => a)
      .map(a => a.serialize());

    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit('ai_arena:agent_list', { agents: list });
    }
  }

  // --- Queue & Matching ---

  joinQueue(playerId, agentId) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.inMatch) return;
    if (agent.dailyMatches >= AI_DAILY_MATCH_CAP) {
      const socket = this.playerSockets.get(playerId);
      if (socket) {
        socket.emit('ai_arena:queue_fail', {
          agentId,
          reason: 'daily_cap_reached',
        });
      }
      return;
    }
    if (Date.now() - agent.lastMatchTime < AI_MATCH_COOLDOWN_MS) {
      const remaining = Math.ceil((AI_MATCH_COOLDOWN_MS - (Date.now() - agent.lastMatchTime)) / 1000);
      const socket = this.playerSockets.get(playerId);
      if (socket) {
        socket.emit('ai_arena:queue_fail', {
          agentId,
          reason: 'cooldown',
          cooldownSeconds: remaining,
        });
      }
      return;
    }

    if (this.matchQueue.includes(agentId)) return;
    this.matchQueue.push(agentId);

    console.log(`[AI Arena] Agent queued: ${agent.name} (${this.matchQueue.length} in queue)`);

    // Try to match immediately
    this.tryMatch();
  }

  leaveQueue(agentId) {
    this.matchQueue = this.matchQueue.filter(id => id !== agentId);
  }

  tryMatch() {
    if (this.matchQueue.length < 2) return;

    // Sort by AELO for fair matching
    this.matchQueue.sort((a, b) => {
      const agA = this.agents.get(a);
      const agB = this.agents.get(b);
      return (agA?.aelo || 0) - (agB?.aelo || 0);
    });

    const matchedIds = this.matchQueue.splice(0, 2);
    const agentA = this.agents.get(matchedIds[0]);
    const agentB = this.agents.get(matchedIds[1]);

    if (!agentA || !agentB) return;

    // Pick a random map
    const mapKeys = Object.keys(AI_MAPS);
    const map = AI_MAPS[mapKeys[Math.floor(Math.random() * mapKeys.length)]];

    this.startMatch(agentA, agentB, map);
  }

  // --- Match Simulation ---

  startMatch(agentA, agentB, map) {
    agentA.inMatch = true;
    agentB.inMatch = true;

    // Reset combat state
    for (const agent of [agentA, agentB]) {
      agent.hp = agent.maxHp;
      agent.alive = true;
      agent.shield = 0;
      agent.shieldActive = false;
      agent.buffs = [];
      for (const skill of agent.skills) {
        skill.lastUsed = 0;
      }
    }

    // Position on map
    agentA.x = map.spawnA.x;
    agentA.y = map.spawnA.y;
    agentB.x = map.spawnB.x;
    agentB.y = map.spawnB.y;

    const match = {
      id: `${agentA.id}-${agentB.id}-${Date.now()}`,
      agentA: agentA.id,
      agentB: agentB.id,
      map: map.id,
      startTime: Date.now(),
      tickCount: 0,
      log: [], // key frames for replay
      winner: null,
    };

    this.activeMatches.set(match.id, match);

    // Simulate the entire match
    this.simulateMatch(match, agentA, agentB, map);

    // Resolve
    this.resolveMatch(match, agentA, agentB, map);
  }

  simulateMatch(match, agentA, agentB, map) {
    let tick = 0;
    let elapsed = 0;

    // Helper: is position walkable
    const isWalkable = (x, y) => {
      if (x < 0 || x >= map.width || y < 0 || y >= map.height) return false;
      return !map.obstacles.some(([ox, oy]) => ox === x && oy === y);
    };

    // Helper: Manhattan distance
    const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    while (elapsed < AI_MATCH_MAX_TIME_MS && agentA.alive && agentB.alive) {
      tick++;
      elapsed = tick * AI_MATCH_TICK_MS;
      const now = match.startTime + elapsed;

      // Process each agent's turn
      [agentA, agentB].forEach((agent, agentIdx) => {
        if (!agent.alive) return;
        const enemy = agentIdx === 0 ? agentB : agentA;

        // Apply shield drain
        if (agent.shieldActive) {
          agent.shield = Math.max(0, agent.shield - 1);
          if (agent.shield <= 0) agent.shieldActive = false;
        }

        // Get weighted decisions
        const attackWeight = agent.getWeight('attack');
        const defenseWeight = agent.getWeight('defense');
        const mobilityWeight = agent.getWeight('mobility');
        const economyWeight = agent.getWeight('economy');

        let actionTaken = 'idle';

        // Priority 1: Retreat + Shield (HP < 20% && high defense)
        if (agent.hp / agent.maxHp < 0.20 && defenseWeight > 50) {
          if (!agent.shieldActive && !agent.skillOnCooldown('shield', now)) {
            agent.enableShield(agent.shieldMax);
            agent.useSkill('shield', now);
            actionTaken = 'shield_retreat';
          }
          // Move away from enemy
          const dx = Math.sign(agent.x - enemy.x);
          const dy = Math.sign(agent.y - enemy.y);
          const nx = agent.x + dx, ny = agent.y + dy;
          if (isWalkable(nx, ny)) { agent.x = nx; agent.y = ny; actionTaken = 'retreat'; }
        }
        // Priority 2: Berserker combo (★ ★ ★ behavior)
        else if (agent.hasSpecialActive('berserker') && dist(agent, enemy) <= 2) {
          agent.useSkill('basic_attack', now, 1);
          if (!agent.skillOnCooldown('token_burst', now)) {
            agent.useSkill('token_burst', now, 3);
          }
          const dmg = calcDamage(agent.atk, 1.5, enemy.def);
          enemy.takeDamage(dmg, agent.id);
          actionTaken = `berserker_combo(${dmg})`;
          match.log.push({ tick, agent: agent.id, action: actionTaken, hp: agent.hp, enemyHp: enemy.hp, x: agent.x, y: agent.y, enemyX: enemy.x, enemyY: enemy.y });
        }
        // Priority 3: Low HP combo (enemy < 30% && high attack)
        else if (enemy.hp / enemy.maxHp < 0.30 && attackWeight > 50) {
          if (dist(agent, enemy) <= 2) {
            agent.useSkill('basic_attack', now, 1);
            if (!agent.skillOnCooldown('token_burst', now)) {
              agent.useSkill('token_burst', now, 3);
              const dmg = calcDamage(agent.atk, 1.5, enemy.def);
              enemy.takeDamage(dmg, agent.id);
              actionTaken = `combo(${dmg})`;
            } else {
              const dmg = calcDamage(agent.atk, 1.0, enemy.def);
              enemy.takeDamage(dmg, agent.id);
              actionTaken = `attack(${dmg})`;
            }
          } else {
            // Chase
            const dx = Math.sign(enemy.x - agent.x);
            const dy = Math.sign(enemy.y - agent.y);
            if (isWalkable(agent.x + dx, agent.y)) {
              agent.x += dx; actionTaken = 'chase_x';
            } else if (isWalkable(agent.x, agent.y + dy)) {
              agent.y += dy; actionTaken = 'chase_y';
            }
          }
          match.log.push({ tick, agent: agent.id, action: actionTaken, hp: agent.hp, enemyHp: enemy.hp, x: agent.x, y: agent.y, enemyX: enemy.x, enemyY: enemy.y });
        }
        // Priority 4: Melee attack (distance ≤ 2)
        else if (dist(agent, enemy) <= 2) {
          agent.useSkill('basic_attack', now, 1);
          const dmg = calcDamage(agent.atk, 1.0, enemy.def);
          enemy.takeDamage(dmg, agent.id);
          actionTaken = `attack(${dmg})`;
          match.log.push({ tick, agent: agent.id, action: actionTaken, hp: agent.hp, enemyHp: enemy.hp, x: agent.x, y: agent.y, enemyX: enemy.x, enemyY: enemy.y });
        }
        // Priority 5: Close gap (high mobility)
        else if (dist(agent, enemy) > 2 && mobilityWeight > 50) {
          if (!agent.skillOnCooldown('dodge_roll', now)) {
            agent.useSkill('dodge_roll', now, 0);
            const dx = Math.sign(enemy.x - agent.x);
            const dy = Math.sign(enemy.y - agent.y);
            const range = 3 + (agent.getSpecialEffect('dodgeRangeBonus') || 0);
            let nx = agent.x + dx * range;
            let ny = agent.y + dy * range;
            nx = Math.max(0, Math.min(map.width - 1, nx));
            ny = Math.max(0, Math.min(map.height - 1, ny));
            if (isWalkable(nx, ny)) { agent.x = nx; agent.y = ny; }
            actionTaken = 'dash';
          }
        }
        // Priority 6: Move toward enemy
        else if (dist(agent, enemy) > 2) {
          const dx = Math.sign(enemy.x - agent.x);
          const dy = Math.sign(enemy.y - agent.y);
          if (isWalkable(agent.x + dx, agent.y)) {
            agent.x += dx; actionTaken = 'move_x';
          } else if (isWalkable(agent.x, agent.y + dy)) {
            agent.y += dy; actionTaken = 'move_y';
          }
        }
        // Priority 7: Collect dropped token (high economy)
        else if (economyWeight > 50 && Math.random() < 0.3) {
          // Simplified: generate a random token position occasionally
          // In full version, tokens would be spawned by combat drops
          actionTaken = 'patrol';
        }
        // Priority 8: Patrol
        else {
          const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
          const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
          if (isWalkable(agent.x + dx, agent.y + dy)) { agent.x += dx; agent.y += dy; }
          actionTaken = 'patrol';
        }

        tick++;
        elapsed = tick * AI_MATCH_TICK_MS;
      });
    }

    match.totalTicks = tick;
    match.totalTimeMs = elapsed;
  }

  resolveMatch(match, agentA, agentB, map) {
    agentA.inMatch = false;
    agentB.inMatch = false;
    agentA.lastMatchTime = Date.now();
    agentB.lastMatchTime = Date.now();
    agentA.dailyMatches++;
    agentB.dailyMatches++;

    let winner = null;
    let loser = null;
    let isDraw = false;

    if (!agentA.alive && !agentB.alive) {
      // Both dead simultaneously — draw
      isDraw = true;
      winner = agentB; loser = agentA; // arbitrary for rating calc
    } else if (!agentA.alive) {
      winner = agentB; loser = agentA;
    } else if (!agentB.alive) {
      winner = agentA; loser = agentB;
    } else {
      // Timeout — compare HP percentage
      const hpPctA = agentA.hp / agentA.maxHp;
      const hpPctB = agentB.hp / agentB.maxHp;
      if (Math.abs(hpPctA - hpPctB) < 0.05) {
        isDraw = true;
      } else if (hpPctA > hpPctB) {
        winner = agentA; loser = agentB;
      } else {
        winner = agentB; loser = agentA;
      }
    }

    // Calculate AELO changes
    if (winner && loser) {
      const expected = 1 / (1 + Math.pow(10, (loser.aelo - winner.aelo) / 400));
      const ratingDiff = Math.round(AI_AELO_K * (1 - expected));
      winner.aelo += ratingDiff;
      loser.aelo = Math.max(0, loser.aelo - ratingDiff);

      if (isDraw) {
        winner.draws++;
        loser.draws++;
        // Halve the rating change for draws
        winner.aelo = winner.aelo - Math.round(ratingDiff / 2);
        loser.aelo = loser.aelo + Math.round(ratingDiff / 2);
      } else {
        winner.wins++;
        winner.currentStreak++;
        if (winner.currentStreak > winner.highestStreak) {
          winner.highestStreak = winner.currentStreak;
        }
        loser.losses++;
        loser.currentStreak = 0;
      }

      // Training XP
      if (isDraw) {
        winner.addExp(5);
        loser.addExp(5);
      } else {
        winner.addExp(10);
        loser.addExp(3);
      }
    }

    match.winner = winner?.id || 'draw';
    match.winnerAelo = winner?.aelo || null;
    match.loserAelo = loser?.aelo || null;

    // Save to history for replays
    this.matchHistory.push({
      ...match,
      agentAName: agentA.name,
      agentBName: agentB.name,
      agentAAelo: agentA.aelo,
      agentBAelo: agentB.aelo,
      mapData: {
        id: map.id,
        name: map.name,
        width: map.width,
        height: map.height,
        obstacles: map.obstacles,
        spawnA: map.spawnA,
        spawnB: map.spawnB,
      },
      saved: Date.now(),
    });
    if (this.matchHistory.length > this.maxHistoryLength) {
      this.matchHistory.shift();
    }

    // Notify both players
    for (const agent of [agentA, agentB]) {
      const socket = this.playerSockets.get(agent.playerId);
      if (socket) {
        socket.emit('ai_arena:match_result', {
          matchId: match.id,
          agentId: agent.id,
          aelo: agent.aelo,
          aeloChange: agent === winner ? AI_AELO_K : -AI_AELO_K,
          exp: agent.exp,
          level: agent.level.stars,
          wins: agent.wins,
          losses: agent.losses,
          draws: agent.draws,
          streak: agent.currentStreak,
          winnerId: match.winner,
          totalTicks: match.totalTicks,
        });
      }
    }

    // Daily rewards
    for (const agent of [agentA, agentB]) {
      this.processDailyReward(agent);
    }

    // Re-queue agents for next match
    for (const agent of [agentA, agentB]) {
      if (agent.deployed && agent.dailyMatches < AI_DAILY_MATCH_CAP) {
        setTimeout(() => {
          this.joinQueue(agent.playerId, agent.id);
        }, 2000); // 2s buffer between matches
      }
    }

    // Clean up
    this.activeMatches.delete(match.id);

    console.log(
      `[AI Arena] Match complete: ${agentA.name} vs ${agentB.name} -> ` +
      (isDraw ? 'DRAW' : `${winner?.name} wins`) +
      ` (${match.totalTicks} ticks, ${match.totalTimeMs}ms)`
    );

    // Try next match
    this.tryMatch();
  }

  processDailyReward(agent) {
    const league = this.getLeague(agent.aelo);
    const rewards = {
      bronze: { unstable: 20, expMult: 1.0, coprocessorChance: 0 },
      silver: { unstable: 50, expMult: 1.5, coprocessorChance: 0 },
      gold: { unstable: 100, expMult: 2.0, coprocessorChance: 0.1 },
      master: { unstable: 200, expMult: 3.0, coprocessorChance: 0.2 },
    };

    const reward = rewards[league.id] || rewards.bronze;

    // Accumulate daily reward (paid at reset or when agent is recalled)
    if (!agent._dailyReward) {
      agent._dailyReward = { unstable: 0, coprocessorFragments: 0 };
    }
    agent._dailyReward.unstable += Math.floor(reward.unstable / AI_DAILY_MATCH_CAP);
    if (Math.random() < reward.coprocessorChance / AI_DAILY_MATCH_CAP) {
      agent._dailyReward.coprocessorFragments++;
    }
  }

  getLeague(aelo) {
    if (aelo >= 2000) return { id: 'master', name: '大师' };
    if (aelo >= 1500) return { id: 'gold', name: '金' };
    if (aelo >= 1000) return { id: 'silver', name: '银' };
    return { id: 'bronze', name: '铜' };
  }

  // --- Training Mode ---

  startTrainingMatch(playerId, agentId) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.playerId !== playerId) return;

    // Create a dummy opponent at similar AELO
    const opponent = new AIAgent('system', agent.tokenDisk, 'TRAINER');
    opponent.aelo = agent.aelo + Math.floor(Math.random() * 100) - 50;

    // Use a fixed map
    const map = AI_MAPS.ARENA_DOME;

    const match = {
      id: `train-${agent.id}-${Date.now()}`,
      agentA: agent.id,
      agentB: opponent.id,
      map: map.id,
      startTime: Date.now(),
      tickCount: 0,
      log: [],
      winner: null,
      isTraining: true,
    };

    this.activeMatches.set(match.id, match);
    this.agents.set(opponent.id, opponent);
    agent.inMatch = true;
    opponent.inMatch = true;

    this.simulateMatch(match, agent, opponent, map);
    this.resolveMatch(match, agent, opponent, map);

    agent.dailyMatches--; // Training matches don't count against daily cap
    agent.inMatch = false;
    this.agents.delete(opponent.id);
  }

  // --- Replay ---

  sendReplay(playerId, matchId) {
    const match = this.matchHistory.find(m => m.id === matchId);
    if (!match) {
      const socket = this.playerSockets.get(playerId);
      if (socket) socket.emit('ai_arena:replay', { error: 'match_not_found' });
      return;
    }

    // Determine which agent this player controls
    const agentA = this.agents.get(match.agentA);
    const playerAgentId = (agentA && agentA.playerId === playerId) ? match.agentA : match.agentB;

    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit('ai_arena:replay', {
        matchId: match.id,
        agentAName: match.agentAName,
        agentBName: match.agentBName,
        winnerId: match.winner,
        playerAgentId,
        map: match.mapData,
        totalTicks: match.totalTicks,
        log: match.log,
      });
    }
  }

  sendMatchHistory(playerId, agentId) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.playerId !== playerId) return;

    const history = this.matchHistory
      .filter(m => m.agentA === agentId || m.agentB === agentId)
      .slice(-20)
      .reverse()
      .map(m => ({
        id: m.id,
        opponent: m.agentA === agentId ? m.agentBName : m.agentAName,
        map: m.mapData?.name || 'unknown',
        result: m.winner === 'draw' ? 'draw' : (m.winner === agentId ? 'win' : 'loss'),
        winnerId: m.winner,
        totalTicks: m.totalTicks,
        saved: m.saved,
      }));

    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit('ai_arena:match_history', { agentId, history });
    }
  }

  // --- Tick (called periodically by GameEngine) ---

  tick(now) {
    // Try to match agents in queue
    if (this.matchQueue.length >= 2) {
      this.tryMatch();
    }

    const today = new Date().toDateString();
    for (const [agentId, agent] of this.agents) {
      if (agent.dailyResetDate !== today) {
        this._settleDailyReward(agent);
        agent.dailyMatches = 0;
        agent.dailyResetDate = today;
      }
      this._applySeasonBuff(agent, now);
    }

    if (this.tournament && this.tournament.status === 'running') {
      this._tournamentTick(now);
    }
  }

  _settleDailyReward(agent) {
    if (agent._dailyReward) {
      const player = this.store.getPlayerById(agent.playerId);
      if (player) {
        player.addUnstableTokens(agent._dailyReward.unstable);
        if (agent._dailyReward.coprocessorFragments > 0) {
          player.coprocessorFragments = (player.coprocessorFragments || 0) + agent._dailyReward.coprocessorFragments;
        }
        // Transaction point: daily AI arena settlement.
        this.store.persist(player);
      }
      agent._dailyReward = { unstable: 0, coprocessorFragments: 0 };
    }
  }

  _applySeasonBuff(agent, now) {
    if (!this.currentSeason.buff) return;
    const buff = this.currentSeason.buff;
    if (buff.attackWeightBonus) agent._seasonAttackBonus = buff.attackWeightBonus;
    if (buff.dodgeWeightBonus) agent._seasonDodgeBonus = buff.dodgeWeightBonus;
    if (buff.counterChance) agent._seasonCounter = buff.counterChance;
  }

  // ===== SEASON SYSTEM =====

  setSeasonBuff(buffId) {
    const buff = Object.values(SEASON_BUFFS).find(b => b.id === buffId);
    if (!buff) return false;
    this.currentSeason.buff = buff;
    this.broadcast('ai_arena:season_update', {
      buff: { id: buff.id, name: buff.name, description: buff.description },
      week: this.currentSeason.week,
    });
    console.log(`[AI Arena] Season buff active: ${buff.name}`);
    return true;
  }

  advanceSeasonWeek() {
    this.currentSeason.week++;
    if (this.currentSeason.week === 3 && !this.tournament) {
      this._startPeakTournament();
    }
    this.broadcast('ai_arena:season_update', {
      buff: this.currentSeason.buff ? {
        id: this.currentSeason.buff.id,
        name: this.currentSeason.buff.name,
        description: this.currentSeason.buff.description,
      } : null,
      week: this.currentSeason.week,
    });
  }

  sendSeasonInfo(playerId) {
    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit('ai_arena:season_info', {
        buff: this.currentSeason.buff ? {
          id: this.currentSeason.buff.id,
          name: this.currentSeason.buff.name,
          description: this.currentSeason.buff.description,
        } : null,
        week: this.currentSeason.week,
        tournament: this.tournament ? {
          status: this.tournament.status,
          round: this.tournament.currentRound,
          totalRounds: this.tournament.totalRounds,
          remaining: this.tournament.remaining,
        } : null,
      });
    }
  }

  // ===== PEAK TOURNAMENT =====

  _startPeakTournament() {
    if (this.tournament) return;
    const masters = Array.from(this.agents.values())
      .filter(a => a.aelo >= 2000 && a.deployed)
      .sort((a, b) => b.aelo - a.aelo)
      .slice(0, TOURNAMENT_TOP_N);

    if (masters.length < 4) {
      console.log('[Tournament] Not enough master agents (min 4)');
      return;
    }

    const bracket = this._buildBracket(masters);
    this.tournament = {
      status: 'running',
      bracket,
      currentRound: 1,
      totalRounds: Math.ceil(Math.log2(bracket.seeds.length)),
      remaining: bracket.seeds.length / 2,
      winners: [],
      history: [],
      startedAt: Date.now(),
    };

    console.log(`[Tournament] Started: ${masters.length} agents, ${this.tournament.totalRounds} rounds`);
    this.broadcast('ai_arena:tournament_start', {
      totalRounds: this.tournament.totalRounds,
      participants: masters.map(a => ({
        id: a.id, name: a.name, playerName: a.playerName, aelo: a.aelo,
      })),
    });
  }

  _buildBracket(agents) {
    const seeds = agents.map((a, i) => ({ agentId: a.id, name: a.name, seed: i + 1, score: 0 }));
    const matches = [];
    const n = seeds.length;
    for (let i = 0; i < Math.floor(n / 2); i++) {
      matches.push({ seedA: i, seedB: n - 1 - i, winner: null });
    }
    return { seeds, matches };
  }

  _tournamentTick(now) {
    const t = this.tournament;
    if (!t || t.status !== 'running') return;

    const match = t.bracket.matches.find(m => !m.winner);
    if (!match) {
      if (t.bracket.matches.every(m => m.winner !== null)) {
        this._advanceTournamentRound();
      }
      return;
    }

    const agentA = this.agents.get(t.bracket.seeds[match.seedA]?.agentId);
    const agentB = this.agents.get(t.bracket.seeds[match.seedB]?.agentId);
    if (!agentA || !agentB) { match.winner = null; return; }

    const map = AI_MAPS.ARENA_DOME;
    let winsA = 0, winsB = 0;
    for (let r = 0; r < 3 && winsA < 2 && winsB < 2; r++) {
      const subMatch = { id: `tour-${agentA.id}-${agentB.id}-r${r}`, agentA: agentA.id, agentB: agentB.id, map: map.id, startTime: now, tickCount: 0, log: [], winner: null };
      agentA.inMatch = true; agentB.inMatch = true;
      this._resetAgentForMatch(agentA); this._resetAgentForMatch(agentB);
      agentA.x = map.spawnA.x; agentA.y = map.spawnA.y;
      agentB.x = map.spawnB.x; agentB.y = map.spawnB.y;
      this.simulateMatch(subMatch, agentA, agentB, map);
      if (!agentA.alive) winsB++;
      else if (!agentB.alive) winsA++;
      else { const pa = agentA.hp / agentA.maxHp, pb = agentB.hp / agentB.maxHp; if (pa > pb) winsA++; else winsB++; }
      agentA.inMatch = false; agentB.inMatch = false;
    }

    match.winner = winsA > winsB ? match.seedA : match.seedB;
    const winner = match.winner === match.seedA ? agentA : agentB;
    const loser = match.winner === match.seedA ? agentB : agentA;
    t.winners.push({ agentId: winner.id, name: winner.name, round: t.currentRound });
    t.history.push({ round: t.currentRound, match: `${agentA.name} vs ${agentB.name}`, winner: winner.name, score: `${winsA}-${winsB}` });

    this.broadcast('ai_arena:tournament_match', {
      round: t.currentRound, totalRounds: t.totalRounds,
      agentA: { name: agentA.name, playerName: agentA.playerName },
      agentB: { name: agentB.name, playerName: agentB.playerName },
      winner: { name: winner.name, playerName: winner.playerName },
      score: `${winsA}-${winsB}`,
      remaining: t.bracket.matches.filter(m => !m.winner).length,
    });
  }

  _advanceTournamentRound() {
    const t = this.tournament;
    t.currentRound++;
    const prevWinners = t.winners.filter(w => w.round === t.currentRound - 1);
    if (prevWinners.length <= 1) {
      t.status = 'complete';
      t.champion = prevWinners[0];
      this.broadcast('ai_arena:tournament_end', {
        champion: t.champion,
        history: t.history,
      });
      console.log(`[Tournament] Champion: ${t.champion?.name}!`);
      return;
    }
    const seeds = prevWinners.map((w, i) => ({ agentId: w.agentId, name: w.name, seed: i + 1, score: 0 }));
    const matches = [];
    for (let i = 0; i < seeds.length / 2; i++) {
      matches.push({ seedA: i, seedB: seeds.length - 1 - i, winner: null });
    }
    t.bracket = { seeds, matches };
    t.remaining = seeds.length / 2;
    t.winners = t.winners.filter(w => w.round !== t.currentRound - 1);
    console.log(`[Tournament] Round ${t.currentRound}: ${seeds.length} agents left`);
    this.broadcast('ai_arena:tournament_round', { round: t.currentRound, totalRounds: t.totalRounds, remaining: seeds.length });
  }

  _resetAgentForMatch(agent) {
    agent.hp = agent.maxHp; agent.alive = true;
    agent.shield = 0; agent.shieldActive = false;
    agent.buffs = []; agent.x = 0; agent.y = 0;
    for (const skill of agent.skills) skill.lastUsed = 0;
  }

  sendTournamentState(playerId) {
    const socket = this.playerSockets.get(playerId);
    if (!socket) return;
    const t = this.tournament;
    if (!t) { socket.emit('ai_arena:tournament_state', { status: 'none' }); return; }
    socket.emit('ai_arena:tournament_state', {
      status: t.status, round: t.currentRound, totalRounds: t.totalRounds,
      history: t.history, champion: t.champion,
    });
  }

  broadcast(event, data) {
    this.io.emit(event, data);
  }

  sendLeaderboard(playerId) {
    const board = this.getLeaderboard(20);
    const socket = this.playerSockets.get(playerId);
    if (socket) socket.emit('ai_arena:leaderboard', { entries: board });
  }

  // --- Admin / Query Methods ---

  getAgentsByPlayer(playerId) {
    const agentIds = this.playerAgents.get(playerId) || [];
    return agentIds.map(id => this.agents.get(id)).filter(a => a);
  }

  getActiveAgent(playerId) {
    const agents = this.getAgentsByPlayer(playerId);
    return agents.find(a => a.deployed) || null;
  }

  getLeaderboard(limit = 20) {
    const sorted = Array.from(this.agents.values())
      .sort((a, b) => b.aelo - a.aelo)
      .slice(0, limit);
    return sorted.map(a => ({
      name: a.name,
      playerName: a.playerName,
      aelo: a.aelo,
      wins: a.wins,
      losses: a.losses,
      level: a.level.stars,
      specialBehavior: a.specialBehavior,
    }));
  }

  getLeagueDistribution() {
    const leagues = { bronze: 0, silver: 0, gold: 0, master: 0 };
    for (const [, agent] of this.agents) {
      const league = this.getLeague(agent.aelo);
      leagues[league.id]++;
    }
    return leagues;
  }
}

module.exports = AIArenaManager;
