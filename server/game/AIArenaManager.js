const crypto = require('crypto');
const { EVENTS, AI_ARENA } = require('../../shared/constants');
const AIAgent = require('../models/AIAgent');

class AIArenaManager {
  constructor(io) {
    this.io = io;
    this.agents = new Map();        // agentId → AIAgent
    this.matchQueue = [];           // agent IDs waiting to match
    this.activeMatches = new Map(); // matchId → match state
    this.seasonBuffs = [];          // current season buffs
    this.currentSeason = null;
    this.tournamentParticipants = [];
    this.tournamentBracket = null;
    this.tournamentActive = false;
    this.leaderboard = [];
    this.dailyRewards = new Map();  // playerId → last claim timestamp
    this.matchLogs = new Map();     // matchId → detailed log frames
    this.seasonStartTime = Date.now();
    this.matchCounters = new Map(); // playerId → matches today
    this._seasonTimer = null;
    this._tournamentTimer = null;

    // Cleanup configuration
    this.MAX_MATCH_LOGS = 100;       // Keep only last 100 match replays
    this.MAX_AGENT_IDLE_MS = 3600000; // Remove agents idle > 1 hour
    this.CLEANUP_INTERVAL_MS = 300000; // Run cleanup every 5 minutes

    this._initSeason();
    this._initTournamentTimer();
    this._initCleanupTimer();
  }

  // ─── Memory cleanup ──────────────────────────────────────────────────

  _initCleanupTimer() {
    this._cleanupTimer = setInterval(() => {
      this._cleanupStaleData();
    }, this.CLEANUP_INTERVAL_MS);
  }

  _cleanupStaleData() {
    const now = Date.now();

    // 1. Trim matchLogs to MAX_MATCH_LOGS (keep most recent)
    if (this.matchLogs.size > this.MAX_MATCH_LOGS) {
      const sortedIds = [...this.matchLogs.entries()]
        .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
        .map((e) => e[0]);
      const toRemove = sortedIds.slice(this.MAX_MATCH_LOGS);
      for (const id of toRemove) {
        this.matchLogs.delete(id);
      }
    }

    // 2. Remove idle agents (not deployed, no recent match, older than threshold)
    let agentsRemoved = 0;
    for (const [agentId, agent] of this.agents) {
      if (agent.deployed) continue;
      const lastActivity = agent.matchHistory.length > 0
        ? agent.matchHistory[agent.matchHistory.length - 1].timestamp
        : agent.createdAt;
      if (now - lastActivity > this.MAX_AGENT_IDLE_MS) {
        this.agents.delete(agentId);
        agentsRemoved++;
      }
    }

    // 3. Clean stale activeMatches (finished matches older than 10 min)
    for (const [matchId, match] of this.activeMatches) {
      if (match.finished && now - (match.timestamp || now) > 600000) {
        this.activeMatches.delete(matchId);
      }
    }

    if (agentsRemoved > 0) {
      console.log(`[AIArena] Cleanup: removed ${agentsRemoved} idle agents, matchLogs: ${this.matchLogs.size}`);
    }
  }

  // ─── Agent helpers ──────────────────────────────────────────────────

  _getAgent(agentId) {
    return this.agents.get(agentId);
  }

  _getPlayerAgents(ownerId) {
    const result = [];
    for (const agent of this.agents.values()) {
      if (agent.ownerId === ownerId) result.push(agent);
    }
    return result;
  }

  _createAgent(ownerId, name) {
    const agent = new AIAgent(ownerId, name);
    this.agents.set(agent.id, agent);
    return agent;
  }

  _generateUUID() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ─── Leaderboard ────────────────────────────────────────────────────

  _updateLeaderboard() {
    const entries = [];
    for (const agent of this.agents.values()) {
      entries.push({
        agentId: agent.id,
        ownerId: agent.ownerId,
        name: agent.name,
        stars: agent.stars,
        aeloRating: agent.aeloRating,
        wins: agent.wins,
        losses: agent.losses,
        draws: agent.draws,
        winRate: agent.getWinRate(),
        totalMatches: agent.getMatchCount(),
        specialBehavior: agent.specialBehavior,
      });
    }
    entries.sort((a, b) => b.aeloRating - a.aeloRating);
    this.leaderboard = entries;
    return entries;
  }

  // ─── Match queue ────────────────────────────────────────────────────

  _addToQueue(agentId) {
    if (this.matchQueue.includes(agentId)) return;
    this.matchQueue.push(agentId);
    this._tryMatch();
  }

  _removeFromQueue(agentId) {
    const idx = this.matchQueue.indexOf(agentId);
    if (idx !== -1) this.matchQueue.splice(idx, 1);
  }

  _tryMatch() {
    while (this.matchQueue.length >= 2) {
      const id1 = this.matchQueue.shift();
      const id2 = this.matchQueue.shift();

      const agent1 = this._getAgent(id1);
      const agent2 = this._getAgent(id2);

      if (!agent1 || !agent2) {
        if (agent1) this.matchQueue.unshift(id1);
        if (agent2) this.matchQueue.unshift(id2);
        break;
      }

      this._runMatch(id1, id2);
    }
  }

  // ─── Match simulation ───────────────────────────────────────────────

