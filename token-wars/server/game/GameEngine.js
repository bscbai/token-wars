const { TICK_RATE, TICK_MS } = require('../../shared/constants');

class GameEngine {
  constructor(io, store, combatSystem, pveManager, miningManager, worldBossManager, aiArenaManager) {
    this.io = io;
    this.store = store;
    this.combat = combatSystem;
    this.pve = pveManager;
    this.mining = miningManager;
    this.worldBoss = worldBossManager;
    this.aiArena = aiArenaManager;
    this.running = false;
    this.tickCount = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTick = Date.now();

    this.interval = setInterval(() => {
      this.tick();
    }, TICK_MS);

    console.log(`[GameEngine] Started at ${TICK_RATE} Hz`);
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    console.log('[GameEngine] Stopped');
  }

  tick() {
    const now = Date.now();
    this.tickCount++;

    // Mining tick (every 1 second = 20 ticks)
    if (this.tickCount % TICK_RATE === 0) {
      this.mining.tick(now);
    }

    // World boss tick (every 5 seconds)
    if (this.tickCount % (TICK_RATE * 5) === 0 && this.worldBoss) {
      this.worldBoss.tick(now);
    }

    // AI Arena tick (every 5 seconds)
    if (this.tickCount % (TICK_RATE * 5) === 0 && this.aiArena) {
      this.aiArena.tick(now);
    }

    // PvE dungeons have their own loops (managed by PvEManager)
    // PvP arenas have their own loops (managed by PvPManager)

    // Clean up player buffs (every 10 ticks)
    if (this.tickCount % 10 === 0) {
      for (const [, player] of this.store.players) {
        if (player.alive) {
          this.combat.cleanupBuffs(player);
          this.combat.processShieldDrain(player);
        }
      }
    }

    this.lastTick = now;
  }
}

module.exports = GameEngine;
