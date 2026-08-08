const { MINING, RARITY } = require('../../shared/constants');
const { EVENTS } = require('../../shared/protocol');
const guard = require('../middleware/eventGuard');

class MiningManager {
  constructor(io, store) {
    this.io = io;
    this.store = store;
    this.playerSockets = new Map(); // playerId -> socket
  }

  registerSocket(playerId, socket) {
    this.playerSockets.set(playerId, socket);

    // Send initial mining state
    const player = this.store.getPlayerById(playerId);
    if (player) {
      this.syncMiningState(player, socket);
    }

    // Collect handler
    guard.on(socket, EVENTS.MINING_COLLECT, null, () => {
      this.collect(playerId);
    }, 'economy');

    // Upgrade handler
    guard.on(socket, EVENTS.MINING_UPGRADE, null, () => {
      this.upgrade(playerId);
    }, 'economy');
  }

  unregisterSocket(playerId) {
    this.playerSockets.delete(playerId);
  }

  // Called every server tick (or periodically)
  tick(now) {
    for (const [playerId, player] of this.store.players) {
      const config = MINING.LEVELS[player.miningLevel - 1];
      if (!config) continue;

      const elapsed = now - player.lastMiningCollect;
      const tokensToAdd = Math.floor(elapsed / config.rate);

      if (tokensToAdd > 0 && player.pendingMiningTokens < config.capacity) {
        const actual = Math.min(tokensToAdd, config.capacity - player.pendingMiningTokens);
        player.pendingMiningTokens += actual;
        player.lastMiningCollect += actual * config.rate;
        // Accrual is low-stakes: mark dirty and let autosave batch it.
        this.store.markDirty(player);

        // Sync to client if connected
        const socket = this.playerSockets.get(playerId);
        if (socket) {
          this.syncMiningState(player, socket);
        }
      }
    }
  }

  collect(playerId) {
    const player = this.store.getPlayerById(playerId);
    if (!player) return;

    const amount = player.pendingMiningTokens;
    if (amount <= 0) {
      const socket = this.playerSockets.get(playerId);
      if (socket) socket.emit(EVENTS.ERROR, { message: '没有可收集的Token', code: 'MINING_EMPTY' });
      return;
    }

    player.pendingMiningTokens = 0;
    player.lastMiningCollect = Date.now();
    player.addUnstableTokens(amount);

    // Transaction point: pending tokens were zeroed, the payout must not vanish.
    this.store.persist(player);

    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit(EVENTS.MINING_COLLECTED, { amount, tokenType: 'unstable' });
      this.syncMiningState(player, socket);
      socket.emit(EVENTS.PLAYER_UPDATE, player.serialize());
    }
  }

  upgrade(playerId) {
    const player = this.store.getPlayerById(playerId);
    if (!player) return;

    const currentLevel = player.miningLevel;
    if (currentLevel >= MINING.LEVELS.length) {
      const socket = this.playerSockets.get(playerId);
      if (socket) socket.emit(EVENTS.ERROR, { message: '已达到最高等级', code: 'MAX_LEVEL' });
      return;
    }

    const nextConfig = MINING.LEVELS[currentLevel]; // 0-indexed, current level index
    const costRarity = nextConfig.costRarity || RARITY.COMMON;

    // Check if player has enough tokens of the required rarity
    const matchingTokens = player.stableTokens.filter(t => t.rarity === costRarity);
    if (matchingTokens.length < nextConfig.cost) {
      const socket = this.playerSockets.get(playerId);
      if (socket) socket.emit(EVENTS.ERROR, { message: 'Token不足', code: 'INSUFFICIENT_TOKENS' });
      return;
    }

    // Consume tokens
    let remaining = nextConfig.cost;
    player.stableTokens = player.stableTokens.filter(t => {
      if (remaining <= 0) return true;
      if (t.rarity === costRarity) {
        remaining--;
        return false;
      }
      return true;
    });

    // Apply upgrade
    player.miningLevel = currentLevel + 1;

    // Transaction point: stable tokens were consumed to buy the upgrade.
    this.store.persist(player);

    const socket = this.playerSockets.get(playerId);
    if (socket) {
      socket.emit(EVENTS.MINING_UPGRADED, {
        newLevel: player.miningLevel,
        newRate: MINING.LEVELS[player.miningLevel - 1].rate,
      });
      this.syncMiningState(player, socket);
      socket.emit(EVENTS.PLAYER_UPDATE, player.serialize());
    }
  }

  syncMiningState(player, socket) {
    const config = MINING.LEVELS[player.miningLevel - 1];
    socket.emit(EVENTS.MINING_UPDATE, {
      pendingTokens: player.pendingMiningTokens,
      miningLevel: player.miningLevel,
      capacity: config.capacity,
      rateMs: config.rate,
    });
  }

  // Calculate offline mining on login
  calculateOfflineMining(player) {
    const config = MINING.LEVELS[player.miningLevel - 1];
    if (!config) return 0;

    const now = Date.now();
    const elapsed = now - player.lastMiningCollect;
    const maxOffline = MINING.OFFLINE_CAP_HOURS * 3600 * 1000;
    const cappedElapsed = Math.min(elapsed, maxOffline);
    const tokensToAdd = Math.floor(cappedElapsed / config.rate);

    const actual = Math.min(tokensToAdd, config.capacity - player.pendingMiningTokens);
    player.pendingMiningTokens += actual;
    player.lastMiningCollect = now;
    if (actual > 0) this.store.markDirty(player);

    return actual;
  }
}

module.exports = MiningManager;
