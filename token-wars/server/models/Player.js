const { v4: uuidv4 } = require('uuid');
const { PLAYER_DEFAULTS, RARITY, RARITY_CONFIG, MINING, LEVEL_XP, LEVEL_UNLOCKS, SKILLS, BASIC_AMMO, COPROCESSOR_IDS, COPROCESSOR_STARS, COPROCESSOR_SHOP } = require('../../shared/constants');

class Player {
  constructor(username) {
    this.id = uuidv4();
    this.username = username;
    this.passwordHash = ''; // set externally after bcrypt

    // Combat stats
    this.hp = PLAYER_DEFAULTS.maxHp;
    this.maxHp = PLAYER_DEFAULTS.maxHp;
    this.baseAtk = PLAYER_DEFAULTS.baseAtk;
    this.baseDef = PLAYER_DEFAULTS.baseDef;
    this.x = 0;
    this.y = 0;
    this.alive = true;

    // Tokens
    this.stableTokens = []; // [{id, rarity, type:'stable'}]
    this.unstableTokens = PLAYER_DEFAULTS.startUnstableTokens;
    this.basicAmmo = BASIC_AMMO.MAX; // 基础弹药池（GDD §2.2），消耗优先于 unstableTokens

    // Equipped tokens (skill disk: 4x4 grid, null = empty)
    this.equippedTokens = new Array(16).fill(null);

    // Skills (4 slots)
    this.skills = [
      { ...SKILLS.BASIC_ATTACK, lastUsed: 0 },
      { ...SKILLS.DODGE_ROLL, lastUsed: 0 },
      { ...SKILLS.SHIELD, lastUsed: 0 },
      { ...SKILLS.TOKEN_BURST, lastUsed: 0 },
    ];

    // Progression
    this.level = 1;
    this.xp = 0;
    this.credits = PLAYER_DEFAULTS.startCredits;

    // Mining
    this.miningLevel = 1;
    this.lastMiningCollect = Date.now();
    this.pendingMiningTokens = 0;

    // PvP
    this.pvpRating = 1000;
    this.pvpWins = 0;
    this.pvpLosses = 0;
    this.winStreak = 0;
    this.streakRewardsClaimed = 0;
    this.streakResetDate = new Date().toDateString();

    // Shop
    this.purchasedPacks = {}; // { packId: purchaseCount }
    this.lastDailyClaim = ''; // date string for daily credit claim

    // Coprocessors (GDD §3): codex collection, fragment economy, single active load
    this.coprocessors = [];  // [{ id, star }] star ∈ 1..COPROCESSOR_STARS.MAX
    this.fragments = {};     // { [coprocessorId]: count }
    this.activeCoprocessor = null; // loaded coprocessor id (null = none)
    this.coprocessorLastUsed = 0; // transient cooldown timestamp (M6; not persisted)

    // Moderation
    this.banned = false;

    // Combat state (transient, not persisted)
    this.shield = 0;
    this.shieldActive = false;
    this.shieldExpiresAt = 0; // 护盾到期时间（连招可延长）
    this.stealthed = false;
    this.buffs = []; // [{name, atkMult, defMult, expiresAt}]

    // Combo state (transient) — recent skill keys within the combo window
    this.comboSeq = []; // [{key, at}]
    this.comboEffects = {}; // active combo bonuses, e.g. {dodgeCrit: expiresAt}
    this.lastCombatAt = 0; // last skill use (drives out-of-combat ammo regen)
    this.lastAmmoRegenAt = 0; // last basic-ammo regen grant
    this.lastShieldDrainAt = 0; // throttles shield drain to 1/sec

    // Timestamps
    this.createdAt = Date.now();
    this.lastLoginAt = Date.now();
  }

  get atk() {
    let atk = this.baseAtk;
    for (const token of this.equippedTokens) {
      if (token) atk += RARITY_CONFIG[token.rarity].atk;
    }
    // Apply buffs
    for (const buff of this.buffs) {
      if (Date.now() < buff.expiresAt) atk *= buff.atkMult;
    }
    return Math.floor(atk);
  }

