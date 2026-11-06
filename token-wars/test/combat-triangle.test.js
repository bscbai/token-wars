// Combat triangle (GDD §4.1), combos (§4.4), basic ammo (§2.2),
// shield duration/drain and the restored maintenance cadence.
const CombatSystem = require('../server/game/CombatSystem');
const Player = require('../server/models/Player');
const { BASIC_AMMO, COMBOS, SKILLS } = require('../shared/constants');

function makeFakeStore() {
  return {
    dirty: new Set(),
    markDirty(p) { if (p && p.id) this.dirty.add(p.id); return p; },
    persist(p) { return true; },
  };
}

function makeMonster({ id = 'm1', x = 0, y = 1, def = 0, hp = 1000 } = {}) {
  const m = { id, x, y, def, hp, alive: true, username: undefined, lootTable: null };
  m.takeDamage = function (dmg) {
    this.hp -= dmg;
    if (this.hp <= 0) this.alive = false;
    return this.alive;
  };
  return m;
}

function makeSocket() {
  const emitted = [];
  return { emitted, emit: (event, data) => emitted.push({ event, data }) };
}

describe('Combat triangle', () => {
  let io, combat, store;

  beforeEach(() => {
    io = { emit: () => {} };
    store = makeFakeStore();
    combat = new CombatSystem(io, store);
    vi.useFakeTimers();
    vi.setSystemTime(100000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Q counters E: melee pierces an active shield at 50% without depleting it', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 0; // full damage, isolate the pierce multiplier
    const target = new Player('tgt');
    target.x = 0; target.y = 1;
    target.shieldActive = true;
    target.shield = 20;
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const hpBefore = target.hp;

    const res = combat.useSkill(attacker, 0, 0, 1, entities);

    expect(res.success).toBe(true);
    // atk 10 - def 5 = 5 → pierce ×0.5 = 2 (crit: 7 → 3)
    expect([2, 3]).toContain(res.damage);
    expect(target.hp).toBe(hpBefore - res.damage);
    expect(target.shield).toBe(20); // shield value untouched
    expect(target.shieldActive).toBe(true);
  });

  it('melee hit broadcasts penetrated: true against a shielded target', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 0;
    const target = new Player('tgt');
    target.x = 0; target.y = 1;
    target.shieldActive = true;
    target.shield = 20;
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const sock = makeSocket();
    combat.registerSocket(attacker.id, sock);

    combat.useSkill(attacker, 0, 0, 1, entities);

    const hit = sock.emitted.find(e => e.event === 'combat:hit');
    expect(hit.data.penetrated).toBe(true);
  });

  it('E counters R: shield fully absorbs an AOE hit (no HP loss)', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 0;
    attacker.x = 10; attacker.y = 10;
    const target = new Player('tgt');
    target.x = 11; target.y = 10;
    target.shieldActive = true;
    target.shield = 50;
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const hpBefore = target.hp;

    const res = combat.useSkill(attacker, 3, 11, 10, entities); // token_burst

    expect(res.success).toBe(true);
    expect(target.hp).toBe(hpBefore);
    // AOE damage = 10*1.5 - 5 = 10 (crit 15), absorbed in full
    expect([10, 15]).toContain(res.hits[0].absorbed);
    expect(res.hits[0].damage).toBe(0);
    expect(target.shield).toBe(50 - res.hits[0].absorbed);
    expect(target.shieldActive).toBe(true);
  });

  it('E counters R: absorption breaks the shield when it runs out', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 0;
    attacker.x = 10; attacker.y = 10;
    const target = new Player('tgt');
    target.x = 11; target.y = 10;
    target.shieldActive = true;
    target.shield = 5;
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const hpBefore = target.hp;

    combat.useSkill(attacker, 3, 11, 10, entities);

    expect(target.hp).toBe(hpBefore); // still no HP loss — full absorption rule
    expect(target.shield).toBe(0);
    expect(target.shieldActive).toBe(false);
  });

  it('R counters Q: AOE knocks an unshielded player back 1 tile and interrupts basic attack', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 0;
    attacker.x = 10; attacker.y = 10;
    const target = new Player('tgt');
    target.x = 11; target.y = 10;
    target.skills[0].lastUsed = 0;
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const sock = makeSocket();
    combat.registerSocket(target.id, sock);

    combat.useSkill(attacker, 3, 11, 10, entities);

    expect(target.x).toBe(12);
    expect(target.y).toBe(10);
    expect(target.skills[0].lastUsed).toBeGreaterThan(0); // interrupted
    const kb = sock.emitted.find(e => e.event === 'combat:knockback');
    expect(kb.data).toMatchObject({ targetId: target.id, x: 12, y: 10 });
  });

  it('R counters Q: knockback is blocked by a wall (damage and interrupt still apply)', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 0;
    attacker.x = 27; attacker.y = 10;
    const target = new Player('tgt');
    target.x = 28; target.y = 10; // lobby border wall at x=29
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const hpBefore = target.hp;

    combat.useSkill(attacker, 3, 28, 10, entities);

    expect(target.x).toBe(28); // did not move into the wall
    expect(target.hp).toBeLessThan(hpBefore);
    expect(target.skills[0].lastUsed).toBeGreaterThan(0);
  });
});

