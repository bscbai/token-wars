const {
  SKILLS, calcDamage, DEATH_DROP_RATE, RARITY_CONFIG,
  COMBAT_TRIANGLE, COMBOS, BASIC_AMMO,
  MAP_WIDTH, MAP_HEIGHT, TILE,
} = require('../../shared/constants');
const { EVENTS } = require('../../shared/protocol');

// Default lobby walkability — mirrors world-player's lobbyMap (border walls,
// open interior). Used for knockback validation when no dungeon map applies.
const lobbyMap = [];
for (let y = 0; y < MAP_HEIGHT; y++) {
  lobbyMap[y] = [];
  for (let x = 0; x < MAP_WIDTH; x++) {
    lobbyMap[y][x] = (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1)
      ? TILE.WALL
      : TILE.FLOOR;
  }
}

class CombatSystem {
  constructor(io, store) {
    this.io = io;
    this.store = store;
    this.projectiles = new Map(); // id -> projectile
    this.playerSockets = new Map(); // playerId -> socket
  }

  registerSocket(playerId, socket) {
    this.playerSockets.set(playerId, socket);
  }

  unregisterSocket(playerId) {
    this.playerSockets.delete(playerId);
  }

  // Validate and execute a skill
  useSkill(player, skillIndex, targetX, targetY, entities, mapData) {
    const skill = player.skills[skillIndex];
    if (!skill) return { success: false, reason: 'invalid_skill' };

    const now = Date.now();

    // Cooldown check
    if (now - skill.lastUsed < skill.cooldown) {
      return { success: false, reason: 'on_cooldown' };
    }

    // Combo detection (pure read — the key is committed only after the skill
    // executes successfully, so a whiffed attack can't feed a combo).
    const combo = this.detectCombo(player, skillIndex, now);

    // Ammo payment (basic ammo first, GDD §2.2). The counter combo
    // (E→Q→Q) makes the triggering attack entirely free.
    let damageMult = 1;
    if (skill.tokenCost > 0 && !(combo && combo.id === 'counter_combo')) {
      const payment = this.payTokenCost(player, skill.tokenCost);
      if (!payment) return { success: false, reason: 'insufficient_tokens' };
      damageMult = payment.damageMult;
    }

    // Set cooldown
    skill.lastUsed = now;
    player.lastCombatAt = now;

    let result;
    switch (skill.type) {
      case 'melee': {
        const critBonus = (combo && combo.id === 'dodge_counter') ? COMBOS.DODGE_CRIT_BONUS : 0;
        result = this.executeMelee(player, skill, targetX, targetY, entities, damageMult, critBonus);
        break;
      }
      case 'movement':
        result = this.executeDodge(player, skill, targetX, targetY);
        break;
      case 'shield': {
        const durationMult = (combo && combo.id === 'perfect_defense') ? 2 : 1;
        result = this.executeShield(player, skill, durationMult);
        break;
      }
      case 'aoe': {
        const comboMult = (combo && combo.id === 'charged_burst') ? 1 + COMBOS.AOE_DAMAGE_BONUS : 1;
        result = this.executeAoe(player, skill, entities, mapData, damageMult, comboMult);
        break;
      }
      default:
        result = { success: false, reason: 'unknown_skill_type' };
    }

    if (result.success) {
      this.commitCombo(player, skillIndex, now, combo);
      // Blast shield (R→E→Q): on completion the active shield's absorb doubles.
      if (combo && combo.id === 'blast_shield' && player.shieldActive) {
        player.shield *= 2;
        this.broadcastToPlayers(entities, EVENTS.COMBAT_SHIELD, {
          playerId: player.id,
          active: true,
          absorbRemaining: player.shield,
        });
      }
    }

    return result;
  }