  _runMatch(agentId1, agentId2) {
    const agent1 = this._getAgent(agentId1);
    const agent2 = this._getAgent(agentId2);
    if (!agent1 || !agent2) return;

    // Build teams: each side gets agent + 2 filler agents
    const team1 = this._buildTeam(agent1, 'blue');
    const team2 = this._buildTeam(agent2, 'red');

    // Pick random map
    const map = AI_ARENA.MAPS[Math.floor(Math.random() * AI_ARENA.MAPS.length)];

    const matchId = 'match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    // Signal match start
    this.io.to(agent1.ownerId).emit(EVENTS.AI_ARENA_MATCH_START, {
      matchId,
      opponent: agent2.toJSON(),
      map: { id: map.id, name: map.name, grid: map.grid },
      team: 'blue',
    });
    this.io.to(agent2.ownerId).emit(EVENTS.AI_ARENA_MATCH_START, {
      matchId,
      opponent: agent1.toJSON(),
      map: { id: map.id, name: map.name, grid: map.grid },
      team: 'red',
    });

    // Initialize match state
    const logFrames = [];
    const state = {
      matchId,
      map,
      teams: { blue: team1, red: team2 },
      turn: 0,
      finished: false,
      winner: null,
    };

    team1.forEach((a, i) => a.initMatchState('blue', i));
    team2.forEach((a, i) => a.initMatchState('red', i));

    const allAgents = [...team1, ...team2];

    // Set initial positions based on map grid
    const gridW = map.grid[0];
    const gridH = map.grid[1];
    team1.forEach((a, i) => {
      a._x = 1;
      a._y = Math.min(i + 1, gridH - 1);
    });
    team2.forEach((a, i) => {
      a._x = gridW - 2;
      a._y = Math.min(i + 1, gridH - 1);
    });

    // Token spawn points on map
    const tokenSpawns = this._generateTokenSpawns(gridW, gridH);

    // Run turns
    for (let turn = 0; turn < AI_ARENA.MATCH.TURN_COUNT; turn++) {
      if (this._isTeamEliminated(team1) || this._isTeamEliminated(team2)) {
        break;
      }

      const frame = {
        turn,
        agents: [],
        tokens: tokenSpawns.map((t) => ({ x: t.x, y: t.y, collected: t.collected, tokens: t.tokens })),
        events: [],
        score: { blue: 0, red: 0 },
      };

      // Process each alive agent in random order per turn
      const turnOrder = [...allAgents].filter((a) => a.isAlive());
      this._shuffle(turnOrder);

      for (const agent of turnOrder) {
        if (!agent.isAlive()) continue;

        agent._hasBlockedThisTurn = false;

        const decision = this._decideAction(agent, allAgents, tokenSpawns, map);
        const actionResult = this._executeAction(agent, decision, allAgents, tokenSpawns, map, state);
        frame.events.push(actionResult);
      }

      // Collect agent states for this frame
      for (const agent of allAgents) {
        frame.agents.push({
          id: agent.id,
          team: agent._team,
          x: agent._x,
          y: agent._y,
          hp: Math.max(0, Math.round(agent._hp)),
          maxHp: agent._maxHp,
          alive: agent.isAlive(),
          tokensCollected: agent._tokensCollected,
          damageDealt: Math.round(agent._damageDealt * 100) / 100,
        });
      }

      // Calculate scores
      frame.score.blue = team1.reduce((sum, a) => sum + (a._damageDealt || 0) + (a._tokensCollected || 0), 0);
      frame.score.red = team2.reduce((sum, a) => sum + (a._damageDealt || 0) + (a._tokensCollected || 0), 0);

      logFrames.push(frame);
      state.turn = turn + 1;
    }

    // Determine winner
    let winner = null;
    let winnerOwner = null;
    const blueAlive = team1.filter((a) => a.isAlive()).length;
    const redAlive = team2.filter((a) => a.isAlive()).length;

    if (blueAlive > redAlive) {
      winner = agent1;
      winnerOwner = agent1.ownerId;
    } else if (redAlive > blueAlive) {
      winner = agent2;
      winnerOwner = agent2.ownerId;
    } else {
      // Tie - compare scores
      const lastFrame = logFrames[logFrames.length - 1];
      if (lastFrame && lastFrame.score.blue > lastFrame.score.red) {
        winner = agent1;
        winnerOwner = agent1.ownerId;
      } else if (lastFrame && lastFrame.score.red > lastFrame.score.blue) {
        winner = agent2;
        winnerOwner = agent2.ownerId;
      }
    }

    state.finished = true;
    state.winner = winnerOwner;

    // AELO rating calculation
    const expected1 = 1 / (1 + Math.pow(10, (agent2.aeloRating - agent1.aeloRating) / 400));
    const expected2 = 1 - expected1;

    let result1, result2, ratingChange1, ratingChange2;

    if (winnerOwner === agent1.ownerId) {
      result1 = 'win';
      result2 = 'loss';
      ratingChange1 = Math.round(AI_ARENA.K_FACTOR * (1 - expected1));
      ratingChange2 = Math.round(AI_ARENA.K_FACTOR * (0 - expected2));
    } else if (winnerOwner === agent2.ownerId) {
      result1 = 'loss';
      result2 = 'win';
      ratingChange1 = Math.round(AI_ARENA.K_FACTOR * (0 - expected1));
      ratingChange2 = Math.round(AI_ARENA.K_FACTOR * (1 - expected2));
    } else {
      result1 = 'draw';
      result2 = 'draw';
      ratingChange1 = Math.round(AI_ARENA.K_FACTOR * (0.5 - expected1));
      ratingChange2 = Math.round(AI_ARENA.K_FACTOR * (0.5 - expected2));
    }

    // Record results
    agent1.recordMatch(result1, ratingChange1);
    agent2.recordMatch(result2, ratingChange2);

    // Grant exp
    const expWin = AI_ARENA.TRAINING.EXP_PER_MATCH + AI_ARENA.TRAINING.EXP_WIN_BONUS;
    const expLoss = AI_ARENA.TRAINING.EXP_PER_MATCH;
    agent1.addExp(result1 === 'win' ? expWin : expLoss);
    agent2.addExp(result2 === 'win' ? expWin : expLoss);

    // Store match log
    this.matchLogs.set(matchId, {
      matchId,
      agent1Id: agent1.id,
      agent2Id: agent2.id,
      map: map.id,
      logs: logFrames,
      winner: winnerOwner,
      timestamp: Date.now(),
    });

    // Update match counters
    this._incrementMatchCount(agent1.ownerId);
    this._incrementMatchCount(agent2.ownerId);

    // Update leaderboard
    this._updateLeaderboard();

    // Emit match end
    const matchEndData1 = {
      matchId,
      result: result1,
      ratingChange: ratingChange1,
      newRating: agent1.aeloRating,
      summary: {
        agentsTeam1: team1.map((a) => ({ id: a.id, hp: a._hp, alive: a.isAlive(), damageDealt: Math.round(a._damageDealt) })),
        agentsTeam2: team2.map((a) => ({ id: a.id, hp: a._hp, alive: a.isAlive(), damageDealt: Math.round(a._damageDealt) })),
        map: map.id,
        turns: logFrames.length,
      },
    };

    const matchEndData2 = {
      matchId,
      result: result2,
      ratingChange: ratingChange2,
      newRating: agent2.aeloRating,
      summary: {
        agentsTeam1: team1.map((a) => ({ id: a.id, hp: a._hp, alive: a.isAlive(), damageDealt: Math.round(a._damageDealt) })),
        agentsTeam2: team2.map((a) => ({ id: a.id, hp: a._hp, alive: a.isAlive(), damageDealt: Math.round(a._damageDealt) })),
        map: map.id,
        turns: logFrames.length,
      },
    };

    this.io.to(agent1.ownerId).emit(EVENTS.AI_ARENA_MATCH_END, matchEndData1);
    this.io.to(agent2.ownerId).emit(EVENTS.AI_ARENA_MATCH_END, matchEndData2);

    this.activeMatches.set(matchId, state);
    state.timestamp = Date.now();

    // Check tournament if active
    if (this.tournamentActive) {
      this._checkTournamentProgress(matchId);
    }
  }

