const { v4: uuidv4 } = require('uuid');
const {
  RARITY_CONFIG, SKILLS, COPROCESSORS, calcDamage,
  MAP_WIDTH, MAP_HEIGHT, TILE, PLAYER_DEFAULTS,
} = require('../../shared/constants');

// AI training levels
const AI_LEVELS = {
  STAR_1: { stars: 1, expNeeded: 0, weightOptimization: 0, hasSpecial: false },
  STAR_2: { stars: 2, expNeeded: 100, weightOptimization: 0.10, hasSpecial: false },
  STAR_3: { stars: 3, expNeeded: 500, weightOptimization: 0.25, hasSpecial: true },
};

// Special behaviors (unlocked at ★★★)
const SPECIAL_BEHAVIORS = {
  BERSERKER: {
    id: 'berserker',
    name: '残血反杀',
    condition: (agent) => agent.hp / agent.maxHp < 0.10,
    effect: { attackWeight: 200 }, // +200% attack tendency
  },
  PERFECT_DEFENSE: {
    id: 'perfect_defense',
    name: '完美防御',
    effect: { shieldBonus: 0.50, shieldCooldownReduction: 2000 },
  },
  GREEDY_ALGORITHM: {
    id: 'greedy_algorithm',
    name: '贪婪算法',
    condition: (agent) => agent.lastPickupTime > Date.now() - 3000,
    effect: { damageBonus: 0.30 },
  },
  DODGE_MASTER: {
    id: 'dodge_master',
    name: '闪避大师',
    effect: { dodgeCooldownReduction: 0.40, dodgeRangeBonus: 1 },
  },
};

// AI decision priority weights
const AI_DECISIONS = {
  RETREAT_SHIELD: { name: 'retreat_shield', condition: (agent) => agent.hp / agent.maxHp < 0.20 && agent.getWeight('defense') > 50 },
  BERSERKER_COMBO: { name: 'berserker_combo', condition: (agent) => agent.hasSpecialActive('berserker') },
  LOW_HP_COMBO: { name: 'low_hp_combo', condition: (agent, enemy) => enemy && enemy.hp / enemy.maxHp < 0.30 && agent.getWeight('attack') > 50 },
  MELEE_ATTACK: { name: 'melee_attack', condition: (agent, enemy) => enemy && Math.abs(agent.x - enemy.x) + Math.abs(agent.y - enemy.y) <= 2 },
  CLOSE_GAP: { name: 'close_gap', condition: (agent, enemy) => enemy && agent.getWeight('mobility') > 50 },
  MOVE_TOWARD: { name: 'move_toward', condition: (agent, enemy) => !!enemy },
  COLLECT_TOKEN: { name: 'collect_token', condition: (agent, tokens) => tokens && tokens.length > 0 && agent.getWeight('economy') > 50 },
  PATROL: { name: 'patrol', condition: () => true },
};

class AIAgent {
  constructor(playerId, tokenDisk, playerName) {
    this.id = uuidv4();
    this.playerId = playerId;
    this.playerName = playerName;
    this.name = `AI-${playerName}`; // customizable later

    // Token disk: 4x4 array, each element is { rarity, type, ... }
    this.tokenDisk = tokenDisk || new Array(16).fill(null);

    // Combat stats (mirrors Player)
    this.hp = PLAYER_DEFAULTS.maxHp;
    this.maxHp = PLAYER_DEFAULTS.maxHp;
    this.baseAtk = PLAYER_DEFAULTS.baseAtk;
    this.baseDef = PLAYER_DEFAULTS.baseDef;
    this.x = 0;
    this.y = 0;
    this.alive = true;

    // Skills (same as player)
    this.skills = [
      { ...SKILLS.BASIC_ATTACK, lastUsed: 0 },
      { ...SKILLS.DODGE_ROLL, lastUsed: 0 },
      { ...SKILLS.SHIELD, lastUsed: 0 },
      { ...SKILLS.TOKEN_BURST, lastUsed: 0 },
    ];

    // Shield state
    this.shield = 0;
    this.shieldActive = false;
    this.shieldMax = 20;

    // Buffs
    this.buffs = [];

    // AI training / level
    this.exp = 0;
    this.level = AI_LEVELS.STAR_1;
    this.specialBehavior = null; // chosen at ★★★
    this.lastPickupTime = 0;

    // Rating
    this.aelo = 800;
    this.wins = 0;
    this.losses = 0;
    this.draws = 0;
    this.currentStreak = 0;
    this.highestStreak = 0;

    // Match state
    this.deployed = false;
    this.deployedAt = 0;
    this.inMatch = false;
    this.dailyMatches = 0;
    this.dailyResetDate = new Date().toDateString();
    this.lastMatchTime = 0;
    this.matchCooldownMs = 5 * 60 * 1000; // 5 minutes

    // Co-processor tokens assigned
    this.coprocessors = [];
  }

  // --- Token Weight Calculations ---

  get atk() {
    let atk = this.baseAtk;
    for (const token of this.tokenDisk) {
      if (token) atk += RARITY_CONFIG[token.rarity]?.atk || 0;
    }
    for (const buff of this.buffs) {
      if (Date.now() < buff.expiresAt) atk *= buff.atkMult || 1;
    }
    // Special behavior bonus
    const spec = this.getSpecialEffect('damageBonus');
    if (spec) atk *= (1 + spec);
    return Math.floor(atk);
  }

  get def() {
    let def = this.baseDef;
    for (const token of this.tokenDisk) {
      if (token) def += RARITY_CONFIG[token.rarity]?.def || 0;
    }
    return Math.floor(def);
  }