  // Pay a token cost from basic ammo first, then unstable tokens (GDD §2.2).
  // Returns { basic, unstable, damageMult } or null if the player can't pay.
  payTokenCost(player, cost) {
    const basic = Math.min(player.basicAmmo || 0, cost);
    const unstable = cost - basic;
    if (player.unstableTokens < unstable) return null;
    player.basicAmmo -= basic;
    player.unstableTokens -= unstable;
    // Ammo pools are persisted state; batch via the dirty set (hot path).
    this.store.markDirty(player);
    return { basic, unstable, damageMult: basic > 0 ? BASIC_AMMO.DAMAGE_MULT : 1 };
  }

  // Detect whether pressing `key` at `now` completes a combo recipe.
  // Pure read — does not mutate the sequence (see commitCombo).
  detectCombo(player, key, now) {
    const active = (player.comboSeq || []).filter(e => now - e.at <= COMBOS.WINDOW_MS);
    const keys = active.map(e => e.key).concat(key);
    for (const recipe of COMBOS.RECIPES) {
      const seq = recipe.seq;
      if (seq.length > keys.length) continue;
      const tail = keys.slice(-seq.length);
      if (!seq.every((k, i) => k === tail[i])) continue;
      // Dodge counter has a tighter 1s window between W and Q (GDD §4.4).
      if (recipe.id === 'dodge_counter') {
        const dodgeEntry = active[active.length - 1];
        if (!dodgeEntry || now - dodgeEntry.at > COMBOS.DODGE_CRIT_WINDOW_MS) continue;
      }
      return recipe;
    }
    return null;
  }

  // Commit a successfully executed skill key to the combo sequence; when a
  // recipe triggered, notify the player and reset the sequence.
  commitCombo(player, key, now, triggered) {
    player.comboSeq = (player.comboSeq || []).filter(e => now - e.at <= COMBOS.WINDOW_MS);
    player.comboSeq.push({ key, at: now });
    if (player.comboSeq.length > 4) player.comboSeq.shift();
    if (triggered) {
      player.comboSeq = [];
      const socket = this.playerSockets.get(player.id);
      if (socket) {
        socket.emit(EVENTS.COMBAT_COMBO, { comboId: triggered.id, name: triggered.name });
      }
    }
  }

  executeMelee(player, skill, targetX, targetY, entities, damageMult = 1, critBonus = 0) {
    // Find entity at target position
    const target = this.findEntityAt(targetX, targetY, entities, player.id);
    if (!target) return { success: false, reason: 'no_target' };

    // Check range
    const dist = Math.abs(player.x - target.x) + Math.abs(player.y - target.y);
    if (dist > skill.range) return { success: false, reason: 'out_of_range' };

    // Calculate damage (crit → basic-ammo penalty, all floored, min 1)
    const isCrit = Math.random() < 0.1 + critBonus;
    let damage = calcDamage(player.atk, skill.multiplier, target.def || 0);
    if (isCrit) damage = Math.floor(damage * 1.5);
    damage = Math.max(Math.floor(damage * damageMult), 1);

    // Combat triangle: Q counters E — melee pierces an active shield at 50%
    // damage, straight to HP, without depleting the shield value (GDD §4.1).
    let penetrated = false;
    if (target.shieldActive && target.shield > 0) {
      penetrated = true;
      damage = Math.max(Math.floor(damage * COMBAT_TRIANGLE.MELEE_VS_SHIELD_MULT), 1);
    }

    // Apply damage
    const alive = target.takeDamage ? target.takeDamage(damage, player.id) : true;

    // Broadcast hit
    this.broadcastToPlayers(entities, EVENTS.COMBAT_HIT, {
      attackerId: player.id,
      targetId: target.id,
      damage,
      skillId: skill.id,
      isCrit,
      penetrated,
    });

    // Check death
    if (!alive) {
      this.handleEntityDeath(target, player, entities);
    }

    // Update player state
    this.syncPlayer(player);

    return { success: true, damage, killed: !alive, isCrit };
  }