  // ─── Decision tree ──────────────────────────────────────────────────

  _decideAction(agent, allAgents, tokenSpawns, map) {
    const enemies = allAgents.filter((a) => a._team !== agent._team && a.isAlive());
    const allies = allAgents.filter((a) => a._team === agent._team && a.id !== agent.id && a.isAlive());

    // Spawn season buff tokens
    this._applySeasonTokenSpawns(tokenSpawns, map);

    // Priority 1: seek_lowest_hp — target enemy with lowest HP
    if (enemies.length > 0) {
      const lowestHpEnemy = enemies.reduce((lowest, e) => (e._hp < lowest._hp ? e : lowest), enemies[0]);
      if (lowestHpEnemy._hp < 30 && this._inRange(agent, lowestHpEnemy)) {
        return { type: 'seek_lowest_hp', targetId: lowestHpEnemy.id, x: lowestHpEnemy._x, y: lowestHpEnemy._y };
      }
    }

    // Priority 2: seek_nearest_enemy
    if (enemies.length > 0) {
      const nearest = this._findNearest(agent, enemies);
      if (nearest && this._distance(agent, nearest) < 5) {
        return { type: 'seek_nearest_enemy', targetId: nearest.id, x: nearest._x, y: nearest._y };
      }
    }

    // Priority 3: flee_when_low_hp (HP < 30%)
    if (agent._hp < agent._maxHp * 0.3 && enemies.length > 0) {
      const nearestEnemy = this._findNearest(agent, enemies);
      if (nearestEnemy) {
        // Move away from nearest enemy
        const fleeX = agent._x + (agent._x - nearestEnemy._x) * 0.5;
        const fleeY = agent._y + (agent._y - nearestEnemy._y) * 0.5;
        return {
          type: 'flee_when_low_hp',
          x: this._clamp(fleeX, 0, map.grid[0] - 1),
          y: this._clamp(fleeY, 0, map.grid[1] - 1),
        };
      }
    }

    // Priority 4: collect_nearest_token
    const availableTokens = tokenSpawns.filter((t) => !t.collected);
    if (availableTokens.length > 0) {
      const nearestToken = this._findNearest(agent, availableTokens);
      if (nearestToken && this._distance(agent, nearestToken) <= 1) {
        return { type: 'collect_nearest_token', tokenIndex: tokenSpawns.indexOf(nearestToken) };
      }
      if (nearestToken) {
        return { type: 'collect_nearest_token', x: nearestToken.x, y: nearestToken.y, tokenIndex: tokenSpawns.indexOf(nearestToken) };
      }
    }

    // Priority 5: patrol_center
    const centerX = map.grid[0] / 2;
    const centerY = map.grid[1] / 2;
    if (this._distanceTo(agent, centerX, centerY) > 2) {
      return { type: 'patrol_center', x: centerX, y: centerY };
    }

    // Priority 6: defensive_formation
    if (allies.length > 0) {
      const nearestAlly = this._findNearest(agent, allies);
      if (nearestAlly && this._distance(agent, nearestAlly) > 3) {
        return {
          type: 'defensive_formation',
          x: nearestAlly._x + (Math.random() - 0.5) * 2,
          y: nearestAlly._y + (Math.random() - 0.5) * 2,
        };
      }
    }

    // Priority 7: aggressive_pursue
    if (enemies.length > 0) {
      const target = enemies[Math.floor(Math.random() * enemies.length)];
      return { type: 'aggressive_pursue', targetId: target.id, x: target._x, y: target._y };
    }

    // Priority 8: random_wander
    const wx = this._clamp(agent._x + (Math.random() - 0.5) * 4, 0, map.grid[0] - 1);
    const wy = this._clamp(agent._y + (Math.random() - 0.5) * 4, 0, map.grid[1] - 1);
    return { type: 'random_wander', x: wx, y: wy };
  }

