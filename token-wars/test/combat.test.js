const CombatSystem = require('../server/game/CombatSystem');
const Player = require('../server/models/Player');

// Minimal Store test double — records the write-through calls CombatSystem makes.
function makeFakeStore() {
  return {
    dirty: new Set(),
    persisted: [],
    markDirty(p) { if (p && p.id) this.dirty.add(p.id); return p; },
    persist(p) { if (p) this.persisted.push(p.id); return true; },
    savePlayer(p) { this.persist(p); },
    getPlayerById() { return null; },
  };
}

function makeMonster({ id = 'm1', x = 0, y = 1, def = 0, hp = 100 } = {}) {
  const m = { id, x, y, def, hp, alive: true, username: undefined, lootTable: null };
  m.takeDamage = function (dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) this.alive = false;
    return this.alive;
  };
  return m;
}

describe('CombatSystem', () => {
  let io, combat, store;

  beforeEach(() => {
    io = { emit: () => {} };
    store = makeFakeStore();
    combat = new CombatSystem(io, store);
  });

  it('basic attack hits a target in range, consumes a token, sets cooldown', () => {
    const attacker = new Player('att');
    const target = makeMonster({ x: 0, y: 1 });
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const tokensBefore = attacker.unstableTokens;

    const res = combat.useSkill(attacker, 0, 0, 1, entities); // skill 0 = basic_attack

    expect(res.success).toBe(true);
    // baseDamage = atk(10) * 1.0 - def(0) = 10 (crit 1.5x => 15)
    expect([10, 15]).toContain(res.damage);
    expect(attacker.unstableTokens).toBe(tokensBefore - 1);
    expect(attacker.skills[0].lastUsed).toBeGreaterThan(0);
  });

  it('rejects a second use while on cooldown', () => {
    const attacker = new Player('att');
    const target = makeMonster({ x: 0, y: 1 });
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);

    combat.useSkill(attacker, 0, 0, 1, entities);
    const res = combat.useSkill(attacker, 0, 0, 1, entities);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('on_cooldown');
  });

  it('rejects when unstable tokens are insufficient', () => {
    const attacker = new Player('att');
    attacker.unstableTokens = 0;
    const entities = new Map([[attacker.id, attacker]]);

    const res = combat.useSkill(attacker, 0, 0, 1, entities);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('insufficient_tokens');
  });

  it('reports out of range for a distant target', () => {
    const attacker = new Player('att');
    const target = makeMonster({ x: 0, y: 5 }); // range 1
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);

    const res = combat.useSkill(attacker, 0, 0, 5, entities);

    expect(res.success).toBe(false);
    expect(res.reason).toBe('out_of_range');
  });

  it('basic attack damages a player target (PvP)', () => {
    const attacker = new Player('att');
    const target = new Player('tgt');
    target.x = 0; target.y = 1;
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const hpBefore = target.hp;

    const res = combat.useSkill(attacker, 0, 0, 1, entities);

    expect(res.success).toBe(true);
    // atk=10, def=5, mult=1.0 -> 5 (crit 1.5x -> 7)
    expect([5, 7]).toContain(res.damage);
    expect(target.hp).toBe(hpBefore - res.damage);
  });

  // --- S1: persistence write-through ---------------------------------------

  it('marks the attacker dirty when a skill consumes unstable tokens', () => {
    const attacker = new Player('att');
    const target = makeMonster({ x: 0, y: 1 });
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);

    combat.useSkill(attacker, 0, 0, 1, entities);

    expect(store.dirty.has(attacker.id)).toBe(true);
  });

  it('persists the looter immediately when a monster drops loot', () => {
    const attacker = new Player('att');
    const target = makeMonster({ x: 0, y: 1, hp: 1 });
    target.lootTable = { unstable: [5, 5], stableChance: 0, xpReward: 10 };
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);

    combat.useSkill(attacker, 0, 0, 1, entities);

    expect(target.alive).toBe(false);
    expect(store.persisted).toContain(attacker.id);
  });

  it('persists a dead player immediately after the death drop', () => {
    const dead = new Player('victim');
    dead.addStableToken('common');
    dead.addStableToken('common');

    combat.handlePlayerDeath(dead, { id: 'killer', username: null });

    expect(store.persisted).toContain(dead.id);
  });
});