  get def() {
    let def = this.baseDef;
    for (const token of this.equippedTokens) {
      if (token) def += RARITY_CONFIG[token.rarity].def;
    }
    for (const buff of this.buffs) {
      if (Date.now() < buff.expiresAt) def *= buff.defMult;
    }
    return Math.floor(def);
  }

  get unlock() {
    let unlock = LEVEL_UNLOCKS[1];
    for (const [lvl, u] of Object.entries(LEVEL_UNLOCKS)) {
      if (this.level >= parseInt(lvl)) unlock = u;
    }
    return unlock;
  }

  // Returns the number of levels gained, so callers can treat a level-up as a
  // transaction point worth persisting immediately.
  addXp(amount) {
    this.xp += amount;
    let levelsGained = 0;
    while (this.level < LEVEL_XP.length && this.xp >= LEVEL_XP[this.level]) {
      this.xp -= LEVEL_XP[this.level];
      this.level++;
      levelsGained++;
      this.maxHp = PLAYER_DEFAULTS.maxHp + (this.level - 1) * 5;
      this.hp = this.maxHp; // full heal on level up
    }
    return levelsGained;
  }

  addStableToken(rarity) {
    const token = { id: uuidv4(), rarity, type: 'stable' };
    this.stableTokens.push(token);
    return token;
  }

  addUnstableTokens(amount) {
    this.unstableTokens += amount;
  }

  spendUnstableTokens(amount) {
    if (this.unstableTokens < amount) return false;
    this.unstableTokens -= amount;
    return true;
  }

  spendCredits(amount) {
    if (this.credits < amount) return false;
    this.credits -= amount;
    return true;
  }

  // --- Coprocessors (GDD §3) ---

  hasCoprocessor(id) {
    return this.coprocessors.some(c => c.id === id);
  }

  getCoprocessor(id) {
    return this.coprocessors.find(c => c.id === id) || null;
  }

  // Grants ownership at ★. Duplicates convert to fragment compensation
  // (COPROCESSOR_SHOP.DUPLICATE_FRAGMENTS) instead of stacking.
  addCoprocessor(id) {
    if (!COPROCESSOR_IDS.includes(id)) return { status: 'invalid' };
    if (this.hasCoprocessor(id)) {
      const grant = this.addFragment(id, COPROCESSOR_SHOP.DUPLICATE_FRAGMENTS);
      return { status: 'duplicate', fragments: grant.count };
    }
    this.coprocessors.push({ id, star: 1 });
    return { status: 'granted', star: 1 };
  }

  addFragment(id, count = 1) {
    if (!COPROCESSOR_IDS.includes(id)) {
      throw new Error(`Unknown coprocessor id: ${id}`);
    }
    this.fragments[id] = (this.fragments[id] || 0) + count;
    return { coprocessorId: id, count, total: this.fragments[id] };
  }

  canUpgradeCoprocessor(id) {
    const owned = this.getCoprocessor(id);
    if (!owned) return { ok: false, reason: 'not_owned' };
    if (owned.star >= COPROCESSOR_STARS.MAX) return { ok: false, reason: 'max_star' };
    const cost = COPROCESSOR_STARS.UPGRADE_COSTS[owned.star - 1];
    if ((this.fragments[id] || 0) < cost) {
      return { ok: false, reason: 'insufficient_fragments', cost };
    }
    return { ok: true, cost };
  }

  upgradeCoprocessor(id) {
    const check = this.canUpgradeCoprocessor(id);
    if (!check.ok) return check;
    const owned = this.getCoprocessor(id);
    this.fragments[id] -= check.cost;
    owned.star += 1;
    return { ok: true, star: owned.star };
  }

  // null/undefined unloads; otherwise only owned ids may be loaded.
  setActiveCoprocessor(id) {
    if (id === null || id === undefined) {
      this.activeCoprocessor = null;
      return { ok: true };
    }
    if (!this.hasCoprocessor(id)) return { ok: false, reason: 'not_owned' };
    this.activeCoprocessor = id;
    return { ok: true };
  }