  _executeAction(agent, decision, allAgents, tokenSpawns, map, state) {
    const mapMod = map.modifiers || {};
    const seasonMod = this._getSeasonMods();
    const weights = agent.getWeights();

    const event = {
      agentId: agent.id,
      action: decision.type,
      details: {},
    };

    switch (decision.type) {
      case 'seek_lowest_hp':
      case 'seek_nearest_enemy':
      case 'aggressive_pursue': {
        // Move toward target
        if (decision.x !== undefined && decision.y !== undefined) {
          agent._x = this._clamp(this._moveToward(agent._x, decision.x, 1 + (weights.percentages.mobility || 0) / 100), 0, map.grid[0] - 1);
          agent._y = this._clamp(this._moveToward(agent._y, decision.y, 1 + (weights.percentages.mobility || 0) / 100), 0, map.grid[1] - 1);
        }

        // Attack if in range of target
        if (decision.targetId) {
          const target = allAgents.find((a) => a.id === decision.targetId);
          if (target && target.isAlive() && this._inRange(agent, target)) {
            let baseDmg = 10 + (weights.attack / 5) * (mapMod.attack || 1) * (seasonMod.attack || 1);
            const damage = agent.dealDamage(baseDmg);
            const result = target.takeDamage(damage, agent.id);
            event.details = {
              attackTarget: target.id,
              damage: Math.round(damage * 100) / 100,
              targetDied: result.died,
              dodged: result.dodged,
              blocked: result.blocked,
            };
          }
        }
        break;
      }

      case 'flee_when_low_hp': {
        if (decision.x !== undefined && decision.y !== undefined) {
          const speedMult = 1.5 * (seasonMod.mobility || 1);
          agent._x = this._clamp(this._moveToward(agent._x, decision.x, speedMult), 0, map.grid[0] - 1);
          agent._y = this._clamp(this._moveToward(agent._y, decision.y, speedMult), 0, map.grid[1] - 1);
          event.details = { fledToX: Math.round(agent._x), fledToY: Math.round(agent._y) };
        }
        break;
      }

      case 'collect_nearest_token': {
        if (decision.tokenIndex !== undefined && decision.tokenIndex < tokenSpawns.length) {
          const token = tokenSpawns[decision.tokenIndex];
          if (!token.collected) {
            // Move toward
            if (decision.x !== undefined && decision.y !== undefined) {
              const econSpeed = 1 + (weights.percentages.economy || 0) / 100;
              agent._x = this._clamp(this._moveToward(agent._x, decision.x, econSpeed), 0, map.grid[0] - 1);
              agent._y = this._clamp(this._moveToward(agent._y, decision.y, econSpeed), 0, map.grid[1] - 1);
            }

            // Collect if adjacent
            if (this._distanceTo(agent, token.x, token.y) <= 1.5) {
              const ecoMod = (mapMod.economy || 1) * (seasonMod.economy || 1);
              const tokens = agent.collectTokens(Math.floor(token.tokens * ecoMod));
              token.collected = true;
              token.collectedBy = agent.id;
              event.details = { collectedTokens: tokens, tokenSpawnId: decision.tokenIndex };
            }
          }
        }
        break;
      }

      case 'patrol_center':
      case 'random_wander': {
        if (decision.x !== undefined && decision.y !== undefined) {
          const patrolSpeed = 1 + (weights.percentages.mobility || 0) / 200;
          agent._x = this._clamp(this._moveToward(agent._x, decision.x, patrolSpeed), 0, map.grid[0] - 1);
          agent._y = this._clamp(this._moveToward(agent._y, decision.y, patrolSpeed), 0, map.grid[1] - 1);
          event.details = { movedToX: Math.round(agent._x * 100) / 100, movedToY: Math.round(agent._y * 100) / 100 };
        }
        break;
      }

      case 'defensive_formation': {
        if (decision.x !== undefined && decision.y !== undefined) {
          const defSpeed = 0.8;
          agent._x = this._clamp(this._moveToward(agent._x, decision.x, defSpeed), 0, map.grid[0] - 1);
          agent._y = this._clamp(this._moveToward(agent._y, decision.y, defSpeed), 0, map.grid[1] - 1);
          event.details = { formationX: Math.round(decision.x), formationY: Math.round(decision.y) };
        }
        // Defense bonus in formation
        if (agent._hp < agent._maxHp) {
          const defHeal = weights.defense * 0.02;
          agent._hp = Math.min(agent._maxHp, agent._hp + defHeal);
          event.details.healFromDefense = Math.round(defHeal * 100) / 100;
        }
        break;
      }
    }

    return event;
  }

  // ─── Season system ──────────────────────────────────────────────────

  _initSeason() {
    const buff = AI_ARENA.SEASON.SEASON_BUFFS[0];
    this.seasonBuffs = [buff];
    this.currentSeason = {
      id: buff.id,
      name: buff.name,
      desc: buff.desc,
      mod: buff.mod,
      startedAt: Date.now(),
      endsAt: Date.now() + AI_ARENA.SEASON.DURATION_DAYS * 86400000,
    };

    this._seasonTimer = setTimeout(() => {
      this.rotateSeason();
    }, AI_ARENA.SEASON.DURATION_DAYS * 86400000);
  }

