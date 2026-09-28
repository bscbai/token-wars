// Coprocessor system data layer (GDD §3): codex, fragment economy,
// star upgrades, active load, drop sources, persistence.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const Player = require('../server/models/Player');
const PvEManager = require('../server/game/PvEManager');
const PvPManager = require('../server/game/PvPManager');
const { rollCoprocessorId, rollFragmentGrant } = require('../server/game/CoprocessorDrops');
const { makeShopRouter } = require('../server/routes/shop');
const { Store } = require('../server/data/Store');
const {
  COPROCESSORS, COPROCESSOR_IDS, COPROCESSOR_CATEGORIES, COPROCESSOR_STARS,
  COPROCESSOR_FRAGMENT_SOURCES, COPROCESSOR_SHOP, PLAYER_DEFAULTS, EVENTS,
} = require('../shared/constants');

function makeFakeStore() {
  return {
    dirty: new Set(),
    persisted: [],
    markDirty(p) { if (p && p.id) this.dirty.add(p.id); return p; },
    persist(p) { this.persisted.push(p.id); return true; },
  };
}

function makeSocket() {
  const emitted = [];
  return { emitted, emit: (event, data) => emitted.push({ event, data }) };
}

describe('Coprocessor codex (constants)', () => {
  it('defines exactly 16 coprocessors, 4 per category, with unique ids', () => {
    const entries = Object.values(COPROCESSORS);
    expect(entries).toHaveLength(16);
    const ids = entries.map(c => c.id);
    expect(new Set(ids).size).toBe(16);
    expect(COPROCESSOR_IDS).toHaveLength(16);

    const byCategory = {};
    for (const c of entries) {
      expect(Object.values(COPROCESSOR_CATEGORIES)).toContain(c.category);
      byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    }
    expect(byCategory).toEqual({ attack: 4, defense: 4, mobility: 4, economy: 4 });
  });

  it('every entry has 3 star blocks with cooldown and tokenCost', () => {
    for (const c of Object.values(COPROCESSORS)) {
      expect(c.stars).toHaveLength(COPROCESSOR_STARS.MAX);
      for (const star of c.stars) {
        expect(typeof star.cooldown).toBe('number');
        expect(typeof star.tokenCost).toBe('number');
      }
    }
  });

  it('lightning surge matches the GDD §3.4 star table exactly', () => {
    expect(COPROCESSORS.LIGHTNING_SURGE.stars).toEqual([
      { damageMult: 1.0, chainCount: 2, cooldown: 10000, tokenCost: 2 },
      { damageMult: 1.3, chainCount: 3, cooldown: 8000, tokenCost: 2 },
      { damageMult: 1.5, chainCount: 4, cooldown: 6000, tokenCost: 1 },
    ]);
  });

  it('preserves the legacy entry keys and ids', () => {
    expect(COPROCESSORS.LIGHTNING_SURGE.id).toBe('lightning_surge');
    expect(COPROCESSORS.SHIELD_OVERLOAD.id).toBe('shield_overload');
    expect(COPROCESSORS.STEALTH_FIELD.id).toBe('stealth_field');
    expect(COPROCESSORS.TOKEN_MAGNET.id).toBe('token_magnet');
  });

  it('declares upgrade costs and fragment source rates per GDD §3.4', () => {
    expect(COPROCESSOR_STARS.UPGRADE_COSTS).toEqual([3, 8]);
    expect(COPROCESSOR_FRAGMENT_SOURCES.SOLO_BOSS.rate).toBe(0.15);
    expect(COPROCESSOR_FRAGMENT_SOURCES.TEAM_BOSS.rate).toBe(0.30);
    expect(COPROCESSOR_FRAGMENT_SOURCES.PVP_STREAK.rate).toBe(0.10);
    // Declared but not wired in this change:
    expect(COPROCESSOR_FRAGMENT_SOURCES.WORLD_BOSS.rate).toBeUndefined();
    expect(COPROCESSOR_FRAGMENT_SOURCES.DAILY_TASK.rate).toBeUndefined();
    expect(COPROCESSOR_SHOP.DUPLICATE_FRAGMENTS).toBe(3);
  });

  it('adds the COPROCESSOR_FRAGMENT event', () => {
    expect(EVENTS.COPROCESSOR_FRAGMENT).toBe('coprocessor:fragment');
  });
});

