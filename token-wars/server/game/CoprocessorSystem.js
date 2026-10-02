'use strict';

/**
 * CoprocessorSystem — 协处理器技能激活与效果执行（M6，GDD §3）。
 *
 * 职责：把"已装载的协处理器"（Player.activeCoprocessor，M5 的槽位）当作一个
 * 独立行动槽（第五槽），统一完成服务端权威校验（冷却 + Token 消耗）并分发到
 * 各协处理器的效果处理器。
 *
 * 复用 CombatSystem 的公开助手（findEntityAt / broadcastToPlayers /
 * payTokenCost / handleEntityDeath / syncPlayer），不重复实现战斗机制。
 * 由 combat 插件实例化并经 ctx.service('coprocessor') 提供。
 */

const {
  COPROCESSORS,
  calcDamage,
  MAP_WIDTH,
  MAP_HEIGHT,
  TILE,
} = require('../../shared/constants');
const { EVENTS } = require('../../shared/protocol');

// --- 攻击型效果调优常量（效果机制细节，不入 shared/constants）---
const CHAIN_RANGE = 3;                  // 闪电链：自主目标起，链跳的最大曼哈顿距离
const PIERCE_RANGE = 10;                // 穿透射击：射线上最大穿透距离
const SPLIT_RANGE = 5;                  // 分裂弹：弹片重定向的最大距离
const BURN_STACK_DAMAGE_MULT = 0.5;     // 每层灼烧 = 50% atk 的即时伤害
const BURN_DETONATE_STACKS = 3;         // 累计层数阈值 → 引爆
const BURN_DETONATE_DAMAGE_MULT = 2.0;  // 引爆伤害倍数（atk × 2）
const SLOW_DURATION_MS = 5000;          // slow_field 减速持续
const PORTAL_IMMUNE_MS = 500;           // 传送门防回传免疫窗口
const TOKEN_MAGNET_RADIUS_MULT = 3;     // token_magnet 每格半径授予的 unstable 数
const TOKEN_DOUBLER_WINDOW_MS = 15000;  // token_doubler 下一次掉落窗口

// coprocessor id → 处理器方法名
const EFFECT_HANDLERS = {
  // 攻击型（M6）
  lightning_surge: 'effectLightningSurge',
  piercing_shot: 'effectPiercingShot',
  split_round: 'effectSplitRound',
  burn_mark: 'effectBurnMark',
  // 防御型（M6.1）
  shield_overload: 'effectShieldOverload',
  damage_to_heal: 'effectDamageToHeal',
  rebound_barrier: 'effectReboundBarrier',
  emergency_repair: 'effectEmergencyRepair',
  // 机动型（M6.2）
  stealth_field: 'effectStealthField',
  blink: 'effectBlink',
  slow_field: 'effectSlowField',
  portal: 'effectPortal',
  // 经济型（M6.3）
  token_magnet: 'effectTokenMagnet',
  token_doubler: 'effectTokenDoubler',
  rarity_boost: 'effectRarityBoost',
  offline_boost: 'effectOfflineBoost',
};

class CoprocessorSystem {
  constructor(io, store, combat) {
    this.io = io;
    this.store = store;
    this.combat = combat;
    // 灼烧累计（entityId → 层数），不改写未知实体结构。
    this.burn = new Map();
    // slow_field 减速 debuff（entityId → { until, factor }）。
    this.slowDebuffs = new Map();
    // portal 双向门（portalId → { x, y, pairId, ownerId, until }）。
    this.portals = new Map();
  }

  // 解析装载 + 校验冷却/消耗 + 分发效果。
  activate(player, targetX, targetY, entities, mapData) {
    const id = player.activeCoprocessor;
    if (!id) return { success: false, reason: 'none_loaded' };

    const owned = player.getCoprocessor(id);
    if (!owned) return { success: false, reason: 'not_owned' };

    const coprocessor = Object.values(COPROCESSORS).find((c) => c.id === id);
    const cfg = coprocessor.stars[owned.star - 1];
    const now = Date.now();

    if (now - (player.coprocessorLastUsed || 0) < cfg.cooldown) {
      return { success: false, reason: 'on_cooldown' };
    }

    if (cfg.tokenCost > 0) {
      if (!this.combat.payTokenCost(player, cfg.tokenCost)) {
        return { success: false, reason: 'insufficient_tokens' };
      }
    }

    player.coprocessorLastUsed = now;
    player.lastCombatAt = now;

    const method = EFFECT_HANDLERS[id];
    const result = method
      ? this[method](player, cfg, targetX, targetY, entities, mapData)
      : { success: false, reason: 'not_implemented' };

    if (result.success) {
      this.combat.broadcastToPlayers(entities, EVENTS.COPROCESSOR_ACTIVATED, {
        playerId: player.id,
        coprocessorId: id,
        star: owned.star,
        targetX,
        targetY,
      });
      this.combat.syncPlayer(player);
    }

    return result;
  }