  rotateSeason() {
    if (this._seasonTimer) clearTimeout(this._seasonTimer);

    const currentIdx = AI_ARENA.SEASON.SEASON_BUFFS.findIndex((b) => b.id === this.currentSeason?.id);
    const nextIdx = (currentIdx + 1) % AI_ARENA.SEASON.SEASON_BUFFS.length;
    const nextBuff = AI_ARENA.SEASON.SEASON_BUFFS[nextIdx];

    this.seasonBuffs = [nextBuff];
    this.currentSeason = {
      id: nextBuff.id,
      name: nextBuff.name,
      desc: nextBuff.desc,
      mod: nextBuff.mod,
      startedAt: Date.now(),
      endsAt: Date.now() + AI_ARENA.SEASON.DURATION_DAYS * 86400000,
    };

    // Reset daily match counters
    this.matchCounters.clear();

    // Broadcast season change
    this.io.emit(EVENTS.AI_ARENA_BROADCAST, {
      type: 'season_change',
      season: this.currentSeason,
    });

    // Schedule next rotation
    this._seasonTimer = setTimeout(() => {
      this.rotateSeason();
    }, AI_ARENA.SEASON.DURATION_DAYS * 86400000);
  }

  _getSeasonMods() {
    if (this.seasonBuffs.length === 0) return {};
    const mod = {};
    for (const buff of this.seasonBuffs) {
      if (buff.mod) Object.assign(mod, buff.mod);
    }
    return mod;
  }

  getSeasonInfo() {
    return {
      current: this.currentSeason,
      timeRemaining: Math.max(0, (this.currentSeason?.endsAt || 0) - Date.now()),
    };
  }

  // ─── Tournament system ──────────────────────────────────────────────

  _initTournamentTimer() {
    // Tournament runs every 12 hours
    this._tournamentTimer = setInterval(() => {
      this._startTournament();
    }, 12 * 3600000);
  }

  _startTournament() {
    if (this.tournamentActive) return;

    const leaderboard = this._updateLeaderboard();
    const topN = leaderboard.slice(0, AI_ARENA.TOURNAMENT.TOP_N);
    if (topN.length < 4) return; // Need at least 4 participants

    this.tournamentParticipants = topN.map((e) => e.agentId);
    this.tournamentBracket = this._buildBracket(topN.map((e) => e.agentId));
    this.tournamentActive = true;

    this.io.emit(EVENTS.AI_ARENA_BROADCAST, {
      type: 'tournament_start',
      participants: topN.length,
      bracket: this._formatBracketForClient(this.tournamentBracket),
    });

    // Start first round after a delay
    setTimeout(() => {
      this._runTournamentRound(0);
    }, 30000);
  }

  _buildBracket(participantIds) {
    const bracket = [];
    for (let i = 0; i < participantIds.length; i += 2) {
      bracket.push({
        matchId: 'tourney_' + i + '_' + Date.now(),
        agent1: participantIds[i],
        agent2: participantIds[i + 1] || null,
        agent1Wins: 0,
        agent2Wins: 0,
        winner: null,
        round: 0,
        completed: false,
      });
    }
    return bracket;
  }

  _runTournamentRound(roundIndex) {
    if (!this.tournamentActive) return;

    const bracket = this.tournamentBracket;
    const currentRoundMatches = bracket.filter((m) => m.round === roundIndex && !m.completed);

    for (const match of currentRoundMatches) {
      if (!match.agent1 || !match.agent2) {
        // Bye - auto advance
        match.winner = match.agent1 || match.agent2;
        match.completed = true;
        this._advanceInBracket(match, roundIndex);
        continue;
      }

      const agent1 = this._getAgent(match.agent1);
      const agent2 = this._getAgent(match.agent2);

      if (!agent1 || !agent2) {
        match.winner = agent1 ? match.agent1 : match.agent2;
        match.completed = true;
        this._advanceInBracket(match, roundIndex);
        continue;
      }

      // Best of 3 per round
      let wins1 = 0;
      let wins2 = 0;

      for (let game = 0; game < AI_ARENA.TOURNAMENT.ROUNDS_PER_MATCH && wins1 < 2 && wins2 < 2; game++) {
        const map = AI_ARENA.MAPS[Math.floor(Math.random() * AI_ARENA.MAPS.length)];
        const team1 = this._buildTeam(agent1, 'blue');
        const team2 = this._buildTeam(agent2, 'red');
        const result = this._simulateQuickGame(team1, team2, map);

        if (result.winner === 'blue') {
          wins1++;
          match.agent1Wins = wins1;
        } else if (result.winner === 'red') {
          wins2++;
          match.agent2Wins = wins2;
        } else {
          // Tiebreaker
          if (result.score.blue > result.score.red) {
            wins1++;
            match.agent1Wins = wins1;
          } else if (result.score.red > result.score.blue) {
            wins2++;
            match.agent2Wins = wins2;
          }
        }
      }

      match.winner = wins1 >= 2 ? match.agent1 : match.agent2;
      match.completed = true;

      this.io.emit(EVENTS.AI_ARENA_TOURNAMENT_UPDATE, {
        matchId: match.matchId,
        winner: match.winner,
        score: [match.agent1Wins, match.agent2Wins],
        round: roundIndex,
      });

      this._advanceInBracket(match, roundIndex);
    }

    // Check if tournament is complete
    const champion = this._getChampion();
    if (champion) {
      this.tournamentActive = false;
      const champAgent = this._getAgent(champion);
      this.io.emit(EVENTS.AI_ARENA_BROADCAST, {
        type: 'tournament_champion',
        champion: champAgent ? champAgent.toJSON() : null,
      });
    } else {
      // Schedule next round after delay
      const nextRound = roundIndex + 1;
      setTimeout(() => {
        this._runTournamentRound(nextRound);
      }, 20000);
    }
  }