describe('Player coprocessor collection', () => {
  let player;
  beforeEach(() => {
    player = new Player('collector');
  });

  it('grants a new coprocessor at ★', () => {
    const res = player.addCoprocessor('lightning_surge');
    expect(res).toEqual({ status: 'granted', star: 1 });
    expect(player.coprocessors).toEqual([{ id: 'lightning_surge', star: 1 }]);
    expect(player.hasCoprocessor('lightning_surge')).toBe(true);
    expect(player.getCoprocessor('lightning_surge').star).toBe(1);
  });

  it('converts duplicate grants to fragment compensation', () => {
    player.addCoprocessor('lightning_surge');
    const res = player.addCoprocessor('lightning_surge');
    expect(res.status).toBe('duplicate');
    expect(res.fragments).toBe(COPROCESSOR_SHOP.DUPLICATE_FRAGMENTS);
    expect(player.coprocessors).toHaveLength(1); // no stacking
    expect(player.fragments.lightning_surge).toBe(3);
  });

  it('rejects unknown coprocessor ids', () => {
    expect(player.addCoprocessor('not_a_coprocessor')).toEqual({ status: 'invalid' });
    expect(() => player.addFragment('not_a_coprocessor')).toThrow();
  });

  it('accumulates fragments and reports totals', () => {
    expect(player.addFragment('burn_mark')).toEqual({ coprocessorId: 'burn_mark', count: 1, total: 1 });
    expect(player.addFragment('burn_mark', 4)).toEqual({ coprocessorId: 'burn_mark', count: 4, total: 5 });
  });

  it('upgrades ★→★★ for 3 fragments and ★★→★★★ for 8', () => {
    player.addCoprocessor('lightning_surge');
    player.addFragment('lightning_surge', 3);
    expect(player.upgradeCoprocessor('lightning_surge')).toEqual({ ok: true, star: 2 });
    expect(player.fragments.lightning_surge).toBe(0);

    player.addFragment('lightning_surge', 8);
    expect(player.upgradeCoprocessor('lightning_surge')).toEqual({ ok: true, star: 3 });
    expect(player.fragments.lightning_surge).toBe(0);
  });

  it('rejects upgrades with insufficient fragments without consuming them', () => {
    player.addCoprocessor('lightning_surge');
    player.addFragment('lightning_surge', 2);
    const res = player.upgradeCoprocessor('lightning_surge');
    expect(res).toEqual({ ok: false, reason: 'insufficient_fragments', cost: 3 });
    expect(player.fragments.lightning_surge).toBe(2);
    expect(player.getCoprocessor('lightning_surge').star).toBe(1);
  });

  it('rejects upgrades at max star and for unowned coprocessors', () => {
    player.addCoprocessor('lightning_surge');
    player.getCoprocessor('lightning_surge').star = 3;
    expect(player.upgradeCoprocessor('lightning_surge')).toEqual({ ok: false, reason: 'max_star' });
    expect(player.canUpgradeCoprocessor('burn_mark')).toEqual({ ok: false, reason: 'not_owned' });
    expect(player.upgradeCoprocessor('burn_mark')).toEqual({ ok: false, reason: 'not_owned' });
  });

  it('loads only owned coprocessors, and unloads with null', () => {
    player.addCoprocessor('shield_overload');
    expect(player.setActiveCoprocessor('burn_mark')).toEqual({ ok: false, reason: 'not_owned' });
    expect(player.activeCoprocessor).toBeNull();
    expect(player.setActiveCoprocessor('shield_overload')).toEqual({ ok: true });
    expect(player.activeCoprocessor).toBe('shield_overload');
    expect(player.setActiveCoprocessor(null)).toEqual({ ok: true });
    expect(player.activeCoprocessor).toBeNull();
  });

  it('serializes collection state for the client', () => {
    player.addCoprocessor('lightning_surge');
    player.addFragment('lightning_surge', 2);
    player.setActiveCoprocessor('lightning_surge');
    const s = player.serialize();
    expect(s.coprocessors).toEqual([{ id: 'lightning_surge', star: 1 }]);
    expect(s.fragments).toEqual({ lightning_surge: 2 });
    expect(s.activeCoprocessor).toBe('lightning_surge');
  });

  it('round-trips through toSave/fromSave', () => {
    player.addCoprocessor('lightning_surge');
    player.addFragment('lightning_surge', 3);
    player.upgradeCoprocessor('lightning_surge');
    player.addFragment('burn_mark', 1);
    player.setActiveCoprocessor('lightning_surge');

    const restored = Player.fromSave(player.toSave());
    expect(restored.coprocessors).toEqual([{ id: 'lightning_surge', star: 2 }]);
    expect(restored.fragments).toEqual({ lightning_surge: 0, burn_mark: 1 });
    expect(restored.activeCoprocessor).toBe('lightning_surge');
  });

  it('loads old saves as an empty collection', () => {
    const oldSave = new Player('veteran').toSave();
    delete oldSave.coprocessors;
    delete oldSave.fragments;
    delete oldSave.activeCoprocessor;
    const restored = Player.fromSave(oldSave);
    expect(restored.coprocessors).toEqual([]);
    expect(restored.fragments).toEqual({});
    expect(restored.activeCoprocessor).toBeNull();
  });
});

