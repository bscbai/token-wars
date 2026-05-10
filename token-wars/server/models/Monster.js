const { v4: uuidv4 } = require('uuid');
const { RARITY_CONFIG } = require('../../shared/constants');

// Monster templates
const MONSTER_TEMPLATES = {
  drone: {
    name: '数据无人机',
    hp: 30,
    atk: 5,
    def: 2,
    speed: 1,
    xpReward: 10,
    lootTable: { unstable: [1, 3], stableChance: 0.1, stableRarity: 'common' },
    aiType: 'melee_chase',
    color: 0xff4444,
  },
  crawler: {
    name: '算力爬虫',
    hp: 60,
    atk: 10,
    def: 5,
    speed: 1,
    xpReward: 25,
    lootTable: { unstable: [2, 5], stableChance: 0.2, stableRarity: 'uncommon' },
    aiType: 'melee_chase',
    color: 0xff8800,
  },
  elite_guard: {
    name: '精英守卫',
    hp: 150,
    atk: 20,
    def: 10,
    speed: 1,
    xpReward: 75,
    lootTable: { unstable: [5, 10], stableChance: 0.5, stableRarity: 'rare' },
    aiType: 'melee_charge',
    specialAbility: 'charge', // rush toward player
    color: 0xff0088,
  },
  boss_cache_controller: {
    name: '缓存控制器',
    hp: 500,
    atk: 30,
    def: 15,
    speed: 1,
    xpReward: 200,
    lootTable: {
      unstable: [10, 20],
      stableChance: 1.0,
      stableRarity: 'rare',
      coprocessorChance: 0.1,
    },
    aiType: 'boss',
    bossPhases: [
      { hpThreshold: 1.0, abilities: ['melee_swing'] },
      { hpThreshold: 0.6, abilities: ['melee_swing', 'token_drain'] },
      { hpThreshold: 0.3, abilities: ['melee_swing', 'token_drain', 'enrage'] },
    ],
    color: 0xcc0000,
  },
};

class Monster {
  constructor(templateId, x, y) {
    const template = MONSTER_TEMPLATES[templateId];
    if (!template) throw new Error(`Unknown monster template: ${templateId}`);

    this.id = uuidv4();
    this.templateId = templateId;
    this.name = template.name;
    this.x = x;
    this.y = y;
    this.hp = template.hp;
    this.maxHp = template.hp;
    this.atk = template.atk;
    this.def = template.def;
    this.speed = template.speed;
    this.xpReward = template.xpReward;
    this.lootTable = template.lootTable;
    this.aiType = template.aiType;
    this.color = template.color;
    this.alive = true;

    // Aggro/threat table
    this.threatTable = new Map(); // playerId -> threatValue
    this.currentTarget = null;
    this.leashOrigin = { x, y };
    this.leashRange = 15;

    // AI state
    this.aiState = 'idle'; // idle, chasing, attacking, leashing, casting
    this.lastAttackTime = 0;
    this.attackCooldown = 1000; // ms

    // Boss-specific
    this.bossPhases = template.bossPhases || null;
    this.currentPhase = 0;
    this.specialAbility = template.specialAbility || null;
    this.lastAbilityTime = 0;
    this.abilityCooldown = 5000;
  }

  get isBoss() {
    return this.bossPhases !== null;
  }

  get isElite() {
    return this.specialAbility !== null && !this.isBoss;
  }

  addThreat(playerId, amount) {
    const current = this.threatTable.get(playerId) || 0;
    this.threatTable.set(playerId, current + amount);
  }

  getHighestThreatPlayer(players) {
    let highest = null;
    let highestThreat = -1;
    for (const [playerId, threat] of this.threatTable) {
      const player = players.get(playerId);
      if (player && player.alive && threat > highestThreat) {
        highest = player;
        highestThreat = threat;
      }
    }
    return highest;
  }

  takeDamage(amount, attackerId) {
    this.hp -= amount;
    if (attackerId) this.addThreat(attackerId, amount);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    // Check boss phase transitions
    if (this.bossPhases && this.alive) {
      const hpPercent = this.hp / this.maxHp;
      for (let i = this.bossPhases.length - 1; i >= 0; i--) {
        if (hpPercent <= this.bossPhases[i].hpThreshold && i > this.currentPhase) {
          this.currentPhase = i;
          break;
        }
      }
    }
    return this.alive;
  }

  serialize() {
    return {
      id: this.id,
      templateId: this.templateId,
      name: this.name,
      x: this.x,
      y: this.y,
      hp: this.hp,
      maxHp: this.maxHp,
      color: this.color,
      isBoss: this.isBoss,
      isElite: this.isElite,
      currentPhase: this.currentPhase,
      aiState: this.aiState,
    };
  }
}

module.exports = { Monster, MONSTER_TEMPLATES };