  executeDodge(player, skill, targetX, targetY) {
    // Move player 3 tiles in the direction they're facing (toward target)
    const dx = Math.sign(targetX - player.x);
    const dy = Math.sign(targetY - player.y);

    let newX = player.x + dx * skill.range;
    let newY = player.y + dy * skill.range;

    // Clamp to map bounds
    newX = Math.max(1, Math.min(28, newX));
    newY = Math.max(1, Math.min(28, newY));

    player.x = newX;
    player.y = newY;

    // Brief invulnerability
    player.buffs.push({
      name: 'dodge_invuln',
      atkMult: 1,
      defMult: 999, // effectively invulnerable
      expiresAt: Date.now() + skill.invulnDuration,
    });

    return { success: true, newX, newY };
  }

  executeShield(player, skill, durationMult = 1) {
    player.shieldActive = true;
    player.shield = skill.absorbAmount;
    player.shieldExpiresAt = Date.now() + (skill.duration || 4000) * durationMult;
    player.lastShieldDrainAt = Date.now(); // drain starts fresh on raise

    this.broadcastToPlayers(null, EVENTS.COMBAT_SHIELD, {
      playerId: player.id,
      active: true,
      absorbRemaining: player.shield,
    });

    return { success: true, absorb: skill.absorbAmount };
  }

  executeAoe(player, skill, entities, mapData, damageMult = 1, comboMult = 1) {
    const results = [];
    const radius = skill.aoeRadius;

    for (const [, entity] of entities) {
      if (entity.id === player.id) continue;
      if (!entity.alive) continue;

      const dist = Math.abs(player.x - entity.x) + Math.abs(player.y - entity.y);
      if (dist <= radius) {
        const isCrit = Math.random() < 0.1;
        let damage = calcDamage(player.atk, skill.multiplier, entity.def || 0);
        if (isCrit) damage = Math.floor(damage * 1.5);
        damage = Math.max(Math.floor(damage * damageMult * comboMult), 1);

        // Combat triangle: E counters R — an active shield fully absorbs the
        // AOE hit (no HP loss; shield value spent up to the hit size, GDD §4.1).
        if (entity.shieldActive && entity.shield > 0) {
          const absorbed = Math.min(damage, entity.shield);
          entity.shield -= absorbed;
          if (entity.shield <= 0) {
            entity.shieldActive = false;
            entity.shield = 0;
            this.broadcastToPlayers(entities, EVENTS.COMBAT_SHIELD, {
              playerId: entity.id,
              active: false,
              absorbRemaining: 0,
            });
          }
          this.broadcastToPlayers(entities, EVENTS.COMBAT_HIT, {
            attackerId: player.id,
            targetId: entity.id,
            damage: 0,
            absorbed,
            skillId: skill.id,
            isCrit,
          });
          results.push({ targetId: entity.id, damage: 0, absorbed, killed: false });
          continue;
        }

        const alive = entity.takeDamage ? entity.takeDamage(damage, player.id) : true;

        // Combat triangle: R counters Q — the burst interrupts the target's
        // basic attack (full cooldown) and knocks it back 1 tile (GDD §4.1).
        if (entity.username && entity.alive) {
          if (Array.isArray(entity.skills) && entity.skills[0]) {
            entity.skills[0].lastUsed = Date.now(); // interrupt
          }
          const kx = Math.sign(entity.x - player.x);
          const ky = Math.sign(entity.y - player.y);
          const nx = entity.x + kx * COMBAT_TRIANGLE.KNOCKBACK_TILES;
          const ny = entity.y + ky * COMBAT_TRIANGLE.KNOCKBACK_TILES;
          if ((kx !== 0 || ky !== 0) && this.isWalkable(nx, ny, mapData)) {
            entity.x = nx;
            entity.y = ny;
            this.broadcastToPlayers(entities, EVENTS.COMBAT_KNOCKBACK, {
              attackerId: player.id,
              targetId: entity.id,
              x: nx,
              y: ny,
            });
          }
        }

        this.broadcastToPlayers(entities, EVENTS.COMBAT_HIT, {
          attackerId: player.id,
          targetId: entity.id,
          damage,
          skillId: skill.id,
          isCrit,
        });

        if (!alive) {
          this.handleEntityDeath(entity, player, entities);
        }

        results.push({ targetId: entity.id, damage, killed: !alive });
      }
    }

    this.syncPlayer(player);
    return { success: true, hits: results };
  }