  // --- 共享助手 -----------------------------------------------------------

  // 活着的、非排除 id 的实体列表。
  candidates(entities, excludeId) {
    const out = [];
    for (const [, e] of entities) {
      if (!e || e.id === excludeId || !e.alive) continue;
      out.push(e);
    }
    return out;
  }

  // 造成伤害 + 广播 + 击杀处理，返回命中记录。
  damageEntity(entity, damage, attacker, entities, skillId) {
    if (!entity.alive) return { targetId: entity.id, damage: 0, killed: false };
    const alive = entity.takeDamage
      ? entity.takeDamage(damage, attacker.id)
      : true;
    this.combat.broadcastToPlayers(entities, EVENTS.COMBAT_HIT, {
      attackerId: attacker.id,
      targetId: entity.id,
      damage,
      skillId,
      isCrit: false,
    });
    if (!alive) this.combat.handleEntityDeath(entity, attacker, entities);
    return { targetId: entity.id, damage, killed: !alive };
  }

  // 主目标 + 最近 N 个相邻敌人（曼哈顿距离，自主目标起）。
  collectNearest(primary, entities, excludeId, range) {
    return this.candidates(entities, excludeId)
      .filter((e) => e.id !== primary.id)
      .map((e) => ({ e, d: Math.abs(primary.x - e.x) + Math.abs(primary.y - e.y) }))
      .filter((o) => o.d <= range)
      .sort((a, b) => a.d - b.d);
  }

  // --- 攻击型效果处理器 ----------------------------------------------------

  // 闪电链：主目标 + 链到链Count-1 个最近敌人（CHAIN_RANGE 内）。
  effectLightningSurge(player, cfg, tx, ty, entities) {
    const primary = this.combat.findEntityAt(tx, ty, entities, player.id);
    if (!primary) return { success: false, reason: 'no_target' };

    const hits = [primary];
    const want = Math.max(0, cfg.chainCount - 1);
    const nearest = this.collectNearest(primary, entities, player.id, CHAIN_RANGE);
    for (let i = 0; i < want && i < nearest.length; i++) hits.push(nearest[i].e);

    const results = hits.map((e) =>
      this.damageEntity(e, calcDamage(player.atk, cfg.damageMult, e.def || 0), player, entities, 'lightning_surge')
    );
    return { success: true, hits: results };
  }

  // 穿透射击：沿玩家→目标方向射线，命中线上所有敌人（PIERCE_RANGE 内）。
  effectPiercingShot(player, cfg, tx, ty, entities) {
    const dx = Math.sign(tx - player.x);
    const dy = Math.sign(ty - player.y);
    if (dx === 0 && dy === 0) return { success: false, reason: 'no_target' };

    const results = [];
    let cx = player.x + dx;
    let cy = player.y + dy;
    for (let travelled = 0; travelled < PIERCE_RANGE; travelled++) {
      if (cx < 0 || cx >= MAP_WIDTH || cy < 0 || cy >= MAP_HEIGHT) break;
      const hit = this.combat.findEntityAt(cx, cy, entities, player.id);
      if (hit) {
        results.push(
          this.damageEntity(hit, calcDamage(player.atk, cfg.damageMult, hit.def || 0), player, entities, 'piercing_shot')
        );
      }
      cx += dx;
      cy += dy;
    }

    if (results.length === 0) return { success: false, reason: 'no_target' };
    return { success: true, hits: results };
  }

  // 分裂弹：主目标满额伤害 + fragmentCount 弹片命中最近他人（SPLIT_RANGE 内）。
  effectSplitRound(player, cfg, tx, ty, entities) {
    const primary = this.combat.findEntityAt(tx, ty, entities, player.id);
    if (!primary) return { success: false, reason: 'no_target' };

    const results = [
      this.damageEntity(primary, calcDamage(player.atk, 1.0, primary.def || 0), player, entities, 'split_round'),
    ];
    const nearest = this.collectNearest(primary, entities, player.id, SPLIT_RANGE);
    for (let i = 0; i < cfg.fragmentCount && i < nearest.length; i++) {
      const e = nearest[i].e;
      results.push(
        this.damageEntity(e, calcDamage(player.atk, cfg.fragmentMult, e.def || 0), player, entities, 'split_round')
      );
    }
    return { success: true, hits: results };
  }