describe('CoprocessorDrops', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rolls a uniform id across the codex', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(rollCoprocessorId()).toBe(COPROCESSOR_IDS[0]);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(rollCoprocessorId()).toBe(COPROCESSOR_IDS[15]);
  });

  it('grants a fragment below the rate, marks dirty and emits the event', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05); // < 0.15 solo, id index 0
    const player = new Player('lucky');
    const store = makeFakeStore();
    const socket = makeSocket();

    const res = rollFragmentGrant(player, 'SOLO_BOSS', { store, socket });

    expect(res).toEqual({
      coprocessorId: COPROCESSOR_IDS[0], count: 1, total: 1, source: 'SOLO_BOSS',
    });
    expect(player.fragments[COPROCESSOR_IDS[0]]).toBe(1);
    expect(store.dirty.has(player.id)).toBe(true);
    expect(socket.emitted).toEqual([{ event: EVENTS.COPROCESSOR_FRAGMENT, data: res }]);
  });

  it('grants nothing at or above the rate', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // >= every wired rate
    const player = new Player('unlucky');
    const store = makeFakeStore();
    const socket = makeSocket();

    expect(rollFragmentGrant(player, 'SOLO_BOSS', { store, socket })).toBeNull();
    expect(player.fragments).toEqual({});
    expect(store.dirty.size).toBe(0);
    expect(socket.emitted).toEqual([]);
  });

  it('applies the team rate between the solo and team thresholds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2); // >= 0.15 solo, < 0.30 team
    const player = new Player('teamer');
    expect(rollFragmentGrant(player, 'SOLO_BOSS', { store: makeFakeStore() })).toBeNull();
    expect(rollFragmentGrant(player, 'TEAM_BOSS', { store: makeFakeStore() })).not.toBeNull();
  });

  it('applies the PvP streak rate and skips unwired sources', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05); // < 0.10 streak
    const player = new Player('duelist');
    expect(rollFragmentGrant(player, 'PVP_STREAK', { store: makeFakeStore() })).not.toBeNull();
    expect(rollFragmentGrant(player, 'WORLD_BOSS', { store: makeFakeStore() })).toBeNull();
    expect(rollFragmentGrant(player, 'DAILY_TASK', { store: makeFakeStore() })).toBeNull();
    expect(rollFragmentGrant(player, 'NOT_A_SOURCE', { store: makeFakeStore() })).toBeNull();
  });
});

