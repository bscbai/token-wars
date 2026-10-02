// Coprocessor effects (M6.1/M6.2/M6.3): defense, mobility, economy tiers.
// Reuses the M6 activate pipeline; each effect is wired to the right subsystem.
const Player = require('../server/models/Player');
const CombatSystem = require('../server/game/CombatSystem');
const CoprocessorSystem = require('../server/game/CoprocessorSystem');
const MiningManager = require('../server/game/MiningManager');
const { COPROCESSORS, calcDamage, MINING } = require('../shared/constants');

function makeFakeStore() {
  return {
    dirty: new Set(),
    markDirty(p) { if (p && p.id) this.dirty.add(p.id); return p; },
    persist() { return true; },
    players: new Map(),
  };
}

function ent(id, x, y, def = 0, hp = 100) {
  return {
    id, x, y, def, hp, maxHp: hp, alive: true,
    takeDamage(d) {
      this.hp -= d;
      if (this.hp <= 0) { this.hp = 0; this.alive = false; }
      return this.alive;
    },
  };
}

function makeEntities(list) {
  return new Map(list.map((e) => [e.id, e]));
}

function makePlayer(coprocessorId) {
  const p = new Player('tester');
  p.x = 5; p.y = 5;
  p.basicAmmo = 10;
  p.unstableTokens = 10;
  if (coprocessorId) {
    p.addCoprocessor(coprocessorId);
    p.setActiveCoprocessor(coprocessorId);
  }
  return p;
}

function makeSystem() {
  const io = { emit() {} };
  const combat = new CombatSystem(io, makeFakeStore());
  const coprocessor = new CoprocessorSystem(io, makeFakeStore(), combat);
  combat.coprocessor = coprocessor;
  return { combat, coprocessor };
}

// ---- M6.1 防御型 ----

describe('M6.1 Defense effects', () => {
  it('shield_overload grants shield + reflect, and damagePlayer reflects to source', () => {
    const { combat, coprocessor } = makeSystem();
    const p = makePlayer('shield_overload');
    const src = ent('m1', 6, 5);
    const entities = makeEntities([src]);

    const r = coprocessor.activate(p, 6, 5, entities, null);
    expect(r.success).toBe(true);
    expect(p.shieldActive).toBe(true);
    expect(p.shield).toBe(30);
    expect(p.copReflect).toBe(0.15);

    const beforeHp = p.hp;
    combat.damagePlayer(p, 20, 'm1', entities);
    expect(p.shield).toBe(10);          // 30 - 20 absorbed
    expect(p.hp).toBe(beforeHp);         // no HP loss
    expect(src.hp).toBe(100 - Math.max(1, Math.floor(20 * 0.15))); // reflected 3
  });

  it('damage_to_heal converts incoming damage to healing within the window', () => {
    const { combat, coprocessor } = makeSystem();
    const p = makePlayer('damage_to_heal');
    p.hp = 50;
    const r = coprocessor.activate(p, 6, 5, makeEntities([]), null);
    expect(r.success).toBe(true);

    combat.damagePlayer(p, 30, null, makeEntities([]));
    expect(p.hp).toBe(Math.min(p.maxHp, 50 + 30)); // healed, not damaged
  });

  it('rebound_barrier fully negates and reflects when the roll succeeds', () => {
    const { combat, coprocessor } = makeSystem();
    const p = makePlayer('rebound_barrier'); // ★ reflectChance 0.5
    const src = ent('m1', 6, 5, 0, 1000);
    const entities = makeEntities([src]);
    coprocessor.activate(p, 6, 5, entities, null);

    // Force the reflect roll to succeed.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const beforeHp = p.hp;
    combat.damagePlayer(p, 25, 'm1', entities);
    spy.mockRestore();

    expect(p.hp).toBe(beforeHp);        // negated
    expect(src.hp).toBe(1000 - 25);     // full damage reflected
  });

  it('emergency_repair heals a percent of maxHp', () => {
    const { coprocessor } = makeSystem();
    const p = makePlayer('emergency_repair');
    p.hp = 10;
    const r = coprocessor.activate(p, 6, 5, makeEntities([]), null);
    expect(r.success).toBe(true);
    expect(p.hp).toBe(10 + Math.floor(p.maxHp * 0.15));
  });

  it('emergency_repair auto-triggers in tickPlayer when HP < 20% and off cooldown', () => {
    const { combat, coprocessor } = makeSystem();
    const p = makePlayer('emergency_repair');
    p.hp = 1; // < 20%
    const before = p.hp;
    combat.tickPlayer(p, Date.now());
    expect(p.hp).toBeGreaterThan(before);
    expect(p.coprocessorLastUsed).toBeGreaterThan(0);
  });
});

// ---- M6.2 机动型 ----

