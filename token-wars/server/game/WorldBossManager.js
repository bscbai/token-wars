const { Monster } = require('../models/Monster');
const { EVENTS } = require('../../shared/protocol');
const { MAP_WIDTH, MAP_HEIGHT, TILE } = require('../../shared/constants');
const guard = require('../middleware/eventGuard');

const WORLD_BOSS_CONFIG = {
  spawnInterval: 2 * 60 * 60 * 1000, // 2 hours
  announceTime: 5 * 60 * 1000, // 5 min warning
  fightDuration: 15 * 60 * 1000, // 15 min fight
  bossTemplate: 'boss_cache_controller',
  spawnX: 15,
  spawnY: 8,
  levelWeightFactor: 0.05, // per level below average
};

class WorldBossManager {
  constructor(io, store, combatSystem) {
    this.io = io;
    this.store = store;
    this.combat = combatSystem;
    this.playerSockets = new Map();
    this.boss = null;
    this.contributions = new Map(); // playerId -> {damage, healing, events}
    this.participants = new Map(); // playerId -> player ref
    this.state = 'idle'; // idle, announced, active, ended
    this.nextSpawnTime = Date.now() + WORLD_BOSS_CONFIG.spawnInterval;
    this.fightStartTime = 0;
    this.dataCaches = [];
  }

  registerSocket(playerId, socket) {
    this.playerSockets.set(playerId, socket);

    guard.on(socket, EVENTS.WORLD_BOSS_JOIN, null, () => {
      this.joinBoss(playerId);
    }, 'economy');
  }

  unregisterSocket(playerId) {
    this.playerSockets.delete(playerId);
  }

  tick(now) {
    // Check spawn timing
    if (this.state === 'idle' && now >= this.nextSpawnTime - WORLD_BOSS_CONFIG.announceTime) {
      this.announceBoss();
    }

    if (this.state === 'announced' && now >= this.nextSpawnTime) {
      this.spawnBoss();
    }

    if (this.state === 'active') {
      this.bossFightTick(now);

      // Check fight timeout
      if (now - this.fightStartTime >= WORLD_BOSS_CONFIG.fightDuration) {
        this.endBossFight('timeout');
      }
    }
  }

  announceBoss() {
    this.state = 'announced';
    this.io.emit(EVENTS.WORLD_BOSS_ANNOUNCE, {
      bossName: '缓存控制器',
      location: { x: WORLD_BOSS_CONFIG.spawnX, y: WORLD_BOSS_CONFIG.spawnY },
      timeLeft: WORLD_BOSS_CONFIG.announceTime,
    });
    console.log('[WorldBoss] Announced');
  }

  spawnBoss() {
    this.state = 'active';
    this.boss = new Monster(WORLD_BOSS_CONFIG.bossTemplate, WORLD_BOSS_CONFIG.spawnX, WORLD_BOSS_CONFIG.spawnY);
    this.fightStartTime = Date.now();
    this.contributions.clear();
    this.dataCaches = [];
    console.log('[WorldBoss] Spawned');
  }

  joinBoss(playerId) {
    if (this.state !== 'active' && this.state !== 'announced') return;
    const player = this.store.getPlayerById(playerId);
    if (!player) return;

    // Check level requirement
    const unlock = player.unlock;
    if (!unlock.worldBoss) return;

    this.participants.set(playerId, player);
    this.contributions.set(playerId, { damage: 0, healing: 0, events: 0 });

    // Position player
    player.x = WORLD_BOSS_CONFIG.spawnX + Math.floor(Math.random() * 6) - 3;
    player.y = WORLD_BOSS_CONFIG.spawnY + 10 + Math.floor(Math.random() * 3);
    player.hp = player.maxHp;
    player.alive = true;

    const socket = this.playerSockets.get(playerId);
    if (socket) {
      this.combat.registerSocket(playerId, socket);
      socket.emit(EVENTS.WORLD_BOSS_UPDATE, {
        bossHp: this.boss ? this.boss.hp : 0,
        bossMaxHp: this.boss ? this.boss.maxHp : 0,
        participants: this.participants.size,
      });
    }
  }