  takeDamage(amount, attackerId) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return this.alive;
  }

  serialize() {
    return {
      id: this.id,
      username: this.username,
      hp: this.hp,
      maxHp: this.maxHp,
      atk: this.atk,
      def: this.def,
      level: this.level,
      xp: this.xp,
      xpToNext: LEVEL_XP[this.level] || Infinity,
      credits: this.credits,
      stableTokens: this.stableTokens,
      unstableTokens: this.unstableTokens,
      basicAmmo: this.basicAmmo,
      equippedTokens: this.equippedTokens,
      coprocessors: this.coprocessors,
      fragments: this.fragments,
      activeCoprocessor: this.activeCoprocessor,
      miningLevel: this.miningLevel,
      pvpRating: this.pvpRating,
      pvpWins: this.pvpWins,
      pvpLosses: this.pvpLosses,
      winStreak: this.winStreak,
      unlock: this.unlock,
    };
  }

  // Save-safe version (excludes transient combat state)
  toSave() {
    return {
      id: this.id,
      username: this.username,
      passwordHash: this.passwordHash,
      hp: this.maxHp, // save at full hp
      maxHp: this.maxHp,
      baseAtk: this.baseAtk,
      baseDef: this.baseDef,
      stableTokens: this.stableTokens,
      unstableTokens: this.unstableTokens,
      basicAmmo: this.basicAmmo,
      equippedTokens: this.equippedTokens,
      coprocessors: this.coprocessors,
      fragments: this.fragments,
      activeCoprocessor: this.activeCoprocessor,
      skills: this.skills.map(s => ({ ...s, lastUsed: 0 })),
      level: this.level,
      xp: this.xp,
      credits: this.credits,
      miningLevel: this.miningLevel,
      lastMiningCollect: this.lastMiningCollect,
      pendingMiningTokens: this.pendingMiningTokens,
      pvpRating: this.pvpRating,
      pvpWins: this.pvpWins,
      pvpLosses: this.pvpLosses,
      winStreak: this.winStreak,
      streakRewardsClaimed: this.streakRewardsClaimed,
      streakResetDate: this.streakResetDate,
      purchasedPacks: this.purchasedPacks,
      lastDailyClaim: this.lastDailyClaim,
      banned: this.banned,
      createdAt: this.createdAt,
      lastLoginAt: this.lastLoginAt,
    };
  }

  static fromSave(data) {
    const p = Object.create(Player.prototype);
    Object.assign(p, data);
    p.alive = true;
    p.x = 0;
    p.y = 0;
    p.shield = 0;
    p.shieldActive = false;
    p.shieldExpiresAt = 0;
    p.stealthed = false;
    p.buffs = [];
    // Old saves predate the basic ammo pool — rookies load with a full pool.
    p.basicAmmo = typeof data.basicAmmo === 'number' ? data.basicAmmo : BASIC_AMMO.MAX;
    // Old saves predate the coprocessor system — empty codex, no fragments, nothing loaded.
    p.coprocessors = Array.isArray(data.coprocessors) ? data.coprocessors : [];
    p.fragments = data.fragments && typeof data.fragments === 'object' ? data.fragments : {};
    p.activeCoprocessor = typeof data.activeCoprocessor === 'string' ? data.activeCoprocessor : null;
    p.coprocessorLastUsed = 0; // cooldown is transient — reset on load (mirrors skills)
    p.comboSeq = [];
    p.comboEffects = {};
    p.lastCombatAt = 0;
    p.lastAmmoRegenAt = Date.now();
    p.lastShieldDrainAt = 0;
    p.banned = !!data.banned;
    if (data.skills && Array.isArray(data.skills)) {
      p.skills = data.skills.map(s => ({ ...s, lastUsed: 0 }));
    }
    return p;
  }
}

module.exports = Player;