  // 灼烧印记：即时叠加 burnStacks 层灼烧伤害；累计 ≥ 阈值引爆并复位。
  effectBurnMark(player, cfg, tx, ty, entities) {
    const target = this.combat.findEntityAt(tx, ty, entities, player.id);
    if (!target) return { success: false, reason: 'no_target' };

    const stackDamage = calcDamage(player.atk, cfg.burnStacks * BURN_STACK_DAMAGE_MULT, target.def || 0);
    const hit = this.damageEntity(target, stackDamage, player, entities, 'burn_mark');

    const total = (this.burn.get(target.id) || 0) + cfg.burnStacks;
    this.burn.set(target.id, total);

    let detonated = false;
    if (total >= BURN_DETONATE_STACKS) {
      const detonateDamage = calcDamage(player.atk, BURN_DETONATE_DAMAGE_MULT, target.def || 0);
      this.damageEntity(target, detonateDamage, player, entities, 'burn_mark');
      this.burn.set(target.id, 0);
      detonated = true;
    }

    return { success: true, hits: [hit], stacksApplied: cfg.burnStacks, detonated };
  }

  // --- 共享：地图通行判定（与 world-player lobbyMap 等价） ---
  isWalkable(x, y, mapData) {
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return false;
    const map = mapData;
    if (map && map[y] && map[y][x] === TILE.WALL) return false;
    return true;
  }

  // 按 entityId 定位实体（来自 entities Map）。
  findEntityById(entityId, entities) {
    if (!entities || !entityId) return null;
    return entities.get(entityId) || null;
  }

  // --- 防御型效果处理器（M6.1） --------------------------------------------

  // 护盾超载：设护盾 + 反射百分比（damagePlayer 内读取 copReflect）。
  effectShieldOverload(player, cfg) {
    player.shieldActive = true;
    player.shield = cfg.absorbAmount;
    player.shieldExpiresAt = Date.now() + 4000; // 与 executeShield 默认时长一致
    player.lastShieldDrainAt = Date.now();
    player.copReflect = cfg.reflectPercent;
    this.combat.broadcastToPlayers(null, EVENTS.COMBAT_SHIELD, {
      playerId: player.id, active: true, absorbRemaining: player.shield,
    });
    return { success: true, absorb: cfg.absorbAmount, reflect: cfg.reflectPercent };
  }

  // 伤害转治疗：duration 内受击转为治疗。
  effectDamageToHeal(player, cfg) {
    player.copDamageToHealUntil = Date.now() + cfg.duration;
    return { success: true, until: player.copDamageToHealUntil };
  }

  // 反弹屏障：duration 内按 reflectChance 全额反弹（damagePlayer 内判定）。
  effectReboundBarrier(player, cfg) {
    player.copReboundUntil = Date.now() + cfg.duration;
    player.copReboundChance = cfg.reflectChance;
    return { success: true, until: player.copReboundUntil, chance: cfg.reflectChance };
  }

  // 紧急修复：立即回复 healPercent*maxHp。
  effectEmergencyRepair(player, cfg) {
    const heal = Math.floor(player.maxHp * cfg.healPercent);
    player.hp = Math.min(player.maxHp, player.hp + heal);
    return { success: true, healed: heal };
  }

  // --- 机动型效果处理器（M6.2） --------------------------------------------

  // 区域隐身：隐身 duration，下次攻击 ×backstabMultiplier。
  effectStealthField(player, cfg) {
    player.stealthed = true;
    player.copBackstabMult = cfg.backstabMultiplier;
    player.copStealthUntil = Date.now() + cfg.duration;
    return { success: true, until: player.copStealthUntil, mult: cfg.backstabMultiplier };
  }