  bossFightTick(now) {
    if (!this.boss || !this.boss.alive) {
      this.endBossFight('killed');
      return;
    }

    // Random events every 30 seconds
    const elapsed = now - this.fightStartTime;
    if (elapsed > 0 && Math.floor(elapsed / 30000) > this.dataCaches.length) {
      this.spawnDataCache();
    }

    // Boss AI: attack nearest participant
    const nearest = this.getNearestParticipant();
    if (nearest) {
      const dist = Math.abs(this.boss.x - nearest.x) + Math.abs(this.boss.y - nearest.y);
      if (dist <= 1 && now - this.boss.lastAttackTime >= this.boss.attackCooldown) {
        this.boss.lastAttackTime = now;
        const damage = Math.max(this.boss.atk - nearest.def, 1);
        this.combat.damagePlayer(nearest, damage, this.boss.id, this.participants);
      } else if (dist > 1) {
        // Move toward nearest
        const dx = Math.sign(nearest.x - this.boss.x);
        const dy = Math.sign(nearest.y - this.boss.y);
        this.boss.x += dx;
        this.boss.y += dy;
      }
    }

    // Broadcast boss state
    this.broadcastBossState();
  }

  spawnDataCache() {
    const cache = {
      x: 5 + Math.floor(Math.random() * 20),
      y: 5 + Math.floor(Math.random() * 15),
      collected: false,
    };
    this.dataCaches.push(cache);

    this.io.emit('world_boss:cache_spawn', {
      x: cache.x,
      y: cache.y,
    });
  }

  addContribution(playerId, type, value) {
    const contrib = this.contributions.get(playerId);
    if (!contrib) return;
    contrib[type] = (contrib[type] || 0) + value;

    // Check cache interaction
    const player = this.store.getPlayerById(playerId);
    if (player) {
      for (const cache of this.dataCaches) {
        if (!cache.collected && player.x === cache.x && player.y === cache.y) {
          cache.collected = true;
          contrib.events += 500;
          const socket = this.playerSockets.get(playerId);
          if (socket) socket.emit('world_boss:cache_collected', { bonus: 500 });
        }
      }
    }
  }

  endBossFight(reason) {
    this.state = 'ended';

    // Calculate rankings
    const rankings = [];
    const serverAvgLevel = this.getServerAvgLevel();

    for (const [playerId, contrib] of this.contributions) {
      const player = this.store.getPlayerById(playerId);
      if (!player) continue;

      // Level-weighted contribution
      const levelWeight = 1 + (serverAvgLevel - player.level) * WORLD_BOSS_CONFIG.levelWeightFactor;
      const rawContribution = contrib.damage + contrib.healing * 0.8 + contrib.events;
      const finalContribution = rawContribution * levelWeight;

      rankings.push({ playerId, username: player.username, contribution: finalContribution });
    }

    rankings.sort((a, b) => b.contribution - a.contribution);

    // Distribute rewards
    rankings.forEach((rank, i) => {
      const player = this.store.getPlayerById(rank.playerId);
      if (!player) return;

      const rewards = { unstable: 10 + Math.floor(i * 2), xp: 100 - i * 5 };
      if (i < 10) rewards.stableRarity = 'epic';
      else if (i < 30) rewards.stableRarity = 'rare';
      else rewards.stableRarity = 'uncommon';

      player.addUnstableTokens(rewards.unstable);
      player.addXp(rewards.xp);
      player.addStableToken(rewards.stableRarity);

      // Transaction point: world boss payout (tokens + xp/level-ups).
      this.store.persist(player);
      this.combat.syncPlayer(player);

      const socket = this.playerSockets.get(rank.playerId);
      if (socket) {
        socket.emit(EVENTS.WORLD_BOSS_END, {
          rank: i + 1,
          rewards,
          totalParticipants: rankings.length,
        });
      }
    });

    // Schedule next spawn
    this.nextSpawnTime = Date.now() + WORLD_BOSS_CONFIG.spawnInterval;
    this.boss = null;
    this.participants.clear();
    this.contributions.clear();

    console.log(`[WorldBoss] Fight ended (${reason}), ${rankings.length} participants`);
  }

  getNearestParticipant() {
    if (!this.boss) return null;
    let nearest = null;
    let nearestDist = Infinity;
    for (const [, player] of this.participants) {
      if (!player.alive) continue;
      const dist = Math.abs(this.boss.x - player.x) + Math.abs(this.boss.y - player.y);
      if (dist < nearestDist) {
        nearest = player;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  getServerAvgLevel() {
    let total = 0, count = 0;
    for (const [, player] of this.store.players) {
      total += player.level;
      count++;
    }
    return count > 0 ? total / count : 1;
  }

  broadcastBossState() {
    if (!this.boss) return;
    this.io.emit(EVENTS.WORLD_BOSS_UPDATE, {
      bossHp: this.boss.hp,
      bossMaxHp: this.boss.maxHp,
      bossX: this.boss.x,
      bossY: this.boss.y,
      participants: this.participants.size,
      timeLeft: WORLD_BOSS_CONFIG.fightDuration - (Date.now() - this.fightStartTime),
    });
  }
}

module.exports = WorldBossManager;