  _advanceInBracket(match, currentRound) {
    if (!match.winner) return;

    // Add to next round
    const nextRound = currentRound + 1;
    const nextMatchIdx = Math.floor(
      this.tournamentBracket.filter((m) => m.round === currentRound).indexOf(match) / 2
    );

    const nextRoundMatches = this.tournamentBracket.filter((m) => m.round === nextRound);
    let targetMatch = nextRoundMatches[nextMatchIdx];

    if (!targetMatch) {
      targetMatch = {
        matchId: 'tourney_next_' + nextRound + '_' + nextMatchIdx + '_' + Date.now(),
        agent1: null,
        agent2: null,
        agent1Wins: 0,
        agent2Wins: 0,
        winner: null,
        round: nextRound,
        completed: false,
      };
      this.tournamentBracket.push(targetMatch);
    }

    if (targetMatch.agent1 === null) {
      targetMatch.agent1 = match.winner;
    } else {
      targetMatch.agent2 = match.winner;
    }
  }

  _getChampion() {
    const incomplete = this.tournamentBracket.some((m) => !m.completed);
    if (incomplete) return null;

    // Find the final match winner
    const lastRound = Math.max(...this.tournamentBracket.map((m) => m.round));
    const finalMatch = this.tournamentBracket.find((m) => m.round === lastRound);
    return finalMatch ? finalMatch.winner : null;
  }

  _formatBracketForClient(bracket) {
    return bracket.map((m) => ({
      matchId: m.matchId,
      agent1: m.agent1 ? this._getAgent(m.agent1)?.name : 'BYE',
      agent2: m.agent2 ? this._getAgent(m.agent2)?.name : 'BYE',
      agent1Wins: m.agent1Wins,
      agent2Wins: m.agent2Wins,
      winner: m.winner,
      round: m.round,
      completed: m.completed,
    }));
  }

  _checkTournamentProgress(matchId) {
    // Update tournament state if match is part of active tournament
    if (!this.tournamentActive) return;
    // Regular matches don't directly affect tournament, tournament uses its own sim
  }

  // ─── Daily rewards ──────────────────────────────────────────────────

  claimDailyReward(playerId) {
    const now = Date.now();
    const lastClaim = this.dailyRewards.get(playerId) || 0;

    if (now - lastClaim < AI_ARENA.TOURNAMENT.DAILY_REWARD_COOLDOWN) {
      return {
        success: false,
        reason: 'cooldown',
        nextAvailable: lastClaim + AI_ARENA.TOURNAMENT.DAILY_REWARD_COOLDOWN,
      };
    }

    // Generate random token
    const roll = Math.random();
    let rarity, valueRange;

    if (roll < 0.1) {
      rarity = 'epic';
      valueRange = [25, 40];
    } else if (roll < 0.35) {
      rarity = 'rare';
      valueRange = [18, 28];
    } else if (roll < 0.75) {
      rarity = 'uncommon';
      valueRange = [12, 20];
    } else {
      rarity = 'common';
      valueRange = [5, 12];
    }

    const categories = AI_ARENA.CATEGORIES;
    const category = categories[Math.floor(Math.random() * categories.length)];
    const value = Math.floor(Math.random() * (valueRange[1] - valueRange[0] + 1)) + valueRange[0];

    const token = {
      id: 'reward_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      category,
      rarity,
      value,
      name: `${rarity}_${category}_token`,
    };

    this.dailyRewards.set(playerId, now);

    return {
      success: true,
      token,
      cooldownMs: AI_ARENA.TOURNAMENT.DAILY_REWARD_COOLDOWN,
    };
  }

  // ─── Socket event registration ──────────────────────────────────────

