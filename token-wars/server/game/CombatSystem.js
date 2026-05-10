const { SKILLS, calcDamage, DEATH_DROP_RATE, RARITY_CONFIG } = require('../../shared/constants');
const { EVENTS } = require('../../shared/protocol');

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
  useSkill(player, skillIndex, targetX, targetY, entities) {
    const skill = player.skills[skillIndex];
    if (!skill) return { success: false, reason: 'invalid_skill' };

    const now = Date.now();

    // Cooldown check
    if (now - skill.lastUsed < skill.cooldown) {
      return { success: false, reason: 'on_cooldown' };
    }

    // Token cost check
    if (skill.tokenCost > 0 && player.unstableTokens < skill.tokenCost) {
      return { success: false, reason: 'insufficient_tokens' };
    }

    // Consume tokens
    if (skill.tokenCost > 0) {
      player.unstableTokens -= skill.tokenCost;
    }

    // Set cooldown
    skill.lastUsed = now;

    // Execute skill based on type
    switch (skill.type) {
      case 'melee':
        return this.executeMelee(player, skill, targetX, targetY, entities);
      case 'movement':
        return this.executeDodge(player, skill, targetX, targetY);
      case 'shield':
        return this.executeShield(player, skill);
      case 'aoe':
        return this.executeAoe(player, skill, entities);
      default:
        return { success: false, reason: 'unknown_skill_type' };
    }
  }

  executeMelee(player, skill, targetX, targetY, entities) {
    // Find entity at target position
    const target = this.findEntityAt(targetX, targetY, entities, player.id);
    if (!target) return { success: false, reason: 'no_target' };

    // Check range
    const dist = Math.abs(player.x - target.x) + Math.abs(player.y - target.y);
    if (dist > skill.range) return { success: false, reason: 'out_of_range' };

    // Calculate damage
    const isCrit = Math.random() < 0.1;
    let damage = calcDamage(player.atk, skill.multiplier, target.def || 0);
    if (isCrit) damage = Math.floor(damage * 1.5);

    // Apply damage
    const alive = target.takeDamage ? target.takeDamage(damage, player.id) : true;

    // Broadcast hit
    this.broadcastToPlayers(entities, EVENTS.COMBAT_HIT, {
      attackerId: player.id,
      targetId: target.id,
      damage,
      skillId: skill.id,
      isCrit,
    });

    // Check death
    if (!alive) {
      this.handleEntityDeath(target, player, entities);
    }

    // Update player state
    this.syncPlayer(player);

    return { success: true, damage, killed: !alive };
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

  executeShield(player, skill) {
    player.shieldActive = true;
    player.shield = skill.absorbAmount;

    this.broadcastToPlayers(null, EVENTS.COMBAT_SHIELD, {
      playerId: player.id,
      active: true,
      absorbRemaining: player.shield,
    });

    return { success: true, absorb: skill.absorbAmount };
  }

  executeAoe(player, skill, entities) {
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

        const alive = entity.takeDamage ? entity.takeDamage(damage, player.id) : true;

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

  // Process shield drain (called per tick for active shields)
  processShieldDrain(player) {
    if (player.shieldActive) {
      const drain = 1; // 1 token per second
      if (!player.spendUnstableTokens(drain)) {
        player.shieldActive = false;
        player.shield = 0;
      }
    }
  }

  // Clean up expired buffs
  cleanupBuffs(player) {
    const now = Date.now();
    player.buffs = player.buffs.filter(b => now < b.expiresAt);
  }
}

module.exports = CombatSystem;