  // Walkability check for knockback — bounds + wall tiles. Falls back to the
  // lobby layout (border walls) when no combat-context map applies.
  isWalkable(x, y, mapData) {
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
    const map = mapData || lobbyMap;
    if (!map || !map[y]) return false;
    return map[y][x] !== TILE.WALL;
  }

  findEntityAt(x, y, entities, excludeId) {
    for (const [, entity] of entities) {
      if (entity.id === excludeId) continue;
      if (entity.x === x && entity.y === y && entity.alive) return entity;
    }
    return null;
  }

  handleEntityDeath(entity, killer, entities) {
    // Broadcast death
    this.broadcastToPlayers(entities, EVENTS.COMBAT_DEATH, {
      entityId: entity.id,
      killerId: killer.id,
    });

    // If it's a monster, drop loot
    if (entity.lootTable) {
      const loot = this.rollLoot(entity.lootTable, killer);
      this.applyLoot(killer, loot);
    }

    // If it's a player, handle PvP death
    if (entity.username) {
      this.handlePlayerDeath(entity, killer);
    }
  }

  rollLoot(lootTable, killer) {
    const loot = { unstable: 0, stable: [], xp: 0 };

    // Unstable tokens
    const [min, max] = lootTable.unstable;
    loot.unstable = Math.floor(Math.random() * (max - min + 1)) + min;

    // Stable token chance
    if (Math.random() < lootTable.stableChance) {
      const rarity = lootTable.stableRarity || 'common';
      loot.stable.push({ rarity });
    }

    // XP (from monster template)
    loot.xp = lootTable.xpReward || 0;

    return loot;
  }

  applyLoot(player, loot) {
    if (loot.unstable > 0) {
      player.addUnstableTokens(loot.unstable);
    }
    for (const stableToken of loot.stable) {
      player.addStableToken(stableToken.rarity);
    }
    if (loot.xp > 0) {
      player.addXp(loot.xp);
    }
    // Transaction point: monster loot drop (+ any level-up it triggered).
    this.store.persist(player);
    this.syncPlayer(player);
  }

  handlePlayerDeath(deadPlayer, killer) {
    // Drop 30-50% of carried stable tokens
    const dropRate = DEATH_DROP_RATE.min + Math.random() * (DEATH_DROP_RATE.max - DEATH_DROP_RATE.min);
    const dropCount = Math.floor(deadPlayer.stableTokens.length * dropRate);
    const dropped = [];

    // Shuffle and pick
    const shuffled = [...deadPlayer.stableTokens].sort(() => Math.random() - 0.5);
    for (let i = 0; i < dropCount; i++) {
      dropped.push(shuffled[i]);
    }
    deadPlayer.stableTokens = deadPlayer.stableTokens.filter(t => !dropped.includes(t));

    // Transaction point: death drop is a loss event — persist it immediately so
    // a crash can't "undo" the penalty (or duplicate the dropped tokens).
    this.store.persist(deadPlayer);

    // Unstable tokens are NOT dropped (they're ammo)

    const socket = this.playerSockets.get(deadPlayer.id);
    if (socket) {
      socket.emit(EVENTS.PLAYER_DEAD, {
        droppedTokens: dropped,
        respawnMs: 5000,
      });
    }

    // Respawn after 5 seconds
    setTimeout(() => {
      deadPlayer.hp = deadPlayer.maxHp;
      deadPlayer.alive = true;
      deadPlayer.shield = 0;
      deadPlayer.shieldActive = false;
      deadPlayer.buffs = [];
      // Reset cooldowns
      for (const skill of deadPlayer.skills) {
        skill.lastUsed = 0;
      }
      deadPlayer.coprocessorLastUsed = 0;
      if (socket) {
        socket.emit(EVENTS.PLAYER_RESPAWN, { x: 15, y: 28 });
      }
    }, 5000);
  }