  /**
   * Register AI Arena socket handlers on an existing socket.
   * Called from the main io.on('connection') handler in server/index.js
   * to avoid duplicate connection listeners.
   */
  handleConnection(socket, playerId) {
      // Match queue: join or leave
      socket.on(EVENTS.AI_ARENA_MATCH_QUEUE, (data) => {
        if (!data || !data.agentId) {
          socket.emit(EVENTS.AI_ARENA_MATCH_QUEUE, { queued: false, reason: 'no_agent_id' });
          return;
        }
        const agent = this._getAgent(data.agentId);
        if (!agent || agent.ownerId !== playerId) {
          socket.emit(EVENTS.AI_ARENA_MATCH_QUEUE, { queued: false, reason: 'agent_not_found' });
          return;
        }
        agent.deployed = true;
        this._addToQueue(agent.id);
        socket.emit(EVENTS.AI_ARENA_MATCH_QUEUE, { queued: true, queueLength: this.matchQueue.length });
      });

      // Deploy agent to arena
      socket.on(EVENTS.AI_ARENA_DEPLOY, (data) => {
        let agent = this._getPlayerAgents(playerId).find((a) => a.id === data.agentId);

        if (!agent) {
          agent = this._createAgent(playerId, data.name || 'Agent');
        }

        if (data.tokens && Array.isArray(data.tokens)) {
          for (const token of data.tokens) {
            agent.addToken(token);
          }
        }

        agent.deployed = true;
        this._addToQueue(agent.id);

        socket.emit(EVENTS.AI_ARENA_DEPLOY, {
          success: true,
          agent: agent.toJSON(),
          queueLength: this.matchQueue.length,
        });
      });

      // Recall agent from arena
      socket.on(EVENTS.AI_ARENA_RECALL, (data) => {
        const agents = this._getPlayerAgents(playerId);
        const agent = agents.find((a) => a.id === data.agentId);
        if (!agent) {
          socket.emit(EVENTS.AI_ARENA_RECALL, { success: false, reason: 'agent_not_found' });
          return;
        }

        this._removeFromQueue(agent.id);
        agent.deployed = false;

        socket.emit(EVENTS.AI_ARENA_RECALL, {
          success: true,
          agentId: agent.id,
        });
      });

      // Get player's agents
      socket.on(EVENTS.AI_ARENA_AGENT_LIST, () => {
        const agents = this._getPlayerAgents(playerId);
        socket.emit(EVENTS.AI_ARENA_AGENT_LIST, {
          agents: agents.map((a) => a.toJSON()),
        });
      });

      // Train agent
      socket.on(EVENTS.AI_ARENA_TRAIN, (data) => {
        const agents = this._getPlayerAgents(playerId);
        const agent = agents.find((a) => a.id === data.agentId);
        if (!agent) {
          socket.emit(EVENTS.AI_ARENA_TRAIN, { success: false, reason: 'agent_not_found' });
          return;
        }

        const expAmount = data.amount || 10;
        const result = agent.addExp(expAmount);

        socket.emit(EVENTS.AI_ARENA_TRAIN, {
          success: true,
          agentId: agent.id,
          stars: result.stars,
          exp: result.exp,
          leveledUp: result.stars > (data.previousStars || 1),
        });
      });

      // Set special behavior (requires star 3)
      socket.on(EVENTS.AI_ARENA_SPECIAL, (data) => {
        const agents = this._getPlayerAgents(playerId);
        const agent = agents.find((a) => a.id === data.agentId);
        if (!agent) {
          socket.emit(EVENTS.AI_ARENA_SPECIAL, { success: false, reason: 'agent_not_found' });
          return;
        }

        const result = agent.setSpecialBehavior(data.behaviorId);
        socket.emit(EVENTS.AI_ARENA_SPECIAL, {
          ...result,
          agent: agent.toJSON(),
        });
      });

      // Rename agent
      socket.on(EVENTS.AI_ARENA_NAME, (data) => {
        const agents = this._getPlayerAgents(playerId);
        const agent = agents.find((a) => a.id === data.agentId);
        if (!agent) {
          socket.emit(EVENTS.AI_ARENA_NAME, { success: false, reason: 'agent_not_found' });
          return;
        }

        const oldName = agent.name;
        agent.name = data.name || agent.name;

        socket.emit(EVENTS.AI_ARENA_NAME, {
          success: true,
          agentId: agent.id,
          oldName,
          newName: agent.name,
        });
      });

      // Get match history
      socket.on(EVENTS.AI_ARENA_HISTORY, (data) => {
        const agents = this._getPlayerAgents(playerId);
        const agent = agents.find((a) => a.id === data.agentId);
        if (!agent) {
          socket.emit(EVENTS.AI_ARENA_HISTORY, { success: false, reason: 'agent_not_found' });
          return;
        }

        socket.emit(EVENTS.AI_ARENA_HISTORY, {
          success: true,
          agentId: agent.id,
          history: agent.matchHistory,
          stats: {
            wins: agent.wins,
            losses: agent.losses,
            draws: agent.draws,
            winRate: agent.getWinRate(),
            streak: agent.streak,
            totalMatches: agent.getMatchCount(),
          },
        });
      });

      // Get match replay
      socket.on(EVENTS.AI_ARENA_REPLAY, (data) => {
        const log = this.matchLogs.get(data.matchId);
        if (!log) {
          socket.emit(EVENTS.AI_ARENA_REPLAY, { success: false, reason: 'match_not_found' });
          return;
        }

        socket.emit(EVENTS.AI_ARENA_REPLAY, {
          success: true,
          replay: log,
        });
      });

      // Get leaderboard
      socket.on(EVENTS.AI_ARENA_LEADERBOARD, () => {
        const lb = this._updateLeaderboard();
        socket.emit(EVENTS.AI_ARENA_LEADERBOARD, {
          leaderboard: lb,
          totalAgents: this.agents.size,
          lastUpdated: Date.now(),
        });
      });

      // Get season info
      socket.on(EVENTS.AI_ARENA_SEASON_INFO, () => {
        socket.emit(EVENTS.AI_ARENA_SEASON_INFO, this.getSeasonInfo());
      });

      // Get tournament info
      socket.on(EVENTS.AI_ARENA_TOURNAMENT_INFO, () => {
        socket.emit(EVENTS.AI_ARENA_TOURNAMENT_INFO, {
          active: this.tournamentActive,
          participants: this.tournamentParticipants.length,
          bracket: this.tournamentBracket ? this._formatBracketForClient(this.tournamentBracket) : null,
        });
      });

      // Daily reward
      socket.on(EVENTS.AI_ARENA_DAILY_REWARD, () => {
        const result = this.claimDailyReward(playerId);
        socket.emit(EVENTS.AI_ARENA_DAILY_REWARD, result);
      });
  }

  // ─── Utility methods ────────────────────────────────────────────────