  getWeight(category) {
    let weight = 0;
    for (const token of this.tokenDisk) {
      if (!token) continue;
      const config = RARITY_CONFIG[token.rarity];
      const rarityMult = this._rarityWeightMult(config);
      const tokenCategory = this._categorizeToken(token);
      if (tokenCategory === category) weight += 30 * rarityMult;
    }
    // Apply training optimization
    weight *= (1 + this.level.weightOptimization);
    // Special behaviors
    if (category === 'attack' && this.hasSpecialActive('berserker')) {
      weight += 200;
    }
    return weight;
  }

  _rarityWeightMult(config) {
    if (!config) return 1.0;
    const map = {
      common: 1.0, uncommon: 1.05, rare: 1.10,
      epic: 1.20, legendary: 1.35,
    };
    // Match by color/label as a rough heuristic
    const colorMap = {
      0xFFFFFF: 1.0, 0x00FF00: 1.05, 0x0088FF: 1.10,
      0xAA00FF: 1.20, 0xFF8800: 1.35,
    };
    if (config.color && colorMap[config.color]) return colorMap[config.color];
    if (config.atk) {
      if (config.atk >= 30) return 1.35;
      if (config.atk >= 15) return 1.20;
      if (config.atk >= 7) return 1.10;
      if (config.atk >= 3) return 1.05;
    }
    return 1.0;
  }

  _categorizeToken(token) {
    // Use explicit category if set, otherwise infer from co-processor ID
    if (token.category) return token.category;
    if (!token.id) {
      // Stable token: default to attack for higher rarity
      const config = RARITY_CONFIG[token.rarity];
      if (config && config.atk >= config.def) return 'attack';
      return 'defense';
    }
    // Known co-processor IDs
    const attackIds = ['lightning_surge'];
    const defenseIds = ['shield_overload', 'damage_to_healing'];
    const mobilityIds = ['stealth_field', 'teleport_flash'];
    const economyIds = ['token_magnet', 'token_doubler'];
    if (attackIds.includes(token.id)) return 'attack';
    if (defenseIds.includes(token.id)) return 'defense';
    if (mobilityIds.includes(token.id)) return 'mobility';
    if (economyIds.includes(token.id)) return 'economy';
    return 'attack'; // default
  }

  // --- Special Behavior Helpers ---

  hasSpecialActive(behaviorId) {
    if (!this.specialBehavior || this.specialBehavior !== behaviorId) return false;
    const spec = SPECIAL_BEHAVIORS[behaviorId.toUpperCase()];
    if (!spec) return false;
    return spec.condition ? spec.condition(this) : true;
  }

  getSpecialEffect(effectKey) {
    if (!this.specialBehavior) return null;
    const spec = SPECIAL_BEHAVIORS[this.specialBehavior.toUpperCase()];
    if (!spec || !spec.effect[effectKey]) return null;
    if (spec.condition && !spec.condition(this)) return null;
    return spec.effect[effectKey];
  }

  setSpecialBehavior(behaviorId) {
    if (this.level.stars < 3) return false;
    if (!SPECIAL_BEHAVIORS[behaviorId.toUpperCase()]) return false;
    this.specialBehavior = behaviorId.toLowerCase();
    return true;
  }

  // --- Training ---

  addExp(amount) {
    this.exp += amount;
    // Check level-ups
    if (this.exp >= AI_LEVELS.STAR_3.expNeeded) {
      this.level = AI_LEVELS.STAR_3;
    } else if (this.exp >= AI_LEVELS.STAR_2.expNeeded) {
      this.level = AI_LEVELS.STAR_2;
    }
  }

  // --- Skill Helpers ---

  hasSkill(id) {
    return this.skills.find(s => s.id === id);
  }

  skillOnCooldown(id, now) {
    const skill = this.hasSkill(id);
    if (!skill) return true;
    return (now - skill.lastUsed) < skill.cooldown;
  }

  useSkill(id, now, cost) {
    const skill = this.hasSkill(id);
    if (!skill) return false;
    skill.lastUsed = now;
    return true;
  }

  // --- Shield ---

  enableShield(amount) {
    this.shieldActive = true;
    this.shield = amount;
  }

  takeDamage(amount, attackerId) {
    let remaining = amount;
    // Shield absorbs first
    if (this.shieldActive && this.shield > 0) {
      const absorbed = Math.min(remaining, this.shield);
      this.shield -= absorbed;
      remaining -= absorbed;
      if (this.shield <= 0) this.shieldActive = false;
    }
    // Apply to HP
    this.hp -= remaining;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return remaining; // actual HP damage dealt
  }

  // --- Serialization ---

  serialize() {
    return {
      id: this.id,
      playerId: this.playerId,
      playerName: this.playerName,
      name: this.name,
      level: this.level.stars,
      exp: this.exp,
      aelo: this.aelo,
      wins: this.wins,
      losses: this.losses,
      draws: this.draws,
      currentStreak: this.currentStreak,
      deployed: this.deployed,
      specialBehavior: this.specialBehavior,
      tokenDiskSize: this.tokenDisk.filter(t => t !== null).length,
    };
  }

  serializeFull() {
    return {
      ...this.serialize(),
      hp: this.hp,
      maxHp: this.maxHp,
      atk: this.atk,
      def: this.def,
      tokenDisk: this.tokenDisk,
      skills: this.skills,
      coprocessors: this.coprocessors,
    };
  }
}

module.exports = { AIAgent, AI_LEVELS, SPECIAL_BEHAVIORS, AI_DECISIONS };