describe('Fragment source wiring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dungeon clear drops a fragment per player (solo rate)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const player = new Player('diver');
    const store = makeFakeStore();
    const socket = makeSocket();
    const pve = new PvEManager({ emit: () => {} }, store, { syncPlayer: () => {} });
    pve.playerSockets.set(player.id, socket);
    const dungeon = { id: 'd1', rooms: [{}, {}], players: new Map([[player.id, player]]), monsters: new Map() };

    pve.completeDungeon(dungeon);

    const total = Object.values(player.fragments).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
    expect(store.persisted).toContain(player.id); // drop rides the existing transaction point
    const evt = socket.emitted.find(e => e.event === EVENTS.COPROCESSOR_FRAGMENT);
    expect(evt.data.source).toBe('SOLO_BOSS');
  });

  it('team dungeon clear (2+ players) uses the 30% rate', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2); // >= 0.15, < 0.30
    const a = new Player('a');
    const b = new Player('b');
    const store = makeFakeStore();
    const pve = new PvEManager({ emit: () => {} }, store, { syncPlayer: () => {} });
    const dungeon = { id: 'd2', rooms: [{}], players: new Map([[a.id, a], [b.id, b]]), monsters: new Map() };

    pve.completeDungeon(dungeon);

    for (const p of [a, b]) {
      const total = Object.values(p.fragments).reduce((x, y) => x + y, 0);
      expect(total).toBe(1);
    }
  });

  it('failed roll leaves the collection untouched', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const player = new Player('dry');
    const store = makeFakeStore();
    const pve = new PvEManager({ emit: () => {} }, store, { syncPlayer: () => {} });
    const dungeon = { id: 'd3', rooms: [{}], players: new Map([[player.id, player]]), monsters: new Map() };

    pve.completeDungeon(dungeon);

    expect(player.fragments).toEqual({});
  });

  it('PvP 3-win-streak chest drops a fragment at 10%', () => {
    const player = new Player('streaker');
    player.winStreak = 2; // endMatch increments to 3
    player.streakRewardsClaimed = 0;
    const store = makeFakeStore();
    store.getPlayerById = (id) => (id === player.id ? player : null);
    const socket = makeSocket();
    const pvp = new PvPManager({ emit: () => {} }, store, { syncPlayer: () => {} });
    pvp.cleanupArena = () => {};
    pvp.playerSockets.set(player.id, socket);
    const arena = { id: 'ar1', matchWinner: 0, teams: [[player.id], ['ghost']] };

    vi.spyOn(Math, 'random').mockReturnValue(0.05); // < 0.10 streak drop
    pvp.endMatch(arena);

    const total = Object.values(player.fragments).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
    expect(player.streakRewardsClaimed).toBe(1);
    expect(player.unstableTokens).toBe(PLAYER_DEFAULTS.startUnstableTokens + 2); // chest tokens still granted
    expect(socket.emitted.find(e => e.event === EVENTS.COPROCESSOR_FRAGMENT).data.source).toBe('PVP_STREAK');
  });

  it('PvP streak chest without a drop still pays the unstable tokens', () => {
    const player = new Player('streaker2');
    player.winStreak = 2;
    player.streakRewardsClaimed = 0;
    const store = makeFakeStore();
    store.getPlayerById = (id) => (id === player.id ? player : null);
    const pvp = new PvPManager({ emit: () => {} }, store, { syncPlayer: () => {} });
    pvp.cleanupArena = () => {};
    const arena = { id: 'ar2', matchWinner: 0, teams: [[player.id], ['ghost']] };

    vi.spyOn(Math, 'random').mockReturnValue(0.5); // >= 0.10, no fragment
    pvp.endMatch(arena);

    expect(player.fragments).toEqual({});
    expect(player.unstableTokens).toBe(PLAYER_DEFAULTS.startUnstableTokens + 2);
  });
});

describe('Shop coprocessor packs', () => {
  let dir, store, app, token, player;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-coproc-'));
    store = new Store(path.join(dir, 'shop.db'), { migrate: false });
    app = express();
    app.use(express.json());
    app.use('/api/shop', makeShopRouter({ store, verifySession: () => player }));

    const created = new Player('buyer');
    store.addPlayer(created);
    player = created;
    player.credits = 5000; // afford premium/legendary
    token = 'fake-session';
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('premium pack grants one unowned coprocessor at ★', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05); // id index 0 of the unowned pool
    const res = await request(app)
      .post('/api/shop/buy')
      .set('Authorization', `Bearer ${token}`)
      .send({ packId: 'premium' });

    expect(res.status).toBe(200);
    expect(res.body.received.coprocessor).toEqual({ id: COPROCESSOR_IDS[0], status: 'granted' });
    expect(player.coprocessors).toEqual([{ id: COPROCESSOR_IDS[0], star: 1 }]);
  });

  it('a full codex converts the pack grant to fragments', async () => {
    for (const id of COPROCESSOR_IDS) player.addCoprocessor(id);
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const res = await request(app)
      .post('/api/shop/buy')
      .set('Authorization', `Bearer ${token}`)
      .send({ packId: 'premium' });

    expect(res.status).toBe(200);
    expect(res.body.received.coprocessor.status).toBe('duplicate');
    expect(player.coprocessors).toHaveLength(16); // no stacking
    const picked = res.body.received.coprocessor.id;
    expect(player.fragments[picked]).toBe(COPROCESSOR_SHOP.DUPLICATE_FRAGMENTS);
  });

  it('non-coprocessor packs keep the legacy false flag', async () => {
    const res = await request(app)
      .post('/api/shop/buy')
      .set('Authorization', `Bearer ${token}`)
      .send({ packId: 'basic' });

    expect(res.status).toBe(200);
    expect(res.body.received.coprocessor).toBe(false);
    expect(player.coprocessors).toEqual([]);
  });
});