  _buildTeam(ownerAgent, teamColor) {
    const team = [ownerAgent];

    // Find filler agents from same owner or create simple bots
    const ownerAgents = this._getPlayerAgents(ownerAgent.ownerId).filter(
      (a) => a.id !== ownerAgent.id && a.deployed
    );

    while (team.length < AI_ARENA.MATCH.AGENTS_PER_SIDE) {
      if (ownerAgents.length > 0 && team.length - 1 < ownerAgents.length) {
        team.push(ownerAgents[team.length - 1]);
      } else {
        // Create a filler bot
        const bot = new AIAgent(ownerAgent.ownerId, 'Bot_' + (team.length));
        bot._isBot = true;
        // Give bot some baseline tokens
        bot.addToken({ category: 'attack', rarity: 'common', value: 5, name: 'bot_attack' });
        bot.addToken({ category: 'defense', rarity: 'common', value: 5, name: 'bot_defense' });
        bot.addToken({ category: 'mobility', rarity: 'common', value: 3, name: 'bot_mobility' });
        team.push(bot);
      }
    }

    return team.slice(0, AI_ARENA.MATCH.AGENTS_PER_SIDE);
  }

  _generateTokenSpawns(gridW, gridH) {
    const spawns = [];
    const count = 4 + Math.floor(Math.random() * 3); // 4-6 token spawns
    for (let i = 0; i < count; i++) {
      spawns.push({
        x: 1 + Math.floor(Math.random() * (gridW - 2)),
        y: 1 + Math.floor(Math.random() * (gridH - 2)),
        tokens: 5 + Math.floor(Math.random() * 20), // 5-25 tokens
        collected: false,
        collectedBy: null,
      });
    }
    return spawns;
  }

  _applySeasonTokenSpawns(tokenSpawns, map) {
    // Season buffs can add bonus token spawns
    const seasonMods = this._getSeasonMods();
    if (seasonMods.economy && Math.random() < 0.1) {
      tokenSpawns.push({
        x: 1 + Math.floor(Math.random() * (map.grid[0] - 2)),
        y: 1 + Math.floor(Math.random() * (map.grid[1] - 2)),
        tokens: 10,
        collected: false,
        collectedBy: null,
        seasonBonus: true,
      });
    }
  }

  _isTeamEliminated(team) {
    return team.every((a) => !a.isAlive());
  }

  _inRange(a, b) {
    return this._distance(a, b) <= 2;
  }

  _distance(a, b) {
    const dx = (a._x || 0) - (b.x || b._x || 0);
    const dy = (a._y || 0) - (b.y || b._y || 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  _distanceTo(a, x, y) {
    const dx = (a._x || 0) - x;
    const dy = (a._y || 0) - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _findNearest(agent, targets) {
    let nearest = null;
    let minDist = Infinity;
    for (const t of targets) {
      const d = this._distance(agent, t);
      if (d < minDist) {
        minDist = d;
        nearest = t;
      }
    }
    return nearest;
  }

  _moveToward(current, target, speed) {
    if (current < target) return Math.min(current + speed, target);
    if (current > target) return Math.max(current - speed, target);
    return current;
  }

  _clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  _incrementMatchCount(playerId) {
    const current = this.matchCounters.get(playerId) || 0;
    this.matchCounters.set(playerId, current + 1);
  }

  _simulateQuickGame(team1, team2, map) {
    const allAgents = [...team1, ...team2];
    const gridW = map.grid[0];
    const gridH = map.grid[1];

    team1.forEach((a, i) => {
      a.initMatchState('blue', i);
      a._x = 1;
      a._y = Math.min(i + 1, gridH - 1);
    });
    team2.forEach((a, i) => {
      a.initMatchState('red', i);
      a._x = gridW - 2;
      a._y = Math.min(i + 1, gridH - 1);
    });

    const tokenSpawns = this._generateTokenSpawns(gridW, gridH);
    const mapMod = map.modifiers || {};
    const seasonMod = this._getSeasonMods();

    for (let turn = 0; turn < AI_ARENA.MATCH.TURN_COUNT; turn++) {
      if (this._isTeamEliminated(team1) || this._isTeamEliminated(team2)) break;

      const turnOrder = [...allAgents].filter((a) => a.isAlive());
      this._shuffle(turnOrder);

      for (const agent of turnOrder) {
        if (!agent.isAlive()) continue;
        agent._hasBlockedThisTurn = false;
        const decision = this._decideAction(agent, allAgents, tokenSpawns, map);
        this._executeAction(agent, decision, allAgents, tokenSpawns, map, { map });
      }
    }

    const blueAlive = team1.filter((a) => a.isAlive()).length;
    const redAlive = team2.filter((a) => a.isAlive()).length;
    const scoreBlue = team1.reduce((s, a) => s + (a._damageDealt || 0) + (a._tokensCollected || 0), 0);
    const scoreRed = team2.reduce((s, a) => s + (a._damageDealt || 0) + (a._tokensCollected || 0), 0);

    let winner = 'draw';
    if (blueAlive > redAlive) winner = 'blue';
    else if (redAlive > blueAlive) winner = 'red';
    else if (scoreBlue > scoreRed) winner = 'blue';
    else if (scoreRed > scoreBlue) winner = 'red';

    return { winner, score: { blue: scoreBlue, red: scoreRed } };
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  destroy() {
    if (this._seasonTimer) clearTimeout(this._seasonTimer);
    if (this._tournamentTimer) clearInterval(this._tournamentTimer);
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
  }
}

// Factory function
function createAIArenaManager(io) {
  return new AIArenaManager(io);
}

module.exports = AIArenaManager;
module.exports.createAIArenaManager = createAIArenaManager;