  // 瞬移闪现：沿玩家→目标方向步进最多 range 格，遇墙停止。
  effectBlink(player, cfg, tx, ty, entities, mapData) {
    const dx = Math.sign(tx - player.x);
    const dy = Math.sign(ty - player.y);
    if (dx === 0 && dy === 0) return { success: false, reason: 'no_direction' };

    let nx = player.x;
    let ny = player.y;
    let stepped = 0;
    for (let i = 0; i < cfg.range; i++) {
      const tryX = nx + dx;
      const tryY = ny + dy;
      if (!this.isWalkable(tryX, tryY, mapData)) break;
      nx = tryX;
      ny = tryY;
      stepped++;
    }
    if (stepped === 0) return { success: false, reason: 'blocked' };

    player.x = nx;
    player.y = ny;
    return { success: true, x: nx, y: ny, distance: stepped };
  }

  // 减速力场：radius 内所有敌人获得 SLOW_DURATION_MS 减速 debuff。
  effectSlowField(player, cfg, tx, ty, entities) {
    const now = Date.now();
    const affected = [];
    for (const [, e] of (entities || [])) {
      if (!e || e.id === player.id || !e.alive) continue;
      const dist = Math.abs(tx - e.x) + Math.abs(ty - e.y);
      if (dist <= cfg.radius) {
        this.slowDebuffs.set(e.id, { until: now + SLOW_DURATION_MS, factor: cfg.slowPercent });
        affected.push(e.id);
      }
    }
    return { success: true, affected, slowPercent: cfg.slowPercent };
  }

  // 传送门：在玩家点与目标点各建一个门，pairId 互指，持续 duration。
  effectPortal(player, cfg, tx, ty) {
    const now = Date.now();
    const until = now + cfg.duration;
    const idA = `p_${player.id}_${now}`;
    const idB = `p_${player.id}_${now + 1}`;
    this.portals.set(idA, { x: player.x, y: player.y, pairId: idB, ownerId: player.id, until });
    this.portals.set(idB, { x: tx, y: ty, pairId: idA, ownerId: player.id, until });
    return { success: true, portalA: { x: player.x, y: player.y }, portalB: { x: tx, y: ty } };
  }

  // 尝试把玩家从所在传送门传送到配对门（被 world-player move 后调用）。
  tryPortalTeleport(player) {
    const now = Date.now();
    if (player.copPortalImmuneUntil && now < player.copPortalImmuneUntil) return false;

    // 清理过期门
    for (const [id, p] of this.portals) {
      if (now >= p.until) this.portals.delete(id);
    }

    for (const [id, p] of this.portals) {
      if (p.x === player.x && p.y === player.y) {
        const pair = this.portals.get(p.pairId);
        if (pair && now < pair.until) {
          const fromX = player.x, fromY = player.y;
          player.x = pair.x;
          player.y = pair.y;
          player.copPortalImmuneUntil = now + PORTAL_IMMUNE_MS;
          this.combat.broadcastToPlayers(null, EVENTS.PORTAL_TELEPORT, {
            playerId: player.id, fromX, fromY, toX: pair.x, toY: pair.y,
          });
          return true;
        }
      }
    }
    return false;
  }

  // --- 经济型效果处理器（M6.3） --------------------------------------------

  // 算力磁铁：立即授予 radius*TOKEN_MAGNET_RADIUS_MULT 个 unstable（环境收集语义）。
  effectTokenMagnet(player, cfg) {
    const amount = cfg.radius * TOKEN_MAGNET_RADIUS_MULT;
    player.addUnstableTokens(amount);
    return { success: true, amount };
  }

  // Token 翻倍：15s 内下一次掉落 ×dropMult（applyLoot 内读取）。
  effectTokenDoubler(player, cfg) {
    player.copLootMult = cfg.dropMult;
    player.copLootMultUntil = Date.now() + TOKEN_DOUBLER_WINDOW_MS;
    return { success: true, mult: cfg.dropMult, until: player.copLootMultUntil };
  }

  // 稀有率提升：duration 内 rollRarity 传入 rarityBonus。
  effectRarityBoost(player, cfg) {
    player.copRarityBonus = cfg.rarityBonus;
    player.copRarityUntil = Date.now() + cfg.duration;
    return { success: true, bonus: cfg.rarityBonus, until: player.copRarityUntil };
  }

  // 离线加速：持久化倍率与到期时间（跨离线）。
  effectOfflineBoost(player, cfg) {
    player.copOfflineBoostMult = cfg.miningMult;
    player.copOfflineBoostUntil = Date.now() + cfg.duration;
    this.store.markDirty(player);
    return { success: true, mult: cfg.miningMult, until: player.copOfflineBoostUntil };
  }
}

module.exports = CoprocessorSystem;
module.exports.EFFECT_HANDLERS = EFFECT_HANDLERS;