describe('M6.2 Mobility effects', () => {
  it('stealth_field sets stealthed + backstab multiplier, cleared on melee', () => {
    const { combat, coprocessor } = makeSystem();
    const p = makePlayer('stealth_field');
    const target = ent('m1', 6, 5);
    const entities = makeEntities([target]);

    coprocessor.activate(p, 6, 5, entities, null);
    expect(p.stealthed).toBe(true);
    expect(p.copBackstabMult).toBe(1.5);

    const skill = { id: 'q', multiplier: 1, range: 5, tokenCost: 0 };
    const before = target.hp;
    combat.executeMelee(p, skill, 6, 5, entities);
    expect(p.stealthed).toBe(false);
    expect(p.copBackstabMult).toBe(0);
    const base = calcDamage(p.atk, 1, 0);
    expect(target.hp).toBe(before - Math.max(1, Math.floor(base * 1.5)));
  });

  it('blink moves up to range tiles and stops at walls', () => {
    const { coprocessor } = makeSystem();
    const p = makePlayer('blink'); // ★ range 3
    // Build a map with a wall at x=8 to stop the blink after 2 steps.
    const map = [];
    for (let y = 0; y < 30; y++) {
      map[y] = [];
      for (let x = 0; x < 30; x++) map[y][x] = 0;
    }
    map[5][8] = 1; // wall

    const r = coprocessor.activate(p, 20, 5, makeEntities([]), map);
    expect(r.success).toBe(true);
    expect(p.x).toBe(7); // stepped 5→6→7, wall at 8
    expect(p.y).toBe(5);
  });

  it('slow_field marks enemies in radius with a slow debuff', () => {
    const { coprocessor } = makeSystem();
    const p = makePlayer('slow_field'); // ★ radius 3, slowPercent 0.3
    const m1 = ent('m1', 6, 5);
    const m2 = ent('m2', 10, 5); // distance 4 from target (6,5) → outside radius 3
    const entities = makeEntities([m1, m2]);

    const r = coprocessor.activate(p, 6, 5, entities, null);
    expect(r.success).toBe(true);
    expect(r.affected).toContain('m1');
    expect(r.affected).not.toContain('m2');
    expect(coprocessor.slowDebuffs.has('m1')).toBe(true);
  });

  it('portal creates a bidirectional pair and teleports a stepping player', () => {
    const { coprocessor } = makeSystem();
    const p = makePlayer('portal');
    p.x = 5; p.y = 5;
    coprocessor.activate(p, 10, 5, makeEntities([]), null);
    expect(coprocessor.portals.size).toBe(2);

    // Player steps onto the portal at (5,5) → should teleport to (10,5).
    const teleported = coprocessor.tryPortalTeleport(p);
    expect(teleported).toBe(true);
    expect(p.x).toBe(10);
    expect(p.y).toBe(5);
    // Immune window prevents immediate bounce-back.
    expect(coprocessor.tryPortalTeleport(p)).toBe(false);
  });
});

// ---- M6.3 经济型 ----

describe('M6.3 Economy effects', () => {
  it('token_magnet grants unstable tokens scaled by radius', () => {
    const { coprocessor } = makeSystem();
    const p = makePlayer('token_magnet'); // ★ radius 4
    const before = p.unstableTokens;
    const r = coprocessor.activate(p, 6, 5, makeEntities([]), null);
    expect(r.success).toBe(true);
    expect(p.unstableTokens).toBe(before + 4 * 3);
  });

  it('token_doubler multiplies the next applyLoot drop', () => {
    const { combat, coprocessor } = makeSystem();
    const p = makePlayer('token_doubler'); // ★ dropMult 1.5
    coprocessor.activate(p, 6, 5, makeEntities([]), null);
    expect(p.copLootMult).toBe(1.5);

    const before = p.unstableTokens;
    combat.applyLoot(p, { unstable: 10, stable: [{ rarity: 'common' }], xp: 0 });
    expect(p.unstableTokens).toBe(before + Math.max(1, Math.floor(10 * 1.5)));
    expect(p.copLootMult).toBe(0); // consumed
  });

  it('rarity_boost shifts rollRarity toward higher rarities', () => {
    const { coprocessor } = makeSystem();
    const p = makePlayer('rarity_boost'); // ★ rarityBonus 0.1
    coprocessor.activate(p, 6, 5, makeEntities([]), null);
    expect(p.copRarityBonus).toBe(0.1);
    expect(p.copRarityUntil).toBeGreaterThan(Date.now());
  });

  it('offline_boost persists multiplier and speeds up calculateOfflineMining', () => {
    const { coprocessor } = makeSystem();
    const p = makePlayer('offline_boost'); // ★ miningMult 1.25, duration 2h
    coprocessor.activate(p, 6, 5, makeEntities([]), null);
    expect(p.copOfflineBoostMult).toBe(1.25);
    expect(p.copOfflineBoostUntil).toBeGreaterThan(Date.now());

    // Round-trip through save keeps the boost.
    const restored = Player.fromSave(p.toSave());
    expect(restored.copOfflineBoostMult).toBe(1.25);
    expect(restored.copOfflineBoostUntil).toBe(p.copOfflineBoostUntil);

    // Mining calc benefits from the boost.
    p.lastMiningCollect = Date.now() - 60000; // 1 min offline
    p.pendingMiningTokens = 0;
    const store = makeFakeStore();
    const mm = new MiningManager({ emit() {} }, store);
    const boosted = mm.calculateOfflineMining(p);
    expect(boosted).toBeGreaterThan(0);
  });
});
