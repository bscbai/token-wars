const { v4: uuidv4 } = require('uuid');
const { PLAYER_DEFAULTS, RARITY, RARITY_CONFIG, MINING, LEVEL_XP, LEVEL_UNLOCKS, SKILLS } = require('../../shared/constants');

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

    // Combat state (transient, not persisted)
    this.shield = 0;
    this.shieldActive = false;
    this.stealthed = false;
    this.buffs = []; // [{name, atkMult, defMult, expiresAt}]

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

  addXp(amount) {
    this.xp += amount;
    while (this.level < LEVEL_XP.length && this.xp >= LEVEL_XP[this.level]) {
      this.xp -= LEVEL_XP[this.level];
      this.level++;
      this.maxHp = PLAYER_DEFAULTS.maxHp + (this.level - 1) * 5;
      this.hp = this.maxHp; // full heal on level up
    }
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
      equippedTokens: this.equippedTokens,
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
      equippedTokens: this.equippedTokens,
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
    p.stealthed = false;
    p.buffs = [];
    if (data.skills && Array.isArray(data.skills)) {
      p.skills = data.skills.map(s => ({ ...s, lastUsed: 0 }));
    }
    return p;
  }
}

module.exports = Player;