  // Damage a player (from monsters, hazards, etc.)
  damagePlayer(player, damage, sourceId, entities) {
    // Check shield
    if (player.shieldActive && player.shield > 0) {
      const absorbed = Math.min(damage, player.shield);
      player.shield -= absorbed;
      damage -= absorbed;
      if (player.shield <= 0) {
        player.shieldActive = false;
        this.broadcastToPlayers(entities, EVENTS.COMBAT_SHIELD, {
          playerId: player.id,
          active: false,
          absorbRemaining: 0,
        });
      }
    }

    // Check invulnerability buffs
    for (const buff of player.buffs) {
      if (buff.name === 'dodge_invuln' && Date.now() < buff.expiresAt) {
        return 0; // immune
      }
    }

    player.hp -= damage;
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      this.handleEntityDeath(player, { id: sourceId, username: null }, entities);
    }

    this.syncPlayer(player);
    return damage;
  }

  syncPlayer(player) {
    const socket = this.playerSockets.get(player.id);
    if (socket) {
      socket.emit(EVENTS.PLAYER_UPDATE, player.serialize());
    }
  }

  broadcastToPlayers(entities, event, data) {
    if (entities) {
      for (const [, entity] of entities) {
        if (entity.username) { // it's a player
          const socket = this.playerSockets.get(entity.id);
          if (socket) socket.emit(event, data);
        }
      }
    } else {
      // Broadcast to all
      this.io.emit(event, data);
    }
  }

  // Per-player maintenance, driven by the combat plugin's ctx.every(10)
  // (every 10 ticks = 500ms). Replaces the retired GameEngine branch:
  // buff cleanup, shield expiry/drain, basic-ammo regen, combo-effect expiry.
  tickPlayer(player, now) {
    this.cleanupBuffs(player);

    if (player.shieldActive) {
      // Duration expiry (GDD §4.4 combos extend it)
      if (player.shieldExpiresAt && now >= player.shieldExpiresAt) {
        this.deactivateShield(player, null);
      } else if (now - (player.lastShieldDrainAt || 0) >= 1000) {
        // Drain exactly 1 ammo/sec, paid from basic ammo first (GDD §4.3).
        player.lastShieldDrainAt = now;
        if (!this.payTokenCost(player, 1)) {
          this.deactivateShield(player, null); // out of ammo — shield collapses
        }
      }
    }

    // Basic ammo regen: 1 round per 30s out of combat, capped (GDD §2.2).
    if ((player.basicAmmo || 0) < BASIC_AMMO.MAX) {
      const since = Math.max(player.lastCombatAt || 0, player.lastAmmoRegenAt || 0);
      if (now - since >= BASIC_AMMO.REGEN_MS) {
        player.basicAmmo = (player.basicAmmo || 0) + 1;
        player.lastAmmoRegenAt = now;
        this.store.markDirty(player);
      }
    }

    // Expire combo bonuses (dodge counter crit window)
    if (player.comboEffects && player.comboEffects.dodgeCrit &&
        now > player.comboEffects.dodgeCrit) {
      delete player.comboEffects.dodgeCrit;
    }
  }

  deactivateShield(player, entities) {
    player.shieldActive = false;
    player.shield = 0;
    player.shieldExpiresAt = 0;
    this.broadcastToPlayers(entities, EVENTS.COMBAT_SHIELD, {
      playerId: player.id,
      active: false,
      absorbRemaining: 0,
    });
  }

  // Clean up expired buffs
  cleanupBuffs(player) {
    const now = Date.now();
    player.buffs = player.buffs.filter(b => now < b.expiresAt);
  }
}

module.exports = CombatSystem;
