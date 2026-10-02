// Coprocessor skill activation (M6): slot architecture + effect-execution
// framework + the 4 attack effects. Slot validation (cooldown / token cost)
// and damage targeting are server-authoritative.
const Player = require('../server/models/Player');
const CombatSystem = require('../server/game/CombatSystem');
const CoprocessorSystem = require('../server/game/CoprocessorSystem');
const { COPROCESSORS, calcDamage } = require('../shared/constants');

function makeFakeStore() {
  return {
    dirty: new Set(),
    markDirty(p) { if (p && p.id) this.dirty.add(p.id); return p; },
    persist() { return true; },
  };
}

function ent(id, x, y, def = 0) {
  return {
    id, x, y, def, hp: 100, alive: true,
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
  p.x = 5;
  p.y = 5;
  p.basicAmmo = 10;
  p.unstableTokens = 10;
  if (coprocessorId) {
    p.addCoprocessor(coprocessorId);
    p.setActiveCoprocessor(coprocessorId);
  }
  return p;
}

function makeSystem() {
  const combat = new CombatSystem({ emit() {} }, makeFakeStore());
  const coprocessor = new CoprocessorSystem({ emit() {} }, makeFakeStore(), combat);
  return { combat, coprocessor };
}

describe('Coprocessor activation — slot validation', () => {
  const { coprocessor } = makeSystem();

  it('returns none_loaded when nothing is equipped', () => {
    const p = makePlayer(null);
    const r = coprocessor.activate(p, 6, 5, makeEntities([]), null);
    expect(r).toEqual({ success: false, reason: 'none_loaded' });
  });

  it('returns not_owned for an unknown loaded id', () => {
    const p = makePlayer(null);
    p.activeCoprocessor = 'lightning_surge'; // loaded without ownership
    const r = coprocessor.activate(p, 6, 5, makeEntities([]), null);
    expect(r).toEqual({ success: false, reason: 'not_owned' });
  });

  it('enforces cooldown on a second immediate cast', () => {
    const { coprocessor: c } = makeSystem();
    const p = makePlayer('lightning_surge');
    const e = makeEntities([ent('m1', 6, 5)]);
    expect(c.activate(p, 6, 5, e, null).success).toBe(true);
    expect(c.activate(p, 6, 5, e, null)).toEqual({ success: false, reason: 'on_cooldown' });
  });

  it('does not enter cooldown when token payment fails', () => {
    const { coprocessor: c } = makeSystem();
    const p = makePlayer('lightning_surge');
    p.basicAmmo = 0;
    p.unstableTokens = 0;
    const r = c.activate(p, 6, 5, makeEntities([ent('m1', 6, 5)]), null);
    expect(r).toEqual({ success: false, reason: 'insufficient_tokens' });
    expect(p.coprocessorLastUsed).toBe(0);
  });
});

describe('Coprocessor activation — attack effects', () => {
  it('lightning_surge hits the primary plus chainCount-1 nearest', () => {
    const { coprocessor: c } = makeSystem();
    const p = makePlayer('lightning_surge'); // ★ damageMult 1.0, chainCount 2
    const m1 = ent('m1', 6, 5);   // primary
    const m2 = ent('m2', 7, 5);   // nearest chain (dist 1 from primary)
    const m3 = ent('m3', 9, 5);   // farther (dist 3), should NOT be hit
    const r = c.activate(p, 6, 5, makeEntities([m1, m2, m3]), null);
    const dmg = calcDamage(10, 1.0, 0);
    expect(r.success).toBe(true);
    expect(r.hits).toHaveLength(2);
    expect(m1.hp).toBe(100 - dmg);
    expect(m2.hp).toBe(100 - dmg);
    expect(m3.hp).toBe(100); // untouched
  });

  it('piercing_shot damages every enemy on the ray', () => {
    const { coprocessor: c } = makeSystem();
    const p = makePlayer('piercing_shot'); // ★ damageMult 0.8
    const m1 = ent('m1', 6, 5);
    const m2 = ent('m2', 7, 5);
    const m3 = ent('m3', 8, 5);
    const r = c.activate(p, 8, 5, makeEntities([m1, m2, m3]), null);
    const dmg = calcDamage(10, 0.8, 0);
    expect(r.success).toBe(true);
    expect(r.hits).toHaveLength(3);
    expect([m1.hp, m2.hp, m3.hp]).toEqual([100 - dmg, 100 - dmg, 100 - dmg]);
  });

  it('split_round deals full damage to primary plus fragments to nearest', () => {
    const { coprocessor: c } = makeSystem();
    const p = makePlayer('split_round'); // ★ fragmentCount 2, fragmentMult 0.5
    const m1 = ent('m1', 6, 5); // primary
    const m2 = ent('m2', 7, 5); // nearest fragment
    const m3 = ent('m3', 8, 5); // next fragment
    const r = c.activate(p, 6, 5, makeEntities([m1, m2, m3]), null);
    const full = calcDamage(10, 1.0, 0);
    const frag = calcDamage(10, 0.5, 0);
    expect(r.success).toBe(true);
    expect(r.hits).toHaveLength(3);
    expect(m1.hp).toBe(100 - full);
    expect(m2.hp).toBe(100 - frag);
    expect(m3.hp).toBe(100 - frag);
  });

  it('burn_mark accumulates stacks and detonates at the threshold', () => {
    const { coprocessor: c } = makeSystem();
    const p = makePlayer('burn_mark'); // ★ burnStacks 2
    const m1 = ent('m1', 6, 5);
    const e = makeEntities([m1]);

    const first = c.activate(p, 6, 5, e, null);
    expect(first.success).toBe(true);
    expect(first.stacksApplied).toBe(2);
    expect(first.detonated).toBe(false); // 2 < 3
    expect(m1.hp).toBe(100 - calcDamage(10, 1.0, 0));

    // Force past cooldown (★ cooldown 2000ms)
    p.coprocessorLastUsed = 0;
    const second = c.activate(p, 6, 5, e, null);
    expect(second.detonated).toBe(true); // 2+2=4 ≥ 3
    expect(m1.hp).toBe(100 - calcDamage(10, 1.0, 0) * 2 - calcDamage(10, 2.0, 0));
  });

  it('returns not_implemented for the deferred defense tier', () => {
    const { coprocessor: c } = makeSystem();
    const p = makePlayer('shield_overload');
    const r = c.activate(p, 6, 5, makeEntities([ent('m1', 6, 5)]), null);
    expect(r).toEqual({ success: false, reason: 'not_implemented' });
  });
});