describe('Combo system', () => {
  let io, combat, store;
  const T0 = 100000;

  beforeEach(() => {
    io = { emit: () => {} };
    store = makeFakeStore();
    combat = new CombatSystem(io, store);
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function attackerWithMonster() {
    const attacker = new Player('att');
    const monster = makeMonster({ x: 0, y: 1 });
    const entities = new Map([[attacker.id, attacker], [monster.id, monster]]);
    return { attacker, monster, entities };
  }

  it('charged burst (Q→Q→R): the triggering R deals +30% damage', () => {
    const { attacker, entities } = attackerWithMonster();
    attacker.basicAmmo = 0; // isolate the combo multiplier
    attacker.x = 0; attacker.y = 0;
    const sock = makeSocket();
    combat.registerSocket(attacker.id, sock);

    combat.useSkill(attacker, 0, 0, 1, entities); // Q
    vi.setSystemTime(T0 + 500);
    combat.useSkill(attacker, 0, 0, 1, entities); // Q
    vi.setSystemTime(T0 + 1000);
    const res = combat.useSkill(attacker, 3, 0, 0, entities); // R

    expect(res.success).toBe(true);
    // AOE vs monster: 10*1.5 - 0 = 15 → ×1.3 = 19 (crit: 22 → 28)
    expect([19, 28]).toContain(res.hits[0].damage);
    const combo = sock.emitted.find(e => e.event === 'combat:combo');
    expect(combo.data.comboId).toBe('charged_burst');
    expect(attacker.comboSeq).toEqual([]); // sequence reset after trigger
  });

  it('counter combo (E→Q→Q): the triggering attack is completely free', () => {
    const { attacker, entities } = attackerWithMonster();
    const basicBefore = attacker.basicAmmo;
    const unstableBefore = attacker.unstableTokens;

    combat.useSkill(attacker, 2, 0, 0, entities); // E
    vi.setSystemTime(T0 + 500);
    combat.useSkill(attacker, 0, 0, 1, entities); // Q (costs 1 basic ammo)
    expect(attacker.basicAmmo).toBe(basicBefore - 1);
    vi.setSystemTime(T0 + 1000);
    const res = combat.useSkill(attacker, 0, 0, 1, entities); // Q — free

    expect(res.success).toBe(true);
    expect(attacker.basicAmmo).toBe(basicBefore - 1); // unchanged by the 2nd Q
    expect(attacker.unstableTokens).toBe(unstableBefore);
    // full damage (no basic-ammo penalty): 10 or crit 15
    expect([10, 15]).toContain(res.damage);
  });

  it('dodge counter (W→Q): next attack within 1s gains +50% crit chance', () => {
    const attacker = new Player('att');
    attacker.x = 5; attacker.y = 5;
    const monster = makeMonster({ x: 5, y: 9 });
    const entities = new Map([[attacker.id, attacker], [monster.id, monster]]);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 0.5 < 0.6 only with the bonus

    combat.useSkill(attacker, 1, 5, 6, entities); // W — dodges to (5,8)
    expect(attacker.y).toBe(8);
    vi.setSystemTime(T0 + 500);
    const res = combat.useSkill(attacker, 0, 5, 9, entities); // Q in range after dodge

    expect(res.success).toBe(true);
    expect(res.isCrit).toBe(true);
  });

  it('dodge counter: the crit bonus is gone after the 1s window', () => {
    const attacker = new Player('att');
    attacker.x = 5; attacker.y = 5;
    const monster = makeMonster({ x: 5, y: 9 });
    const entities = new Map([[attacker.id, attacker], [monster.id, monster]]);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 0.5 >= 0.1 → no crit without bonus

    combat.useSkill(attacker, 1, 5, 6, entities); // W
    vi.setSystemTime(T0 + 1500); // past the 1s dodge window (still inside 2s combo window)
    const res = combat.useSkill(attacker, 0, 5, 9, entities);

    expect(res.success).toBe(true);
    expect(res.isCrit).toBe(false);
  });

  it('blast shield (R→E→Q): completing the combo doubles the active shield', () => {
    const { attacker, entities } = attackerWithMonster();
    attacker.x = 0; attacker.y = 0;

    combat.useSkill(attacker, 3, 0, 0, entities); // R
    vi.setSystemTime(T0 + 1000); // E has a 1s cooldown
    combat.useSkill(attacker, 2, 0, 0, entities); // E → shield 20
    expect(attacker.shield).toBe(20);
    vi.setSystemTime(T0 + 1500);
    combat.useSkill(attacker, 0, 0, 1, entities); // Q completes R→E→Q

    expect(attacker.shield).toBe(40);
    expect(attacker.shieldActive).toBe(true);
  });

  it('perfect defense (E→W→E): the second shield lasts twice as long', () => {
    const attacker = new Player('att');
    attacker.x = 5; attacker.y = 5;
    const entities = new Map([[attacker.id, attacker]]);

    combat.useSkill(attacker, 2, 5, 5, entities); // E
    vi.setSystemTime(T0 + 500);
    combat.useSkill(attacker, 1, 5, 6, entities); // W
    vi.setSystemTime(T0 + 1000);
    combat.useSkill(attacker, 2, 5, 5, entities); // E

    expect(attacker.shieldExpiresAt - (T0 + 1000)).toBe(SKILLS.SHIELD.duration * 2);
  });

  it('expired window does not trigger a combo', () => {
    const { attacker, entities } = attackerWithMonster();
    attacker.basicAmmo = 0;
    attacker.x = 0; attacker.y = 0;
    const sock = makeSocket();
    combat.registerSocket(attacker.id, sock);

    combat.useSkill(attacker, 0, 0, 1, entities); // Q
    vi.setSystemTime(T0 + 2600); // first Q falls out of the 2s window
    combat.useSkill(attacker, 0, 0, 1, entities); // Q
    vi.setSystemTime(T0 + 3100);
    const res = combat.useSkill(attacker, 3, 0, 0, entities); // R — no charged burst

    expect(res.success).toBe(true);
    // plain R damage: 15 or crit 22 (no ×1.3)
    expect([15, 22]).toContain(res.hits[0].damage);
    expect(sock.emitted.find(e => e.event === 'combat:combo')).toBeUndefined();
  });

  it('a failed skill does not feed the combo sequence', () => {
    const attacker = new Player('att');
    const entities = new Map([[attacker.id, attacker]]); // no target anywhere

    combat.useSkill(attacker, 0, 5, 5, entities); // Q whiffs (no_target)
    vi.setSystemTime(T0 + 500);
    combat.useSkill(attacker, 0, 5, 5, entities); // whiffs again

    expect(attacker.comboSeq).toEqual([]);
  });
});

describe('Basic ammo pool', () => {
  let io, combat, store;

  beforeEach(() => {
    io = { emit: () => {} };
    store = makeFakeStore();
    combat = new CombatSystem(io, store);
    vi.useFakeTimers();
    vi.setSystemTime(100000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('new players start with a full pool and serialize it', () => {
    const p = new Player('rookie');
    expect(p.basicAmmo).toBe(BASIC_AMMO.MAX);
    expect(p.serialize().basicAmmo).toBe(BASIC_AMMO.MAX);
    expect(p.toSave().basicAmmo).toBe(BASIC_AMMO.MAX);
  });

  it('old saves without basicAmmo load with a full pool', () => {
    const p = Player.fromSave({ id: 'x', username: 'old' });
    expect(p.basicAmmo).toBe(BASIC_AMMO.MAX);
    const p2 = Player.fromSave({ id: 'y', username: 'old2', basicAmmo: 7 });
    expect(p2.basicAmmo).toBe(7);
  });

  it('basic ammo is consumed first and applies the 0.5x damage multiplier', () => {
    const attacker = new Player('att');
    const target = makeMonster({ x: 0, y: 1, def: 0 });
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);
    const unstableBefore = attacker.unstableTokens;

    const res = combat.useSkill(attacker, 0, 0, 1, entities);

    expect(res.success).toBe(true);
    expect(attacker.basicAmmo).toBe(BASIC_AMMO.MAX - 1);
    expect(attacker.unstableTokens).toBe(unstableBefore);
    // 10 × 0.5 = 5 (crit: 15 × 0.5 = 7)
    expect([5, 7]).toContain(res.damage);
    expect(store.dirty.has(attacker.id)).toBe(true);
  });

  it('mixed payment drains basic first, then unstable, keeping the penalty', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 1;
    attacker.unstableTokens = 10;
    const target = makeMonster({ x: 0, y: 1, def: 0 });
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);

    const res = combat.useSkill(attacker, 3, 0, 0, entities); // cost 3

    expect(res.success).toBe(true);
    expect(attacker.basicAmmo).toBe(0);
    expect(attacker.unstableTokens).toBe(8);
    // 15 × 0.5 = 7 (crit: 22 × 0.5 = 11)
    expect([7, 11]).toContain(res.hits[0].damage);
  });

  it('pure unstable payment keeps full damage', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 0;
    const target = makeMonster({ x: 0, y: 1, def: 0 });
    const entities = new Map([[attacker.id, attacker], [target.id, target]]);

    const res = combat.useSkill(attacker, 0, 0, 1, entities);

    expect([10, 15]).toContain(res.damage);
  });

  it('rejects the skill when total ammo is insufficient, consuming nothing', () => {
    const attacker = new Player('att');
    attacker.basicAmmo = 0;
    attacker.unstableTokens = 2;
    const entities = new Map([[attacker.id, attacker]]);

    const res = combat.useSkill(attacker, 3, 0, 0, entities); // cost 3 > 2

    expect(res.success).toBe(false);
    expect(res.reason).toBe('insufficient_tokens');
    expect(attacker.unstableTokens).toBe(2);
    expect(attacker.basicAmmo).toBe(0);
  });

  it('regenerates 1 round per 30s out of combat, up to the cap', () => {
    const p = new Player('idle');
    p.basicAmmo = 10;
    p.lastCombatAt = 1000;
    p.lastAmmoRegenAt = 0;

    combat.tickPlayer(p, 31000); // exactly 30s after last combat
    expect(p.basicAmmo).toBe(11);
    expect(p.lastAmmoRegenAt).toBe(31000);

    combat.tickPlayer(p, 60999); // 29.999s after last regen — too early
    expect(p.basicAmmo).toBe(11);

    combat.tickPlayer(p, 61000);
    expect(p.basicAmmo).toBe(12);
  });

  it('using a skill restarts the regen timer', () => {
    const p = new Player('idle');
    p.basicAmmo = 10;
    p.lastCombatAt = 60000;
    p.lastAmmoRegenAt = 0;

    combat.tickPlayer(p, 80000); // only 20s since combat

    expect(p.basicAmmo).toBe(10);
  });

  it('never regenerates past the cap', () => {
    const p = new Player('idle');
    p.basicAmmo = BASIC_AMMO.MAX;
    p.lastCombatAt = 1000;

    combat.tickPlayer(p, 100000);

    expect(p.basicAmmo).toBe(BASIC_AMMO.MAX);
  });
});

describe('Shield duration and drain', () => {
  let io, combat, store;
  const T0 = 100000;

  beforeEach(() => {
    io = { emit: () => {} };
    store = makeFakeStore();
    combat = new CombatSystem(io, store);
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shield expires after its base duration', () => {
    const p = new Player('p');
    const entities = new Map([[p.id, p]]);
    const emitted = [];
    io.emit = (event, data) => emitted.push({ event, data });

    combat.useSkill(p, 2, 0, 0, entities); // E
    expect(p.shieldActive).toBe(true);
    expect(p.shieldExpiresAt).toBe(T0 + SKILLS.SHIELD.duration);

    combat.tickPlayer(p, T0 + SKILLS.SHIELD.duration - 1);
    expect(p.shieldActive).toBe(true);

    combat.tickPlayer(p, T0 + SKILLS.SHIELD.duration);
    expect(p.shieldActive).toBe(false);
    expect(emitted.some(e => e.event === 'combat:shield' && e.data.active === false)).toBe(true);
  });

  it('drains exactly 1 ammo per second, paid from basic ammo first', () => {
    const p = new Player('p');
    const entities = new Map([[p.id, p]]);
    combat.useSkill(p, 2, 0, 0, entities); // E at T0
    const basicBefore = p.basicAmmo;

    combat.tickPlayer(p, T0 + 999);
    expect(p.basicAmmo).toBe(basicBefore); // not yet due

    combat.tickPlayer(p, T0 + 1000);
    expect(p.basicAmmo).toBe(basicBefore - 1);
    expect(p.unstableTokens).toBe(20); // untouched

    combat.tickPlayer(p, T0 + 1999);
    expect(p.basicAmmo).toBe(basicBefore - 1);

    combat.tickPlayer(p, T0 + 2000);
    expect(p.basicAmmo).toBe(basicBefore - 2);
  });

  it('shield collapses when ammo runs out', () => {
    const p = new Player('p');
    p.basicAmmo = 0;
    p.unstableTokens = 0;
    const entities = new Map([[p.id, p]]);
    combat.useSkill(p, 2, 0, 0, entities);

    combat.tickPlayer(p, T0 + 1000);

    expect(p.shieldActive).toBe(false);
    expect(p.shield).toBe(0);
  });

  it('tickPlayer cleans up expired buffs', () => {
    const p = new Player('p');
    p.buffs.push({ name: 'dodge_invuln', atkMult: 1, defMult: 999, expiresAt: T0 + 10 });

    vi.setSystemTime(T0 + 100); // cleanupBuffs reads Date.now() internally
    combat.tickPlayer(p, T0 + 100);

    expect(p.buffs).toEqual([]);
  });
});
